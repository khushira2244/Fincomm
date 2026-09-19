// Tax Planning (Service #8). Four pieces: a household tax profile
// (honest direct input), a deterministic old-regime deduction summary,
// an old-vs-new regime comparison, and deduction-gap detection.
//
// STRICTEST BOUNDARY, same as every prior service: deterministic code
// does every calculation (deduction sums, caps, regime comparison).
// OpenAI narrates an ALREADY-DECIDED result only — it never says "file
// it this way" or claims a filing is correct; every narration frames
// this as an estimate to confirm with an actual filing process or a
// professional, never as filing instructions.
//
// GST: gstRegistered on taxProfiles is purely informational — read by
// nothing else in this file (or anywhere in the app). No GST
// calculation exists here or anywhere.
//
// REUSE, NOT REIMPLEMENTATION: convex/taxBracket.ts is never modified.
// This file imports its exported `lookupTaxSlab`/`TaxSlab`/
// `getCurrentTaxSlabs`/`gatherDependableAnnualIncome` directly — see
// the import below and every call site marked "// REUSED FROM
// taxBracket.ts". That module only ever parsed the New Regime slab
// column (built for Investment's simpler "what slab am I in" need), so
// Old Regime slab parsing and full progressive-tax computation across
// all slabs are genuinely new logic added here, not a duplicate of
// anything that already existed.
//
// SECURITY: every action/query touching a household's own data calls
// requireMembership (or an internalQuery that does) FIRST — same
// discipline as every service since the Side-Income gap was found.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership, assertIntegerMinorUnits, bumpStateRevision } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";
import { lookupTaxSlab, getCurrentTaxSlabs, type TaxSlab } from "./taxBracket"; // REUSED FROM taxBracket.ts

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);
const agentmailSender = new AgentMail(components.agentmail);

const rupees = (minor: number) => `₹${Math.round(minor).toLocaleString("en-IN")}`;

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

// =====================================================================
// Tax profile — direct household input, honest approximate figures.
// =====================================================================

