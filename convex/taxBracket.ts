// Standalone tax-bracket estimator. Deliberately its own module — Tax
// Planning (Service #8, not yet built) will import parseNewRegimeSlabs /
// lookupTaxSlab directly and can call the estimateTaxBracket action
// below wholesale (Convex functions are callable cross-file via
// `api`/`internal`) rather than reimplementing slab lookup.
//
// Boundary: the slab table comes from ONE real scrape of an official
// government source, parsed by deterministic row/cell logic (regex,
// never AI — same discipline as Loan & Debt's benchmark-rate parse).
// OpenAI only explains what the matched slab means in plain language;
// it never invents a slab or a rate.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);

// Official Income Tax Department page — verified live (2026-09-15) to
// carry a real "Tax Slabs for AY 2026-27" table for the New Tax Regime.
const TAX_SLAB_SOURCE_URL = "https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1";
const TAX_SLAB_SOURCE_LABEL = "Income Tax Department (incometax.gov.in) — New Tax Regime slabs, AY 2026-27";
const TAX_SLAB_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — reused staleness pattern, longer window since slabs change rarely

export type TaxSlab = { maxMinorUnits: number | null; ratePercent: number };

// The official page's table has 4 columns (Old Slab | Old Rate | New
// Slab | New Rate) for its first few rows, then drops to 2 columns (New
// Slab | New Rate only) once the old regime runs out of brackets — so
// "the new regime" is always the LAST slab+rate cell pair in each row,
// never a fixed column index. Deterministic row/cell parsing.
export function parseNewRegimeSlabs(markdown: string): TaxSlab[] {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  const slabs: TaxSlab[] = [];
  for (const line of lines) {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) continue;
    const rateCell = cells[cells.length - 1];
    const slabCell = cells[cells.length - 2];
    if (!/₹/.test(slabCell)) continue;
    if (/nil/i.test(rateCell)) {
      const m = slabCell.match(/₹\s*([\d,]+)/);
      if (m) slabs.push({ maxMinorUnits: Number(m[1].replace(/,/g, "")), ratePercent: 0 });
      continue;
    }
    const rateMatch = rateCell.match(/(\d{1,2})%/);
    if (!rateMatch) continue;
    const rate = Number(rateMatch[1]);
    if (/^above/i.test(slabCell)) {
      slabs.push({ maxMinorUnits: null, ratePercent: rate });
    } else {
      const nums = [...slabCell.matchAll(/₹\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
      const max = nums[nums.length - 1];
      if (max !== undefined) slabs.push({ maxMinorUnits: max, ratePercent: rate });
    }
  }
  // The page repeats near-identical tables for other taxpayer categories
  // further down — de-duplicate on the upper bound and stop at 7 rows to
  // keep only the first complete table (Salaried Individuals, AY 2026-27).
  const seen = new Set<number | null>();
  const deduped: TaxSlab[] = [];
  for (const s of slabs) {
    if (seen.has(s.maxMinorUnits)) continue;
    seen.add(s.maxMinorUnits);
    deduped.push(s);
    if (deduped.length === 7) break;
  }
  return deduped.sort((a, b) => (a.maxMinorUnits ?? Infinity) - (b.maxMinorUnits ?? Infinity));
}

// Simple deterministic lookup — first slab whose upper bound covers the
// income (null upper bound = the open-ended top slab).
export function lookupTaxSlab(annualIncomeMinorUnits: number, slabs: TaxSlab[]): { ratePercent: number; label: string } | null {
  for (const s of slabs) {
    if (s.maxMinorUnits === null || annualIncomeMinorUnits <= s.maxMinorUnits) {
      return { ratePercent: s.ratePercent, label: s.ratePercent === 0 ? "Nil (0%) slab" : `${s.ratePercent}% slab` };
    }
  }
  return null;
}

export const ensureTaxSlabSource = internalMutation({
  args: {},
  returns: v.id("sourceRegistry"),
  handler: async (ctx) => {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", TAX_SLAB_SOURCE_URL)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", {
      url: TAX_SLAB_SOURCE_URL,
      label: TAX_SLAB_SOURCE_LABEL,
      isAllowlisted: true,
      authorityLevel: "official-tax-authority",
    });
  },
});

export const getRecentTaxSlabSnapshot = internalQuery({
  args: { sourceId: v.id("sourceRegistry"), now: v.number() },
  returns: v.union(v.null(), v.object({ snapshotId: v.id("sourceSnapshots"), fetchedAt: v.number(), slabsJson: v.string() })),
  handler: async (ctx, args) => {
    const snap = (await ctx.db.query("sourceSnapshots").withIndex("by_source", (q) => q.eq("sourceRegistryId", args.sourceId)).collect())
      .sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (!snap || args.now - snap.fetchedAt > TAX_SLAB_MAX_AGE_MS) return null;
    return { snapshotId: snap._id, fetchedAt: snap.fetchedAt, slabsJson: snap.contentSummary };
  },
});

export const saveTaxSlabSnapshot = internalMutation({
  args: { sourceId: v.id("sourceRegistry"), slabsJson: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) =>
    await ctx.db.insert("sourceSnapshots", {
      sourceRegistryId: args.sourceId,
      fetchedAt: Date.now(),
      contentSummary: args.slabsJson.slice(0, 3000),
    }),
});

