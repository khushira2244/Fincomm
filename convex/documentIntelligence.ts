// Document Intelligence: turns an inbound email or an uploaded photo/PDF
// into a candidate entry — never a confirmed one. Writes only to
// `documents` and `extractedFacts`; incomeSources/expenses/obligations/
// assets are written only when the user hits Confirm, through the
// existing add mutations (see convex/extractedFacts.ts).

import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMembership } from "./access";
import type { Id } from "./_generated/dataModel";

// `process.env` is genuinely available in Convex's default (non-Node)
// action runtime for reading deployment env vars — this doesn't need
// "use node". The ambient Node types just aren't resolving for this
// project's convex/tsconfig.json despite `types: ["node"]` being set
// there and @types/node being installed; this is a minimal, scoped
// stand-in rather than a workaround for a real runtime problem.
declare const process: { env: Record<string, string | undefined> };

const CATEGORY = v.union(
  v.literal("incomeSources"),
  v.literal("expenses"),
  v.literal("obligations"),
  v.literal("assets"),
  v.literal("insurancePolicies"),
);

const extractedShape = v.object({
  category: CATEGORY,
  label: v.string(),
  amountMinorUnits: v.number(),
  // For obligations: the outstanding balance, when a document mentions
  // both an EMI and a balance. For insurancePolicies: the premium
  // amount, when a coverage amount and a premium are both mentioned
  // (amountMinorUnits carries the coverage amount in that case). Null
  // otherwise.
  secondaryAmountMinorUnits: v.union(v.number(), v.null()),
  detail: v.string(),
});

// ---------------------------------------------------------------------
// Upload flow
// ---------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireMembership(ctx); // auth gate; return value unused otherwise
    return await ctx.storage.generateUploadUrl();
  },
});

export const uploadDocument = mutation({
  args: {
    storageId: v.id("_storage"),
    sectionHint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    await ctx.scheduler.runAfter(0, internal.documentIntelligence.extractFromUpload, {
      householdId: membership.householdId,
      storageId: args.storageId,
      sectionHint: args.sectionHint,
    });
    return null;
  },
});

// ---------------------------------------------------------------------
// Extraction actions (OpenAI calls happen here, never in a mutation —
// mutations have a 1-second timeout that a model call can easily exceed)
// ---------------------------------------------------------------------

export const extractFromEmail = internalAction({
  args: {
    householdId: v.id("households"),
    subject: v.string(),
    text: v.string(),
    externalRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const extracted = await callOpenAiForText(`Subject: ${args.subject}\n\n${args.text}`);
    await ctx.runMutation(internal.documentIntelligence.recordExtraction, {
      householdId: args.householdId,
      sourceType: "email",
      externalRef: args.externalRef,
      title: args.subject,
      supportingPassage: args.text.slice(0, 500),
      extracted,
    });
    return null;
  },
});

export const extractFromUpload = internalAction({
  args: {
    householdId: v.id("households"),
    storageId: v.id("_storage"),
    sectionHint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    if (url === null) {
      throw new ConvexError("Uploaded file not found.");
    }
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) {
      throw new ConvexError(`Could not read uploaded file: ${fileResponse.status}`);
    }
    const contentType = fileResponse.headers.get("content-type") ?? "application/octet-stream";
    const base64 = arrayBufferToBase64(await fileResponse.arrayBuffer());
    const extracted = await callOpenAiForFile(base64, contentType, args.sectionHint);
    await ctx.runMutation(internal.documentIntelligence.recordExtraction, {
      householdId: args.householdId,
      sourceType: contentType === "application/pdf" ? "uploaded PDF" : "uploaded photo",
      externalRef: args.storageId,
      title: undefined,
      supportingPassage: extracted.detail || "Extracted from an uploaded file.",
      extracted,
    });
    return null;
  },
});

// ---------------------------------------------------------------------
// Recording the candidate — documents + extractedFacts only, per the
// schema's design: extraction never writes a confirmed entry.
// ---------------------------------------------------------------------

export const recordExtraction = internalMutation({
  args: {
    householdId: v.id("households"),
    sourceType: v.string(),
    externalRef: v.string(),
    title: v.optional(v.string()),
    supportingPassage: v.string(),
    extracted: extractedShape,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const documentId = await ctx.db.insert("documents", {
      householdId: args.householdId,
      sourceType: args.sourceType,
      externalRef: args.externalRef,
      title: args.title,
      receivedAt: Date.now(),
    });
    await ctx.db.insert("extractedFacts", {
      documentId,
      householdId: args.householdId,
      targetEntityType: args.extracted.category,
      targetEntityId: undefined,
      claimedValue: args.extracted,
      supportingPassage: args.supportingPassage,
      verificationStatus: "extracted",
    });
    return null;
  },
});

// ---------------------------------------------------------------------
// Test-only entry point: lets us exercise the extraction pipeline (OpenAI
// call → documents/extractedFacts write) the same way a real inbound
// email would, without requiring the AgentMail webhook to be registered
// with a secret. Requires the caller to be signed in with a household —
// this is not part of the public product surface, only a testing seam.
// ---------------------------------------------------------------------