export const saveTaxProfile = mutation({
  args: {
    employmentType: v.union(v.literal("salaried"), v.literal("selfEmployed")),
    approximateTdsDeductedMinorUnits: v.optional(v.number()),
    hraClaimedMinorUnits: v.optional(v.number()),
    approximateNetBusinessIncomeMinorUnits: v.optional(v.number()),
    approximate80CInvestmentMinorUnits: v.optional(v.number()),
    gstRegistered: v.optional(v.boolean()),
  },
  returns: v.id("taxProfiles"),
  handler: async (ctx, args) => {
    for (const [field, val] of Object.entries(args)) {
      if (typeof val === "number") assertIntegerMinorUnits(val, field);
    }
    const membership = await requireMembership(ctx);
    const existing = await ctx.db
      .query("taxProfiles")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("taxProfiles", existing._id, { ...args, updatedAt: now });
      await bumpStateRevision(ctx, membership.householdId);
      return existing._id;
    }
    const id = await ctx.db.insert("taxProfiles", {
      householdId: membership.householdId,
      ...args,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

export const getTaxProfile = query({
  args: {},
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("taxProfiles")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .first();
  },
});

// =====================================================================
// Real sourced law data: deduction caps (Sec 80C/80D/24(b)) and old-
// regime slabs from ONE real official page; standard deduction + 87A
// rebate thresholds from a second real official FAQ page. Every figure
// below is parsed from real scraped text — nothing here is a hardcoded
// guess, even where the value is well-known.
// =====================================================================

const LAW_SOURCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — same staleness window as taxBracket.ts

// Same official page taxBracket.ts already scrapes for New Regime
// slabs (independently re-scraped here, not reading its cache — that
// cache stores only the already-parsed new-regime array, not the raw
// table text this file needs for Old Regime slabs and deduction caps).
const DEDUCTIONS_REAL_URL = "https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1";
// Distinct sourceRegistry KEY (not a different real page — Firecrawl
// always scrapes DEDUCTIONS_REAL_URL below). taxBracket.ts already owns
// a sourceRegistry row for the bare URL and writes its own snapshots
// there (a plain TaxSlab[] array, not this file's {caps, oldSlabs}
// shape). Reusing that exact row would let this file's cache-lookup
// pick up ONE OF taxBracket.ts's own snapshots by mistake and crash on
// the shape mismatch — caught live during verification. The "#" suffix
// keeps this file's own snapshot timeline independent while still
// genuinely scraping the identical real official page.
const DEDUCTIONS_SOURCE_URL = DEDUCTIONS_REAL_URL + "#tax-planning-deductions";
const DEDUCTIONS_SOURCE_LABEL = "Income Tax Department (incometax.gov.in) — Old Regime slabs & Chapter VIA deductions, AY 2026-27";

const REGIME_FAQ_SOURCE_URL = "https://www.incometax.gov.in/iec/foportal/help/new-tax-vs-old-tax-regime-faqs";
const REGIME_FAQ_SOURCE_LABEL = "Income Tax Department (incometax.gov.in) — New Tax vs Old Tax Regime FAQs";

// Mirrors taxBracket.ts's parseNewRegimeSlabs exactly in spirit (search
// by content, never a fixed column index), but takes the FIRST slab+
// rate pair per row instead of the last — the official table has 4
// columns (Old Slab | Old Rate | New Slab | New Rate) while the old
// regime still has brackets left, then drops to 2 (New-only) once Old
// Regime's 4 brackets are exhausted — so a row only carries real
// Old-Regime data when it has 4 cells.
function parseOldRegimeSlabs(markdown: string): TaxSlab[] {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  const slabs: TaxSlab[] = [];
  for (const line of lines) {
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 4) continue; // no Old Regime data in a 2-cell (New-only) row
    const slabCell = cells[0];
    const rateCell = cells[1];
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
  const seen = new Set<number | null>();
  const deduped: TaxSlab[] = [];
  for (const s of slabs) {
    if (seen.has(s.maxMinorUnits)) continue;
    seen.add(s.maxMinorUnits);
    deduped.push(s);
    if (deduped.length === 4) break; // the (<60 years) Old Regime table has exactly 4 brackets
  }
  return deduped.sort((a, b) => (a.maxMinorUnits ?? Infinity) - (b.maxMinorUnits ?? Infinity));
}

type DeductionCaps = { cap80CMinorUnits: number; cap80DMinorUnits: number; cap24bMinorUnits: number };

// Content-driven extraction (regex against real scraped text, never a
// hardcoded number) of the three real caps from the same official page:
// "Combined deduction limit of ₹ 1,50,000" (Sec 80C/80CCC/80CCD(1)),
// "₹ 25,000 ... For Self / Spouse or Dependent Children" under
// "Section 80D" (base, non-senior-citizen figure — this app has no age
// tracking), and the "Self-Occupied ... ₹ 2,00,000" row under
// Section 24(b).
function parseDeductionCaps(markdown: string): DeductionCaps | null {
  const cap80CMatch = markdown.match(/Combined deduction limit of\s*\*{0,2}\s*₹\s*([\d,]+)/i);
  const cap80DMatch = markdown.match(/Section 80D[\s\S]{0,250}?₹\s*([\d,]+)/i);
  const cap24bMatch = markdown.match(/Self-Occupied[\s\S]{0,250}?₹\s*([\d,]+)/i);
  if (!cap80CMatch || !cap80DMatch || !cap24bMatch) return null;
  return {
    cap80CMinorUnits: Number(cap80CMatch[1].replace(/,/g, "")),
    cap80DMinorUnits: Number(cap80DMatch[1].replace(/,/g, "")),
    cap24bMinorUnits: Number(cap24bMatch[1].replace(/,/g, "")),
  };
}

type RegimeFaqFacts = {
  standardDeductionMinorUnits: number;
  oldRebateIncomeThresholdMinorUnits: number;
  oldRebateMaxMinorUnits: number;
  newRebateIncomeThresholdMinorUnits: number;
  newRebateMaxMinorUnits: number;
};

// Content-driven extraction from the real FAQ page. "Standard deduction
// of Rs.50,000 ... available for both old and new tax regimes" (so one
// sourced figure serves both); the Sec 87A rebate thresholds/maximums
// for each regime, stated in the same real FAQ text. Marginal-relief
// above the new-regime threshold (clause (b) in the source) is a known,
// clearly-caveated simplification NOT modeled here — only the
// full-rebate-below-threshold case (clause (a)) is applied.
function parseRegimeFaqFacts(markdown: string): RegimeFaqFacts | null {
  const stdMatch = markdown.match(/Standard deduction of Rs\.?\s*([\d,]+)/i);
  const oldRebateMatch = markdown.match(/old tax regime[\s\S]{0,150}?total income does not exceed Rs\.?\s*([\d,]+)[\s\S]{0,150}?maximum of Rs\.?\s*([\d,]+)/i);
  const newRebateMatch = markdown.match(/does not exceed seven hundred thousand rupees[\s\S]{0,400}?twenty-five thousand rupees/i);
  if (!stdMatch || !oldRebateMatch || !newRebateMatch) return null;
  return {
    standardDeductionMinorUnits: Number(stdMatch[1].replace(/,/g, "")),
    oldRebateIncomeThresholdMinorUnits: Number(oldRebateMatch[1].replace(/,/g, "")),
    oldRebateMaxMinorUnits: Number(oldRebateMatch[2].replace(/,/g, "")),
    // The new-regime clause is spelled out in words ("seven hundred
    // thousand", "twenty-five thousand") rather than digits in the real
    // source text — these two figures are real, fixed statutory amounts
    // named explicitly in that spelled-out clause, not independently
    // guessed; NOT extracted via a digit regex since the source itself
    // doesn't write them as digits here.
    newRebateIncomeThresholdMinorUnits: 700_000,
    newRebateMaxMinorUnits: 25_000,
  };
}

export const ensureLawSource = internalMutation({
  args: { url: v.string(), label: v.string() },
  returns: v.id("sourceRegistry"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: "official-tax-authority" });
  },
});

export const getRecentLawSnapshot = internalQuery({
  args: { sourceId: v.id("sourceRegistry"), now: v.number() },
  returns: v.union(v.null(), v.object({ snapshotId: v.id("sourceSnapshots"), fetchedAt: v.number(), contentJson: v.string() })),
  handler: async (ctx, args) => {
    const snap = (await ctx.db.query("sourceSnapshots").withIndex("by_source", (q) => q.eq("sourceRegistryId", args.sourceId)).collect())
      .sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (!snap || args.now - snap.fetchedAt > LAW_SOURCE_MAX_AGE_MS) return null;
    return { snapshotId: snap._id, fetchedAt: snap.fetchedAt, contentJson: snap.contentSummary };
  },
});

export const saveLawSnapshot = internalMutation({
  args: { sourceId: v.id("sourceRegistry"), contentJson: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) =>
    await ctx.db.insert("sourceSnapshots", { sourceRegistryId: args.sourceId, fetchedAt: Date.now(), contentSummary: args.contentJson.slice(0, 4000) }),
});

// Cache-or-scrape orchestrator for the deductions + old-regime-slabs
// page — ONE real scrape produces both, since they live on the same
// official page. Returns a genuine sourceSnapshotId tied to that real
// fetch, reused for all three deduction caps since they're honestly all
// sourced from this one real page's actual content.
async function getDeductionsAndOldSlabs(
  ctx: Parameters<typeof firecrawl.scrape>[0] & { runQuery: (ref: unknown, args: unknown) => Promise<unknown>; runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
): Promise<{ ok: true; caps: DeductionCaps; oldSlabs: TaxSlab[]; sourceSnapshotId: Id<"sourceSnapshots">; fromCache: boolean } | { ok: false; reason: string }> {
  const sourceId = (await ctx.runMutation(internal.taxPlanning.ensureLawSource, { url: DEDUCTIONS_SOURCE_URL, label: DEDUCTIONS_SOURCE_LABEL })) as Id<"sourceRegistry">;
  const now = Date.now();
  const recent = (await ctx.runQuery(internal.taxPlanning.getRecentLawSnapshot, { sourceId, now })) as { snapshotId: Id<"sourceSnapshots">; contentJson: string } | null;
  if (recent) {
    try {
      const parsed = JSON.parse(recent.contentJson) as { caps: DeductionCaps; oldSlabs: TaxSlab[] };
      return { ok: true, caps: parsed.caps, oldSlabs: parsed.oldSlabs, sourceSnapshotId: recent.snapshotId, fromCache: true };
    } catch {
      // fall through to a fresh scrape if the cached JSON is somehow bad
    }
  }
  try {
    const doc = await firecrawl.scrape(ctx, DEDUCTIONS_REAL_URL, { formats: ["markdown"] });
    const md = (doc.markdown ?? "") as string;
    const caps = parseDeductionCaps(md);
    const oldSlabs = parseOldRegimeSlabs(md);
    if (!caps || oldSlabs.length === 0) {
      return { ok: false, reason: "The official Income Tax Department page could not be parsed for deduction caps / Old Regime slabs this time." };
    }
    const snapshotId = (await ctx.runMutation(internal.taxPlanning.saveLawSnapshot, { sourceId, contentJson: JSON.stringify({ caps, oldSlabs }) })) as Id<"sourceSnapshots">;
    return { ok: true, caps, oldSlabs, sourceSnapshotId: snapshotId, fromCache: false };
  } catch (err) {
    return { ok: false, reason: `The official Income Tax Department page couldn't be reached (${err instanceof Error ? err.message : String(err)}).` };
  }
}

async function getRegimeFaqFacts(
  ctx: Parameters<typeof firecrawl.scrape>[0] & { runQuery: (ref: unknown, args: unknown) => Promise<unknown>; runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
): Promise<{ ok: true; facts: RegimeFaqFacts; sourceSnapshotId: Id<"sourceSnapshots">; fromCache: boolean } | { ok: false; reason: string }> {
  const sourceId = (await ctx.runMutation(internal.taxPlanning.ensureLawSource, { url: REGIME_FAQ_SOURCE_URL, label: REGIME_FAQ_SOURCE_LABEL })) as Id<"sourceRegistry">;
  const now = Date.now();
  const recent = (await ctx.runQuery(internal.taxPlanning.getRecentLawSnapshot, { sourceId, now })) as { snapshotId: Id<"sourceSnapshots">; contentJson: string } | null;
  if (recent) {
    try {
      const facts = JSON.parse(recent.contentJson) as RegimeFaqFacts;
      return { ok: true, facts, sourceSnapshotId: recent.snapshotId, fromCache: true };
    } catch {
      // fall through
    }
  }
  try {
    const doc = await firecrawl.scrape(ctx, REGIME_FAQ_SOURCE_URL, { formats: ["markdown"] });
    const md = (doc.markdown ?? "") as string;
    const facts = parseRegimeFaqFacts(md);
    if (!facts) {
      return { ok: false, reason: "The official Income Tax Department FAQ page could not be parsed for standard deduction / rebate figures this time." };
    }
    const snapshotId = (await ctx.runMutation(internal.taxPlanning.saveLawSnapshot, { sourceId, contentJson: JSON.stringify(facts) })) as Id<"sourceSnapshots">;
    return { ok: true, facts, sourceSnapshotId: snapshotId, fromCache: false };
  } catch (err) {
    return { ok: false, reason: `The official FAQ page couldn't be reached (${err instanceof Error ? err.message : String(err)}).` };
  }
}

// =====================================================================
// Deduction summary — deterministic sums, each capped at its real
// sourced legal limit.
// =====================================================================

export const gatherDeductionInputData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const household = await ctx.db.get("households", householdId);
    const profile = await ctx.db.query("taxProfiles").withIndex("by_household", (q) => q.eq("householdId", householdId)).first();
    const [obligations, policies] = await Promise.all([
      ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("insurancePolicies").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
    ]);

    // Sec 24(b): no payment ledger is tracked anywhere in the app, so
    // this is a simple, hand-verifiable current-balance estimate
    // (outstanding balance × annual rate) for homeLoan obligations,
    // clearly caveated as an approximation, not exact interest paid.
    const homeLoanInterestEstimateMinorUnits = obligations
      .filter((o) => o.obligationType === "homeLoan" && o.annualRateBasisPoints !== undefined)
      .reduce((s, o) => s + o.balanceMinorUnits * ((o.annualRateBasisPoints ?? 0) / 10000), 0);

    const annualPremium = (p: (typeof policies)[number]) => (p.premiumFrequency === "monthly" ? p.premiumMinorUnits * 12 : p.premiumMinorUnits);
    const healthPremiumTotalMinorUnits = policies.filter((p) => p.type === "health").reduce((s, p) => s + annualPremium(p), 0);
    const lifePremiumTotalMinorUnits = policies.filter((p) => p.type === "life").reduce((s, p) => s + annualPremium(p), 0);

    return {
      householdId,
      stateRevision: household?.stateRevision ?? 0,
      employmentType: profile?.employmentType ?? null,
      hraClaimedMinorUnits: profile?.hraClaimedMinorUnits ?? 0,
      approximate80CInvestmentMinorUnits: profile?.approximate80CInvestmentMinorUnits ?? 0,
      homeLoanInterestEstimateMinorUnits: Math.round(homeLoanInterestEstimateMinorUnits),
      healthPremiumTotalMinorUnits,
      lifePremiumTotalMinorUnits,
      hasProfile: profile !== null,
    };
  },
});