// Orchestrates cache-or-scrape for the slab table. Plain async function
// (not a Convex endpoint itself) so any action in any file can call it —
// this is the piece Tax Planning will reuse directly.
export async function getCurrentTaxSlabs(
  ctx: Parameters<typeof firecrawl.scrape>[0] & {
    runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
    runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
  },
): Promise<{ ok: true; slabs: TaxSlab[]; sourceSnapshotId: Id<"sourceSnapshots"> | null; fromCache: boolean } | { ok: false; reason: string }> {
  const sourceId = (await ctx.runMutation(internal.taxBracket.ensureTaxSlabSource, {})) as Id<"sourceRegistry">;
  const now = Date.now();
  const recent = (await ctx.runQuery(internal.taxBracket.getRecentTaxSlabSnapshot, { sourceId, now })) as {
    snapshotId: Id<"sourceSnapshots">;
    fetchedAt: number;
    slabsJson: string;
  } | null;
  if (recent) {
    try {
      const slabs = JSON.parse(recent.slabsJson) as TaxSlab[];
      return { ok: true, slabs, sourceSnapshotId: recent.snapshotId, fromCache: true };
    } catch {
      // fall through to a fresh scrape if the cached JSON is somehow bad
    }
  }
  try {
    const doc = await firecrawl.scrape(ctx, TAX_SLAB_SOURCE_URL, { formats: ["markdown"] });
    const md = (doc.markdown ?? "") as string;
    const slabs = parseNewRegimeSlabs(md);
    if (slabs.length === 0) {
      return { ok: false, reason: "The official tax slab table could not be parsed from the source page this time." };
    }
    const snapshotId = (await ctx.runMutation(internal.taxBracket.saveTaxSlabSnapshot, {
      sourceId,
      slabsJson: JSON.stringify(slabs),
    })) as Id<"sourceSnapshots">;
    return { ok: true, slabs, sourceSnapshotId: snapshotId, fromCache: false };
  } catch (err) {
    return { ok: false, reason: `The official tax slab source couldn't be reached (${err instanceof Error ? err.message : String(err)}).` };
  }
}

export const gatherDependableAnnualIncome = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const now = Date.now();
    const income = await ctx.db.query("incomeSources").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect();
    const monthlyEquiv = (amount: number, cadence: string): number => {
      if (cadence === "monthly") return amount;
      if (cadence === "weekly") return Math.round((amount * 52) / 12);
      if (cadence === "annual") return Math.round(amount / 12);
      return 0;
    };
    const dependableMonthlyIncome = income
      .filter((i) => i.reliability === "dependable" && i.activeFrom <= now && (i.activeTo === undefined || i.activeTo > now))
      .reduce((s, i) => s + monthlyEquiv(i.amountMinorUnits, i.cadence), 0);
    return { householdId, dependableAnnualIncomeMinorUnits: dependableMonthlyIncome * 12 };
  },
});

async function chatJson(system: string, user: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ConvexError("OPENAI_API_KEY is not set on this deployment.");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) throw new ConvexError(`OpenAI request failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as { choices: { message: { content: string } }[] };
  try {
    return JSON.parse(data.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const estimateTaxBracket = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const income = (await ctx.runQuery(internal.taxBracket.gatherDependableAnnualIncome, {})) as {
      householdId: Id<"households">;
      dependableAnnualIncomeMinorUnits: number;
    };
    const slabResult = await getCurrentTaxSlabs(ctx as never);
    if (!slabResult.ok) {
      return { state: "SOURCE_UNAVAILABLE", reason: slabResult.reason };
    }
    const match = lookupTaxSlab(income.dependableAnnualIncomeMinorUnits, slabResult.slabs);
    if (match === null) {
      return { state: "INSUFFICIENT_DATA", reason: "No dependable annual income is recorded yet — add income in Financial Foundation first." };
    }
    const system = `You explain what an income-tax slab means in one or two plain sentences for an Indian household. You are given the household's dependable annual income and their ALREADY-DETERMINED slab (label and rate) from an official government source table — you did not decide this, you only explain it. Return ONLY JSON: { "headline": string, "plainLanguage": string }. Never suggest specific deductions, investments, or tax-saving products. Never state a different rate or slab than the one given. Make clear this is the New Tax Regime slab only, informational, not filed tax advice.`;
    const parsed = await chatJson(
      system,
      JSON.stringify({ dependableAnnualIncomeMinorUnits: income.dependableAnnualIncomeMinorUnits, slabLabel: match.label, ratePercent: match.ratePercent }),
    );
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : `Estimated slab: ${match.label}`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
    };
    await ctx.runMutation(internal.taxBracket.saveTaxBracketEstimate, {
      householdId: income.householdId,
      annualIncomeMinorUnits: income.dependableAnnualIncomeMinorUnits,
      estimatedSlabLabel: match.label,
      sourceSnapshotId: slabResult.sourceSnapshotId ?? undefined,
      narration,
    });
    return {
      state: "COMPUTED",
      annualIncomeMinorUnits: income.dependableAnnualIncomeMinorUnits,
      estimatedSlabLabel: match.label,
      ratePercent: match.ratePercent,
      sourceLabel: TAX_SLAB_SOURCE_LABEL,
      sourceUrl: TAX_SLAB_SOURCE_URL,
      fromCache: slabResult.fromCache,
      narration,
    };
  },
});

export const saveTaxBracketEstimate = internalMutation({
  args: {
    householdId: v.id("households"),
    annualIncomeMinorUnits: v.number(),
    estimatedSlabLabel: v.string(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    narration: v.object({ headline: v.string(), plainLanguage: v.string() }),
  },
  returns: v.id("taxBracketEstimates"),
  handler: async (ctx, args) => {
    const household = await ctx.db.get("households", args.householdId);
    return await ctx.db.insert("taxBracketEstimates", {
      ...args,
      inputStateRevision: household?.stateRevision ?? 0,
      createdAt: Date.now(),
    });
  },
});

export const listTaxBracketEstimates = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => await ctx.db.query("taxBracketEstimates").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect(),
});