export const simulateInboundEmail = action({
  args: { subject: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership: { householdId: Id<"households"> } = await ctx.runQuery(
      internal.documentIntelligence.getMembershipForAction,
      {},
    );
    await ctx.runAction(internal.documentIntelligence.extractFromEmail, {
      householdId: membership.householdId,
      subject: args.subject,
      text: args.text,
      externalRef: `simulated-${Date.now()}`,
    });
    return null;
  },
});

export const getMembershipForAction = internalQuery({
  args: {},
  returns: v.object({ householdId: v.id("households") }),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return { householdId: membership.householdId };
  },
});

// ---------------------------------------------------------------------
// OpenAI calls
// ---------------------------------------------------------------------

type ExtractedFact = {
  category: "incomeSources" | "expenses" | "obligations" | "assets" | "insurancePolicies";
  label: string;
  amountMinorUnits: number;
  secondaryAmountMinorUnits: number | null;
  detail: string;
};

const SYSTEM_PROMPT = `You extract structured financial facts from a document or email for a household finance app. Respond with ONLY a JSON object matching exactly this shape:
{
  "category": "incomeSources" | "expenses" | "obligations" | "assets" | "insurancePolicies",
  "label": string,
  "amountInRupees": number,
  "secondaryAmountInRupees": number | null,
  "detail": string
}

Field meanings:
- category: what kind of household finance item this is.
  - "incomeSources": money the household regularly receives (salary, freelance income, rent received)
  - "expenses": money the household regularly spends (bills, groceries, subscriptions)
  - "obligations": loans, EMIs, or debts owed by the household
  - "assets": savings, investments, property, or anything of value the household owns
  - "insurancePolicies": an insurance policy document or renewal notice (life, health, motor, property, personal accident, or other insurance) — NOT a loan, even if the loan bundles insurance
- label: a short human-readable label, e.g. "Personal loan" or "Freelance payment". For insurancePolicies, use the policy type and insurer if known, e.g. "Health insurance — Star Health".
- amountInRupees: the primary amount, in whole rupees, as a plain integer (no currency symbols, no commas). IMPORTANT: use the number exactly as it appears for the rupee amount — do NOT convert it to paise, cents, or any other minor currency unit, and do NOT multiply it by 100. If a document says "Rs 45,000", the value is 45000, not 4500000. For an obligation, use the EMI amount here if both an EMI and a balance are mentioned. For insurancePolicies, use the coverage/sum-assured amount here.
- secondaryAmountInRupees: for an obligation, the outstanding balance in whole rupees if separately mentioned. For insurancePolicies, the premium amount in whole rupees if separately mentioned. Otherwise null. Same rule: do not convert to a minor unit.
- detail: one short sentence with any other relevant detail mentioned (cadence such as monthly/weekly/annual/one-off, due date, liquidity, lender/insurer name, policy number, premium frequency, etc). Empty string if nothing else is mentioned.

Make your best reasonable guess for category and amount even if the document is ambiguous — never refuse or leave a field blank.`;

async function callOpenAi(content: unknown[]): Promise<ExtractedFact> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConvexError("OPENAI_API_KEY is not set on this deployment.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new ConvexError(`OpenAI request failed: ${response.status} ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message.content ?? "{}";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const validCategories = ["incomeSources", "expenses", "obligations", "assets", "insurancePolicies"];
  const category = validCategories.includes(parsed.category as string)
    ? (parsed.category as ExtractedFact["category"])
    : "expenses";
  const label =
    typeof parsed.label === "string" && parsed.label.trim().length > 0
      ? parsed.label.trim()
      : "Extracted item";
  const amountMinorUnits = Math.round(Number(parsed.amountInRupees) || 0);
  const secondaryAmountMinorUnits =
    typeof parsed.secondaryAmountInRupees === "number"
      ? Math.round(parsed.secondaryAmountInRupees)
      : null;
  const detail = typeof parsed.detail === "string" ? parsed.detail : "";

  return { category, label, amountMinorUnits, secondaryAmountMinorUnits, detail };
}

async function callOpenAiForText(text: string): Promise<ExtractedFact> {
  return callOpenAi([{ type: "text", text: `Extract the financial fact from this email:\n\n${text}` }]);
}

async function callOpenAiForFile(
  base64: string,
  contentType: string,
  sectionHint?: string,
): Promise<ExtractedFact> {
  const hint = sectionHint
    ? `This file was uploaded to the "${sectionHint}" section of the app, which is a hint but not a guarantee of its category.\n\n`
    : "";

  if (contentType === "application/pdf") {
    return callOpenAi([
      { type: "text", text: `${hint}Extract the financial fact from this document.` },
      { type: "file", file: { filename: "upload.pdf", file_data: `data:application/pdf;base64,${base64}` } },
    ]);
  }

  return callOpenAi([
    { type: "text", text: `${hint}Extract the financial fact from this image.` },
    { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } },
  ]);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