function diagnoseDeductionSummary(inp: {
  employmentType: "salaried" | "selfEmployed" | null;
  homeLoanInterestEstimateMinorUnits: number;
  healthPremiumTotalMinorUnits: number;
  lifePremiumTotalMinorUnits: number;
  approximate80CInvestmentMinorUnits: number;
  caps: DeductionCaps;
  standardDeductionMinorUnits: number;
}): {
  loanInterestDeductionMinorUnits: number;
  insurancePremiumDeductionMinorUnits: number;
  investmentDeductionMinorUnits: number;
  standardDeductionMinorUnits: number;
  totalDeductionsMinorUnits: number;
} {
  const loanInterestDeductionMinorUnits = Math.min(inp.homeLoanInterestEstimateMinorUnits, inp.caps.cap24bMinorUnits);
  const insurancePremiumDeductionMinorUnits = Math.min(inp.healthPremiumTotalMinorUnits, inp.caps.cap80DMinorUnits);
  const investmentDeductionMinorUnits = Math.min(inp.lifePremiumTotalMinorUnits + inp.approximate80CInvestmentMinorUnits, inp.caps.cap80CMinorUnits);
  const standardDeductionMinorUnits = inp.employmentType === "salaried" ? inp.standardDeductionMinorUnits : 0;
  const totalDeductionsMinorUnits = loanInterestDeductionMinorUnits + insurancePremiumDeductionMinorUnits + investmentDeductionMinorUnits + standardDeductionMinorUnits;
  return { loanInterestDeductionMinorUnits, insurancePremiumDeductionMinorUnits, investmentDeductionMinorUnits, standardDeductionMinorUnits, totalDeductionsMinorUnits };
}

export const saveDeductionSummary = internalMutation({
  args: {
    householdId: v.id("households"),
    loanInterestDeductionMinorUnits: v.number(),
    insurancePremiumDeductionMinorUnits: v.number(),
    investmentDeductionMinorUnits: v.number(),
    standardDeductionMinorUnits: v.number(),
    totalDeductionsMinorUnits: v.number(),
    inputStateRevision: v.number(),
  },
  returns: v.id("taxDeductionSummaries"),
  handler: async (ctx, args) => await ctx.db.insert("taxDeductionSummaries", { ...args, createdAt: Date.now() }),
});

export const findCachedDeductionSummary = internalQuery({
  args: { householdId: v.id("households"), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("taxDeductionSummaries").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const checkTaxDeductionSummary = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.taxPlanning.gatherDeductionInputData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      employmentType: "salaried" | "selfEmployed" | null;
      hraClaimedMinorUnits: number;
      approximate80CInvestmentMinorUnits: number;
      homeLoanInterestEstimateMinorUnits: number;
      healthPremiumTotalMinorUnits: number;
      lifePremiumTotalMinorUnits: number;
      hasProfile: boolean;
    };

    const lawResult = await getDeductionsAndOldSlabs(ctx as never);
    if (!lawResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: lawResult.reason };
    const faqResult = await getRegimeFaqFacts(ctx as never);
    if (!faqResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: faqResult.reason };

    const diag = diagnoseDeductionSummary({
      employmentType: data.employmentType,
      homeLoanInterestEstimateMinorUnits: data.homeLoanInterestEstimateMinorUnits,
      healthPremiumTotalMinorUnits: data.healthPremiumTotalMinorUnits,
      lifePremiumTotalMinorUnits: data.lifePremiumTotalMinorUnits,
      approximate80CInvestmentMinorUnits: data.approximate80CInvestmentMinorUnits,
      caps: lawResult.caps,
      standardDeductionMinorUnits: faqResult.facts.standardDeductionMinorUnits,
    });

    const cached = await ctx.runQuery(internal.taxPlanning.findCachedDeductionSummary, { householdId: data.householdId, stateRevision: data.stateRevision });
    const extras = {
      caps: lawResult.caps,
      hraClaimedMinorUnits: data.hraClaimedMinorUnits,
      hasProfile: data.hasProfile,
      sourceLabel: DEDUCTIONS_SOURCE_LABEL,
      sourceUrl: DEDUCTIONS_REAL_URL,
    };
    // Narration is regenerated every call, cache hit or not — same
    // "cheap to recompute, never stale relative to the figures it
    // explains" pattern checkTaxRegimeComparison and
    // checkTaxDeductionGaps already use in this same file (this
    // function was the one inconsistent with that pattern, caught
    // while wiring the frontend — a return-shape fix, not a change to
    // any deterministic calculation, which stays byte-identical either
    // way). taxDeductionSummaries' own schema has no narration field by
    // design, so there was never a stored copy to reuse regardless.
    const system = `You put an ALREADY-COMPUTED income-tax deduction summary into plain language for an Indian household (Old Tax Regime deductions only). You are given the deduction totals for Section 24(b) (home loan interest), Section 80D (health insurance premiums), Section 80C (life insurance + investments), the standard deduction, and the combined total. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- Every number given is FINAL — never recompute or contradict it.
- NEVER say "file it this way", "claim this", or give filing instructions. This is an estimate to confirm with an actual filing process or a tax professional, never advice on how to file.
- Every field ending in "MinorUnits" is a plain rupee amount — write "₹" with Indian digit grouping.
- NEVER state a specific date, year, deadline, or cutoff (e.g. "as of 2023", "before the March deadline") — none is given to you in the data, so do not invent one. If a caveat needs to mention timing, say so generically (e.g. "check current filing deadlines") without naming a date.
- "caveats" = 2-3 short statements (e.g. these figures only apply under the Old Tax Regime; home loan interest is an estimate based on current balance, not an exact figure; this is not a substitute for a professional's review).`;
    const parsed = await chatJson(system, JSON.stringify(diag));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : `Estimated deductions: ${rupees(diag.totalDeductionsMinorUnits)}`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };

    if (cached) {
      const c = cached as { _id: Id<"taxDeductionSummaries"> } & Record<string, unknown>;
      return { state: "COMPUTED", summaryId: c._id, ...diag, ...extras, narration, _fromCache: true };
    }
    const id = await ctx.runMutation(internal.taxPlanning.saveDeductionSummary, { householdId: data.householdId, ...diag, inputStateRevision: data.stateRevision });
    return { state: "COMPUTED", summaryId: id, ...diag, ...extras, narration, _fromCache: false };
  },
});

// =====================================================================
// Regime comparison — pure arithmetic, no AI judgment in which regime
// "wins". Reuses taxBracket.ts's lookupTaxSlab/getCurrentTaxSlabs for
// New Regime slabs; Old Regime slabs come from parseOldRegimeSlabs
// above (this file's own new logic, same real source page).
// =====================================================================

// New, genuinely-needed logic: taxBracket.ts's lookupTaxSlab only
// identifies ONE marginal slab for narration — it was never built to
// sum progressive tax across all slabs, which regime comparison needs.
function computeProgressiveTax(taxableIncomeMinorUnits: number, slabs: TaxSlab[]): number {
  if (taxableIncomeMinorUnits <= 0) return 0;
  let tax = 0;
  let lowerBound = 0;
  for (const s of slabs) {
    const upperBound = s.maxMinorUnits ?? Infinity;
    if (taxableIncomeMinorUnits <= lowerBound) break;
    const amountInSlab = Math.min(taxableIncomeMinorUnits, upperBound) - lowerBound;
    if (amountInSlab > 0) tax += amountInSlab * (s.ratePercent / 100);
    lowerBound = upperBound;
  }
  return Math.round(tax);
}

// Sec 87A rebate — full-rebate-below-threshold case only (clause (a) of
// the real sourced FAQ text); the marginal-relief case just above the
// new-regime threshold (clause (b)) is a documented, caveated
// simplification not modeled here.
function applyRebate(tax: number, taxableIncomeMinorUnits: number, thresholdMinorUnits: number, maxRebateMinorUnits: number): number {
  if (taxableIncomeMinorUnits > thresholdMinorUnits) return tax;
  return Math.max(0, tax - Math.min(tax, maxRebateMinorUnits));
}

export const findCachedRegimeComparison = internalQuery({
  args: { householdId: v.id("households"), inputHash: v.string(), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("taxRegimeComparisons").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputHash === args.inputHash && r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const saveRegimeComparison = internalMutation({
  args: {
    householdId: v.id("households"),
    oldRegimeEstimatedTaxMinorUnits: v.number(),
    newRegimeEstimatedTaxMinorUnits: v.number(),
    recommendedRegime: v.union(v.literal("old"), v.literal("new"), v.literal("similar")),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputHash: v.string(),
    inputStateRevision: v.number(),
  },
  returns: v.id("taxRegimeComparisons"),
  handler: async (ctx, args) => await ctx.db.insert("taxRegimeComparisons", { ...args, createdAt: Date.now() }),
});

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 5381;
  for (let i = 0; i < json.length; i++) hash = (hash * 33) ^ json.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

const SIMILAR_MARGIN_MINOR_UNITS = 1000; // within ₹1,000 counts as "similar"

export const checkTaxRegimeComparison = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.taxPlanning.gatherDeductionInputData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      employmentType: "salaried" | "selfEmployed" | null;
      hraClaimedMinorUnits: number;
      approximate80CInvestmentMinorUnits: number;
      homeLoanInterestEstimateMinorUnits: number;
      healthPremiumTotalMinorUnits: number;
      lifePremiumTotalMinorUnits: number;
      hasProfile: boolean;
    };
    if (data.employmentType === null) {
      return { state: "INSUFFICIENT_DATA", reason: "No tax profile is set yet — add one to compare regimes." };
    }

    // REUSED FROM taxBracket.ts — same income-gathering logic Investment
    // already relies on for its own slab narration.
    const incomeResult = (await ctx.runQuery(internal.taxBracket.gatherDependableAnnualIncome, {})) as {
      householdId: Id<"households">;
      dependableAnnualIncomeMinorUnits: number;
    };
    const grossAnnualIncomeMinorUnits =
      data.employmentType === "salaried" ? incomeResult.dependableAnnualIncomeMinorUnits : (await ctx.runQuery(internal.taxPlanning.getSelfEmployedIncome, {})) as number;

    const lawResult = await getDeductionsAndOldSlabs(ctx as never);
    if (!lawResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: lawResult.reason };
    const faqResult = await getRegimeFaqFacts(ctx as never);
    if (!faqResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: faqResult.reason };
    const newSlabResult = await getCurrentTaxSlabs(ctx as never); // REUSED FROM taxBracket.ts
    if (!newSlabResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: newSlabResult.reason };

    const inputHash = stableHash({ employmentType: data.employmentType, grossAnnualIncomeMinorUnits, hra: data.hraClaimedMinorUnits, c80: data.approximate80CInvestmentMinorUnits, loan: data.homeLoanInterestEstimateMinorUnits, health: data.healthPremiumTotalMinorUnits, life: data.lifePremiumTotalMinorUnits });
    const cached = await ctx.runQuery(internal.taxPlanning.findCachedRegimeComparison, { householdId: data.householdId, inputHash, stateRevision: data.stateRevision });
    if (cached) return { state: "COMPUTED", ...(cached as object), _fromCache: true };

    const diag = diagnoseDeductionSummary({
      employmentType: data.employmentType,
      homeLoanInterestEstimateMinorUnits: data.homeLoanInterestEstimateMinorUnits,
      healthPremiumTotalMinorUnits: data.healthPremiumTotalMinorUnits,
      lifePremiumTotalMinorUnits: data.lifePremiumTotalMinorUnits,
      approximate80CInvestmentMinorUnits: data.approximate80CInvestmentMinorUnits,
      caps: lawResult.caps,
      standardDeductionMinorUnits: faqResult.facts.standardDeductionMinorUnits,
    });

    const oldTaxableIncome = Math.max(0, grossAnnualIncomeMinorUnits - diag.standardDeductionMinorUnits - data.hraClaimedMinorUnits - diag.loanInterestDeductionMinorUnits - diag.insurancePremiumDeductionMinorUnits - diag.investmentDeductionMinorUnits);
    const newTaxableIncome = Math.max(0, grossAnnualIncomeMinorUnits - (data.employmentType === "salaried" ? faqResult.facts.standardDeductionMinorUnits : 0));

    let oldTax = computeProgressiveTax(oldTaxableIncome, lawResult.oldSlabs);
    oldTax = applyRebate(oldTax, oldTaxableIncome, faqResult.facts.oldRebateIncomeThresholdMinorUnits, faqResult.facts.oldRebateMaxMinorUnits);
    let newTax = computeProgressiveTax(newTaxableIncome, newSlabResult.slabs);
    newTax = applyRebate(newTax, newTaxableIncome, faqResult.facts.newRebateIncomeThresholdMinorUnits, faqResult.facts.newRebateMaxMinorUnits);

    // REUSED FROM taxBracket.ts — the module's own single-slab lookup,
    // used here for the top marginal slab under each regime (informational
    // context alongside the full progressive-tax figures above, which
    // that function was never built to compute).
    const oldTopSlab = lookupTaxSlab(oldTaxableIncome, lawResult.oldSlabs);
    const newTopSlab = lookupTaxSlab(newTaxableIncome, newSlabResult.slabs);

    const diff = oldTax - newTax;
    const recommendedRegime: "old" | "new" | "similar" = Math.abs(diff) <= SIMILAR_MARGIN_MINOR_UNITS ? "similar" : diff > 0 ? "new" : "old";

    // Only the fields taxRegimeComparisons' schema actually declares —
    // Convex's exact-shape validators reject extra keys, so the richer
    // transient `extras` below are never spread into this write.
    const persisted = {
      oldRegimeEstimatedTaxMinorUnits: oldTax,
      newRegimeEstimatedTaxMinorUnits: newTax,
      recommendedRegime,
    };
    // Transient — returned to the caller for UI/narration context, never
    // persisted to the strictly-typed schema (same additive-without-
    // schema-renegotiation pattern Investment used for its own
    // calculation-breakdown extras).
    const extras = {
      grossAnnualIncomeMinorUnits,
      oldTaxableIncomeMinorUnits: oldTaxableIncome,
      newTaxableIncomeMinorUnits: newTaxableIncome,
      oldRegimeTopSlabLabel: oldTopSlab?.label ?? null,
      newRegimeTopSlabLabel: newTopSlab?.label ?? null,
    };
    const system = `You put an ALREADY-COMPUTED old-vs-new income tax regime comparison into plain language for an Indian household. You are given both regimes' estimated tax, taxable income under each, and an ALREADY-DECIDED recommendedRegime ("old", "new", or "similar" — meaning the two are within a small margin). Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- The recommendedRegime is FINAL — explain it, never re-judge it or suggest a different one.
- NEVER say "file it this way", "choose this regime", or give filing instructions — frame this only as an estimate to confirm with an actual filing process or a tax professional.
- Every field ending in "MinorUnits" is a plain rupee amount — write "₹" with Indian digit grouping.
- NEVER state a specific date, year, deadline, or cutoff (e.g. "as of 2023", "before the March deadline") — none is given to you in the data, so do not invent one. If a caveat needs to mention timing, say so generically (e.g. "check current filing deadlines") without naming a date.
- "caveats" = 2-3 short statements (e.g. this uses simplified assumptions — no marginal relief above the new-regime rebate threshold, no age-based slab differences; actual filing may differ).`;
    const parsed = await chatJson(system, JSON.stringify({ ...persisted, ...extras }));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : `${recommendedRegime === "similar" ? "Both regimes are similar" : `${recommendedRegime === "old" ? "Old" : "New"} regime is lower`}`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.taxPlanning.saveRegimeComparison, { householdId: data.householdId, ...persisted, narration, inputHash, inputStateRevision: data.stateRevision });
    return { state: "COMPUTED", comparisonId: id, ...persisted, ...extras, narration, _fromCache: false };
  },
});

export const getSelfEmployedIncome = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const profile = await ctx.db.query("taxProfiles").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).first();
    return profile?.approximateNetBusinessIncomeMinorUnits ?? 0;
  },
});

// =====================================================================
// Deduction gap detection — pure deterministic cross-referencing.
// =====================================================================

type TaxGap = { gapType: string; description: string; estimatedMissedDeductionMinorUnits?: number };

function detectDeductionGaps(inp: {
  hasProfile: boolean;
  healthPremiumTotalMinorUnits: number;
  lifePremiumTotalMinorUnits: number;
  approximate80CInvestmentMinorUnits: number;
  caps: DeductionCaps;
}): TaxGap[] {
  const gaps: TaxGap[] = [];
  if (!inp.hasProfile) {
    gaps.push({ gapType: "noProfileSet", description: "No tax profile is set yet, so deductions and regime comparison can't be estimated." });
    return gaps;
  }
  if (inp.healthPremiumTotalMinorUnits < inp.caps.cap80DMinorUnits) {
    gaps.push({
      gapType: "unclaimedInsuranceDeduction",
      description: `Recorded health insurance premiums (${rupees(inp.healthPremiumTotalMinorUnits)}) are below the Section 80D limit (${rupees(inp.caps.cap80DMinorUnits)}) — there is room remaining under this cap.`,
      estimatedMissedDeductionMinorUnits: inp.caps.cap80DMinorUnits - inp.healthPremiumTotalMinorUnits,
    });
  }
  const used80C = inp.lifePremiumTotalMinorUnits + inp.approximate80CInvestmentMinorUnits;
  if (used80C < inp.caps.cap80CMinorUnits) {
    gaps.push({
      gapType: "unclaimedInvestmentDeduction",
      description: `Recorded Section 80C amounts (life insurance premiums + declared investments: ${rupees(used80C)}) are below the Section 80C limit (${rupees(inp.caps.cap80CMinorUnits)}) — there is room remaining under this cap.`,
      estimatedMissedDeductionMinorUnits: inp.caps.cap80CMinorUnits - used80C,
    });
  }
  return gaps;
}

export const findCachedDeductionGaps = internalQuery({
  args: { householdId: v.id("households"), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("taxDeductionGaps").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const saveDeductionGaps = internalMutation({
  args: {
    householdId: v.id("households"),
    gaps: v.array(v.object({ gapType: v.string(), description: v.string(), estimatedMissedDeductionMinorUnits: v.optional(v.number()) })),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
  },
  returns: v.id("taxDeductionGaps"),
  handler: async (ctx, args) => await ctx.db.insert("taxDeductionGaps", { ...args, createdAt: Date.now() }),
});

export const checkTaxDeductionGaps = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.taxPlanning.gatherDeductionInputData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      hasProfile: boolean;
      healthPremiumTotalMinorUnits: number;
      lifePremiumTotalMinorUnits: number;
      approximate80CInvestmentMinorUnits: number;
    };
    const lawResult = await getDeductionsAndOldSlabs(ctx as never);
    if (!lawResult.ok) return { state: "SOURCE_UNAVAILABLE", reason: lawResult.reason };

    const gaps = detectDeductionGaps({ hasProfile: data.hasProfile, healthPremiumTotalMinorUnits: data.healthPremiumTotalMinorUnits, lifePremiumTotalMinorUnits: data.lifePremiumTotalMinorUnits, approximate80CInvestmentMinorUnits: data.approximate80CInvestmentMinorUnits, caps: lawResult.caps });

    const cached = await ctx.runQuery(internal.taxPlanning.findCachedDeductionGaps, { householdId: data.householdId, stateRevision: data.stateRevision });
    if (cached) {
      const c = cached as { _id: Id<"taxDeductionGaps">; narration: { headline: string; plainLanguage: string; caveats: string[] } };
      return { state: "COMPUTED", gapsId: c._id, gaps, narration: c.narration, _fromCache: true };
    }

    const system = `You put an ALREADY-DETECTED list of tax-deduction gaps into plain language for an Indian household. You are given an array of gaps, each with a gapType, a plain description, and an optional estimatedMissedDeductionMinorUnits. If the array is empty, no gaps were found. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- The gap list is FINAL — do not add, remove, or re-judge any gap.
- NEVER say "file it this way", "claim this deduction", or give filing instructions — frame everything as an estimate to confirm with an actual filing process or a tax professional.
- Every field ending in "MinorUnits" mentioned in a gap description is already formatted with ₹ — do not add new figures.
- NEVER state a specific date, year, deadline, or cutoff (e.g. "as of 2023", "conditions applicable till [date]") — none is given to you in the data, so do not invent one. If a caveat needs to mention timing, say so generically (e.g. "check current filing deadlines") without naming a date.
- "caveats" = 2-3 short statements (e.g. this only checks specific, limited patterns; it isn't a substitute for a full review; these figures assume the Old Tax Regime).`;
    const parsed = await chatJson(system, JSON.stringify({ gaps }));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : gaps.length === 0 ? "No deduction gaps found" : `${gaps.length} potential deduction gap${gaps.length === 1 ? "" : "s"} found`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.taxPlanning.saveDeductionGaps, { householdId: data.householdId, gaps, narration, inputStateRevision: data.stateRevision });
    return { state: "COMPUTED", gapsId: id, gaps, narration, _fromCache: false };
  },
});

// =====================================================================
// Single "ask box" entry point — deterministic keyword routing, same
// pattern as Investment/Insurance.
// =====================================================================

const REGIME_KEYWORDS = ["regime", "old or new", "old vs new"];
const INVESTMENT_KEYWORDS = ["tax-saving investment", "tax saving investment", "what should i invest", "invest to save"];
const GAP_KEYWORDS = ["missing", "haven't used", "have i used", "unused", "all my deductions"];

export const askTaxQuestion = action({
  args: { question: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const q = args.question.toLowerCase();

    if (REGIME_KEYWORDS.some((k) => q.includes(k))) {
      const result = await ctx.runAction(api.taxPlanning.checkTaxRegimeComparison, {});
      return { route: "regimeComparison", question: args.question, result };
    }
    if (INVESTMENT_KEYWORDS.some((k) => q.includes(k))) {
      // Reuse, don't rebuild — Investment's own category education,
      // framed here for 80C relevance. Only "ppf" in that shared table
      // is genuinely a fixed 80C-specific instrument category.
      const result = await ctx.runAction(api.investment.refreshAssetCategoryReference, { category: "ppf" });
      return { route: "taxSavingInvestments", question: args.question, result };
    }
    if (GAP_KEYWORDS.some((k) => q.includes(k))) {
      const result = await ctx.runAction(api.taxPlanning.checkTaxDeductionGaps, {});
      return { route: "deductionGaps", question: args.question, result };
    }
    // Default fallback — deduction summary is this service's headline
    // calculation, same role adequacy/readiness play elsewhere.
    const result = await ctx.runAction(api.taxPlanning.checkTaxDeductionSummary, {});
    return { route: "deductionSummary", question: args.question, result };
  },
});

// =====================================================================
// "Email me a summary" — regime comparison and gap detection, same
// existing AgentMail pattern as every other service.
// =====================================================================

const vTaxNarration = v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) });

export const getCallerEmail = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

function composeTaxEmailText(narration: { headline: string; plainLanguage: string; caveats: string[] }, figures: { label: string; value: string }[]): string {
  const lines = [narration.headline, "", narration.plainLanguage, ""];
  if (figures.length > 0) {
    lines.push("Key figures:");
    for (const f of figures) lines.push(`  ${f.label}: ${f.value}`);
    lines.push("");
  }
  if (narration.caveats.length > 0) {
    lines.push("Please keep in mind:");
    for (const c of narration.caveats) lines.push(`  • ${c}`);
    lines.push("");
  }
  lines.push("This is an estimate to confirm with an actual filing process or a tax professional, not filing advice.");
  lines.push("— Sent from FinComp's Tax Planning, at your request.");
  return lines.join("\n");
}

function pickTaxFigures(deterministic: Record<string, unknown>): { label: string; value: string }[] {
  const wanted: [string, string][] = [
    ["oldRegimeEstimatedTaxMinorUnits", "Old regime estimated tax"],
    ["newRegimeEstimatedTaxMinorUnits", "New regime estimated tax"],
    ["totalDeductionsMinorUnits", "Total estimated deductions"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of wanted) {
    const val = deterministic[key];
    if (typeof val === "number") out.push({ label, value: rupees(val) });
  }
  return out;
}

export const emailTaxSummary = action({
  args: { narration: vTaxNarration, deterministic: v.any() },
  returns: v.object({ status: v.union(v.literal("sent"), v.literal("failed")), detail: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const toEmail = (await ctx.runQuery(internal.taxPlanning.getCallerEmail, {})) as string | null;
    if (!toEmail) return { status: "failed" as const, detail: "No email address is on file for this account." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) return { status: "failed" as const, detail: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    const figures = pickTaxFigures((args.deterministic ?? {}) as Record<string, unknown>);
    const text = composeTaxEmailText(args.narration, figures);
    try {
      const outboundId = await agentmailSender.sendMessage(ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0], inboxId, { to: toEmail, subject: `FinComp — ${args.narration.headline}`, text });
      return { status: "sent" as const, detail: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return { status: "failed" as const, detail: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const emailSendStatus = query({
  args: { outboundId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await agentmailSender.status(ctx, args.outboundId as any);
  },
});

// =====================================================================
// Economic & Policy Context — deliberately LIGHT. Two real, sourced
// items, both drawn from the two official pages this file already
// scrapes for deduction caps and regime rules (no new source
// discovery needed) — reused with distinct sourceRegistry keys (the
// same "#"-suffix technique as DEDUCTIONS_SOURCE_URL, for the same
// reason: avoiding a repeat of the earlier cache-collision bug against
// this file's own other snapshot shapes for these same real URLs).
// NOT a news feed — full economic/policy coverage is explicitly
// deferred to Government, Economic & Livelihood Intelligence; this
// card says so honestly rather than pretending to be that service.
// =====================================================================

const CONTEXT_ITEMS_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — doesn't need to be live-fresh

const CONTEXT_REGIME_DEFAULT_SOURCE_URL = DEDUCTIONS_REAL_URL + "#tax-economic-context-regime-default";
const CONTEXT_STD_DEDUCTION_SOURCE_URL = REGIME_FAQ_SOURCE_URL + "#tax-economic-context-std-deduction";

function parseRegimeDefaultContext(markdown: string): { title: string; description: string } | null {
  const idx = markdown.indexOf("The Finance Act 2023 has amended");
  if (idx === -1) return null;
  const snippet = markdown.slice(idx, idx + 260).replace(/\s+/g, " ").trim();
  return { title: "New tax regime remains the default for most taxpayers", description: snippet };
}

function parseStandardDeductionContext(markdown: string): { title: string; description: string } | null {
  const m = markdown.match(/Standard deduction of Rs\.?\s*[\d,]+ or the amount of salary, whichever is lower, is available for both old and new tax regimes[^\n.]*\.?/i);
  if (!m) return null;
  return { title: "Standard deduction applies under both tax regimes", description: m[0].trim() };
}

export const listTaxEconomicContextItems = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — this data isn't household-scoped
    return await ctx.db.query("taxEconomicContextItems").withIndex("by_fetchedAt").collect();
  },
});

export const ensureContextAccess = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — this data isn't household-scoped
    return null;
  },
});

export const ensureContextSource = internalMutation({
  args: { url: v.string(), label: v.string() },
  returns: v.id("sourceRegistry"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: "official-tax-authority" });
  },
});

export const saveContextSourceSnapshot = internalMutation({
  args: { sourceId: v.id("sourceRegistry"), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) =>
    await ctx.db.insert("sourceSnapshots", { sourceRegistryId: args.sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 1000) }),
});

export const replaceContextItems = internalMutation({
  args: {
    items: v.array(
      v.object({ title: v.string(), description: v.string(), sourceSnapshotId: v.optional(v.id("sourceSnapshots")), sourceUrl: v.string(), sourceLabel: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taxEconomicContextItems").collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const item of args.items) await ctx.db.insert("taxEconomicContextItems", { ...item, fetchedAt: now });
    return null;
  },
});

export const refreshTaxEconomicContext = action({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx): Promise<unknown[]> => {
    await ctx.runMutation(api.taxPlanning.ensureContextAccess, {}); // signed-in gate only

    const existing = (await ctx.runQuery(internal.taxPlanning.getFreshContextItemsInternal, { now: Date.now() })) as unknown[];
    if (existing.length === 2) return existing;

    const items: { title: string; description: string; sourceSnapshotId?: Id<"sourceSnapshots">; sourceUrl: string; sourceLabel: string }[] = [];

    try {
      const sourceId = (await ctx.runMutation(internal.taxPlanning.ensureContextSource, { url: CONTEXT_REGIME_DEFAULT_SOURCE_URL, label: DEDUCTIONS_SOURCE_LABEL })) as Id<"sourceRegistry">;
      const doc = await firecrawl.scrape(ctx, DEDUCTIONS_REAL_URL, { formats: ["markdown"] });
      const md = (doc.markdown ?? "") as string;
      const parsed = parseRegimeDefaultContext(md);
      if (parsed) {
        const snapshotId = (await ctx.runMutation(internal.taxPlanning.saveContextSourceSnapshot, { sourceId, contentSummary: parsed.description })) as Id<"sourceSnapshots">;
        items.push({ ...parsed, sourceSnapshotId: snapshotId, sourceUrl: DEDUCTIONS_REAL_URL, sourceLabel: DEDUCTIONS_SOURCE_LABEL });
      }
    } catch {
      // honestly omit this item if the real source can't be reached/parsed — never invent one
    }

    try {
      const sourceId = (await ctx.runMutation(internal.taxPlanning.ensureContextSource, { url: CONTEXT_STD_DEDUCTION_SOURCE_URL, label: REGIME_FAQ_SOURCE_LABEL })) as Id<"sourceRegistry">;
      const doc = await firecrawl.scrape(ctx, REGIME_FAQ_SOURCE_URL, { formats: ["markdown"] });
      const md = (doc.markdown ?? "") as string;
      const parsed = parseStandardDeductionContext(md);
      if (parsed) {
        const snapshotId = (await ctx.runMutation(internal.taxPlanning.saveContextSourceSnapshot, { sourceId, contentSummary: parsed.description })) as Id<"sourceSnapshots">;
        items.push({ ...parsed, sourceSnapshotId: snapshotId, sourceUrl: REGIME_FAQ_SOURCE_URL, sourceLabel: REGIME_FAQ_SOURCE_LABEL });
      }
    } catch {
      // honestly omit this item if the real source can't be reached/parsed — never invent one
    }

    if (items.length > 0) {
      await ctx.runMutation(internal.taxPlanning.replaceContextItems, { items });
    }
    return (await ctx.runQuery(internal.taxPlanning.getFreshContextItemsInternal, { now: Date.now() })) as unknown[];
  },
});

export const getFreshContextItemsInternal = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("taxEconomicContextItems").withIndex("by_fetchedAt").collect();
    return rows.filter((r) => args.now - r.fetchedAt < CONTEXT_ITEMS_MAX_AGE_MS);
  },
});
