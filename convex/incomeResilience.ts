// Income Resilience (Service #10). Cross-service SYNTHESIS, not a new
// domain of its own — reads live from Financial Foundation (runway),
// Loan & Debt Resilience, Insurance, Side-Income & Business Planning,
// and Government, Economic & Livelihood Intelligence. Nothing in any
// of those services is modified; every read below is either their own
// existing public query (api.runway.calculateRunway,
// api.loanDebt.getDebtOverview) or a direct read of a table they
// already own, exactly like Side-Income's gatherReserveData and every
// other cross-service reuse in this app.
//
// AI BOUNDARY: identical to every other service. The tier (resilient /
// worthALook / atRisk) and every "weak dimension" are decided by the
// deterministic function below — OpenAI narrates the already-decided
// result only, never re-judges it, never invents a figure not given to
// it, and never gives specific investment/product advice.
//
// SECURITY: every action/query touching a household's own data calls
// requireMembership (or an internalQuery that does) first, same as
// every service since the Side-Income gap was found. The cron sweep
// runs with no caller identity by design, exactly like Government,
// Economic & Livelihood Intelligence's own sweep.

import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";

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

const vNarration = v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) });

// =====================================================================
// Deterministic scoring. Every threshold documented here, hand-
// verifiable, nothing decided by the model.
// =====================================================================

// EMI-to-income is a round, informational cutoff — same discipline as
// Loan & Debt's own LARGE_LOAN_THRESHOLD_MINOR_UNITS — not a claim of
// authoritative financial-advice status.
const EMI_RATIO_WEAK_THRESHOLD_PERCENT = 50;
// Concentration cutoff: almost entirely dependent on one income source.
const INCOME_CONCENTRATION_WEAK_THRESHOLD_PERCENT = 80;
// Used ONLY if the real, sourced benchmark below is unavailable — a
// conservative, clearly-labeled unsourced fallback, never presented as
// sourced guidance.
const FALLBACK_RUNWAY_BENCHMARK_MONTHS = 3;
const RECENT_FINDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BENCHMARK_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — this kind of guidance doesn't move fast

function monthlyEquivalent(amount: number, cadence: "monthly" | "weekly" | "annual" | "irregular"): number | null {
  switch (cadence) {
    case "monthly":
      return amount;
    case "weekly":
      return Math.round((amount * 52) / 12);
    case "annual":
      return Math.round(amount / 12);
    case "irregular":
      return null;
  }
}

type Tier = "resilient" | "worthALook" | "atRisk";

type ScoreInputs = {
  incomeConcentrationPercent: number;
  runwayStatus: "not_depleting" | "depleting";
  runwayMonths: number; // 999 sentinel when not_depleting
  emiToIncomeRatioPercent: number;
  hasBreachedObligation: boolean; // runway status === "depleting": obligations + essential expenses currently exceed dependable income
  hasIncomeProtectionInsurance: boolean;
  liquidInvestmentsMinorUnits: number;
  hasBackupIncomeInProgress: boolean;
  hasRecentSignificantEconomicFinding: boolean;
  recommendedRunwayMonths: number;
};

function scoreResilience(inputs: ScoreInputs): { tier: Tier; weakDimensions: string[] } {
  const weak: string[] = [];
  if (inputs.incomeConcentrationPercent >= INCOME_CONCENTRATION_WEAK_THRESHOLD_PERCENT) weak.push("incomeConcentration");
  if (inputs.hasBreachedObligation) weak.push("structuralDeficit");
  if (inputs.runwayStatus === "depleting" && inputs.runwayMonths < inputs.recommendedRunwayMonths) weak.push("runway");
  if (inputs.emiToIncomeRatioPercent >= EMI_RATIO_WEAK_THRESHOLD_PERCENT) weak.push("emiRatio");
  if (!inputs.hasIncomeProtectionInsurance) weak.push("insurance");
  if (!inputs.hasBackupIncomeInProgress) weak.push("backupIncome");
  if (inputs.liquidInvestmentsMinorUnits === 0) weak.push("liquidReserve");
  if (inputs.hasRecentSignificantEconomicFinding) weak.push("externalRisk");

  const tier: Tier = weak.length <= 1 ? "resilient" : weak.length <= 3 ? "worthALook" : "atRisk";
  return { tier, weakDimensions: weak };
}

const WEAK_DIMENSION_LABEL: Record<string, string> = {
  incomeConcentration: "Almost all dependable income comes from a single source.",
  structuralDeficit: "Current essential expenses and EMIs exceed dependable income.",
  runway: "Liquid savings would run out sooner than the recommended cushion.",
  emiRatio: "EMI payments take up a large share of dependable income.",
  insurance: "No active life or personal-accident policy recorded.",
  backupIncome: "No active or graduated backup income in progress.",
  liquidReserve: "No semi-liquid reserve beyond the emergency runway.",
  externalRisk: "A real, recent significant economic/livelihood risk was found.",
};

// =====================================================================
// Data gathering — every read here is either a direct read of a table
// another service already owns (same as Side-Income's own
// gatherReserveData), or that service's own existing public query.
// =====================================================================

// Takes householdId directly rather than deriving it from the caller's
// own identity via requireMembership — this function is shared by BOTH
// the user-triggered action (which verifies ownership itself via
// ensureAccess before calling this) and the cron sweep (which has no
// caller identity at all, by design, same as every other service's
// system-triggered path). It's an internalQuery: never exposed to a
// client directly, so there's no way for a caller to pass an arbitrary
// householdId themselves.
export const gatherResilienceDataInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const householdId = args.householdId;
    const [incomeSources, expenses, obligations, assets, insurancePolicies, sideIncomeEntries, economicFindings] = await Promise.all([
      ctx.db.query("incomeSources").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("expenses").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("assets").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("insurancePolicies").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("sideIncomeEntries").withIndex("by_household", (q) => q.eq("householdId", householdId)).take(1000),
      ctx.db.query("economicFindings").withIndex("by_household_generatedAt", (q) => q.eq("householdId", householdId)).take(1000),
    ]);
    return { householdId, incomeSources, expenses, obligations, assets, insurancePolicies, sideIncomeEntries, economicFindings };
  },
});

// Runway/EMI figures below are computed directly from the same raw
// tables Financial Foundation's own convex/runway.ts and Loan & Debt's
// getDebtOverview read — the SAME formulas (monthlyEquivalent cadence
// normalization, essential-expenses + EMI − dependable-income gap), not
// a different definition of "runway". They can't be reused as cross-
// file calls here because both of those are public queries hard-gated
// to the CALLER's own identity via requireMembership, with no
// householdId override — correct security design on their part that
// this file isn't allowed to work around. This function is shared by
// both the user-triggered action (real caller identity, verified via
// ensureAccess) and the cron sweep (no caller identity, by design), so
// it computes the figures itself from data already scoped to the
// trusted householdId passed in.
async function computeForHousehold(
  ctx: { runQuery: Function; runMutation: Function },
  householdId: Id<"households">,
  now: number,
): Promise<{ inputs: ScoreInputs; tier: Tier; weakDimensions: string[] }> {
  const data = (await ctx.runQuery(internal.incomeResilience.gatherResilienceDataInternal, { householdId })) as {
    householdId: Id<"households">;
    incomeSources: Doc<"incomeSources">[];
    expenses: Doc<"expenses">[];
    obligations: Doc<"obligations">[];
    assets: Doc<"assets">[];
    insurancePolicies: Doc<"insurancePolicies">[];
    sideIncomeEntries: Doc<"sideIncomeEntries">[];
    economicFindings: Doc<"economicFindings">[];
  };

  const dependableSources = data.incomeSources.filter((s) => s.reliability === "dependable" && s.activeFrom <= now && (s.activeTo === undefined || s.activeTo > now));
  const monthlyBySource = dependableSources.map((s) => monthlyEquivalent(s.amountMinorUnits, s.cadence as "monthly" | "weekly" | "annual" | "irregular") ?? 0);
  const totalDependableMonthly = monthlyBySource.reduce((s, v) => s + v, 0);
  const largestSourceMonthly = monthlyBySource.length > 0 ? Math.max(...monthlyBySource) : 0;
  const incomeConcentrationPercent = totalDependableMonthly > 0 ? (largestSourceMonthly / totalDependableMonthly) * 100 : 100;

  const essentialMonthlyExpenses = data.expenses
    .filter((e) => e.classification === "essential")
    .reduce((s, e) => s + (monthlyEquivalent(e.amountMinorUnits, e.recurrence === "oneOff" ? "irregular" : e.recurrence) ?? 0), 0);
  const combinedMonthlyPaymentMinorUnits = data.obligations.reduce((s, o) => s + (o.minimumPaymentMinorUnits ?? o.emiMinorUnits), 0);
  const unrestrictedLiquidSavings = data.assets.filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId === undefined).reduce((s, a) => s + a.valueMinorUnits, 0);
  const monthlyNetGap = essentialMonthlyExpenses + combinedMonthlyPaymentMinorUnits - totalDependableMonthly;
  const runwayStatus: "not_depleting" | "depleting" = monthlyNetGap > 0 ? "depleting" : "not_depleting";
  const runwayMonthsIfDepleting = monthlyNetGap > 0 ? unrestrictedLiquidSavings / monthlyNetGap : null;

  const emiToIncomeRatioPercent =
    totalDependableMonthly > 0
      ? (combinedMonthlyPaymentMinorUnits / totalDependableMonthly) * 100
      : combinedMonthlyPaymentMinorUnits > 0
        ? 100
        : 0;

  const hasIncomeProtectionInsurance = data.insurancePolicies.some((p) => p.type === "life" || p.type === "personalAccident");
  const hasBackupIncomeInProgress = data.sideIncomeEntries.some((e) => e.status === "active" || e.status === "graduated");
  const liquidInvestmentsMinorUnits = data.assets.filter((a) => a.liquidity === "semiLiquid" && a.earmarkedForGoalId === undefined).reduce((s, a) => s + a.valueMinorUnits, 0);
  const hasRecentSignificantEconomicFinding = data.economicFindings.some((f) => f.severity === "significant" && now - f.generatedAt < RECENT_FINDING_WINDOW_MS);

  const benchmark = (await ctx.runQuery(internal.incomeResilience.getFreshBenchmarkInternal, { now })) as { recommendedMonths?: number } | null;
  const recommendedRunwayMonths = benchmark?.recommendedMonths ?? FALLBACK_RUNWAY_BENCHMARK_MONTHS;

  const inputs: ScoreInputs = {
    incomeConcentrationPercent,
    runwayStatus,
    runwayMonths: runwayStatus === "depleting" ? (runwayMonthsIfDepleting as number) : 999,
    emiToIncomeRatioPercent,
    hasBreachedObligation: runwayStatus === "depleting",
    hasIncomeProtectionInsurance,
    liquidInvestmentsMinorUnits,
    hasBackupIncomeInProgress,
    hasRecentSignificantEconomicFinding,
    recommendedRunwayMonths,
  };
  const { tier, weakDimensions } = scoreResilience(inputs);
  return { inputs, tier, weakDimensions };
}

// =====================================================================
// Benchmark — one real, sourced figure (recommended emergency-fund
// coverage), never hardcoded from training data. Firecrawl SEARCH (not
// a fixed URL — no single validated page for this exists yet in this
// app), deterministic regex extraction of a months figure if the real
// results state one; if not, the description is kept as honest context
// with no invented number.
// =====================================================================

const BENCHMARK_QUERY = "recommended emergency fund months of expenses India financial planning";

function parseRecommendedMonths(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*(?:to\s*\d{1,2}\s*)?months?/i);
  if (!m) return null;
  const months = Number(m[1]);
  return months >= 1 && months <= 24 ? months : null;
}

export const getFreshBenchmarkInternal = internalQuery({
  args: { now: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("incomeResilienceBenchmarks").withIndex("by_fetchedAt").collect();
    const fresh = rows.filter((r) => args.now - r.fetchedAt < BENCHMARK_MAX_AGE_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return fresh ?? null;
  },
});

export const saveBenchmarkInternal = internalMutation({
  args: {
    label: v.string(),
    description: v.string(),
    recommendedMonths: v.optional(v.number()),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    sourceUrl: v.string(),
    sourceLabel: v.string(),
  },
  returns: v.id("incomeResilienceBenchmarks"),
  handler: async (ctx, args) => await ctx.db.insert("incomeResilienceBenchmarks", { ...args, fetchedAt: Date.now() }),
});

export const ensureSourceInternal = internalMutation({
  args: { url: v.string(), label: v.string(), authorityLevel: v.string() },
  returns: v.id("sourceRegistry"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: args.authorityLevel });
  },
});

export const saveSnapshotInternal = internalMutation({
  args: { sourceId: v.id("sourceRegistry"), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => await ctx.db.insert("sourceSnapshots", { sourceRegistryId: args.sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 1500) }),
});

async function ensureFreshBenchmark(ctx: { runQuery: Function; runMutation: Function }): Promise<void> {
  const existing = await ctx.runQuery(internal.incomeResilience.getFreshBenchmarkInternal, { now: Date.now() });
  if (existing) return;
  try {
    const results = await firecrawl.search(ctx as never, BENCHMARK_QUERY, { limit: 5, sources: ["web"] });
    const items = (results.web ?? []).slice(0, 5) as { title?: string; description?: string; url?: string }[];
    if (items.length === 0) return; // never fabricate — simply no benchmark this cycle
    const combined = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""}`).join("\n");
    const recommendedMonths = parseRecommendedMonths(combined) ?? undefined;
    const sourceId = (await ctx.runMutation(internal.incomeResilience.ensureSourceInternal, {
      url: `firecrawl-search:${BENCHMARK_QUERY}`,
      label: "Web search: recommended emergency fund coverage",
      authorityLevel: "web-search-aggregate",
    })) as Id<"sourceRegistry">;
    const snapshotId = (await ctx.runMutation(internal.incomeResilience.saveSnapshotInternal, { sourceId, contentSummary: combined.slice(0, 1500) })) as Id<"sourceSnapshots">;
    await ctx.runMutation(internal.incomeResilience.saveBenchmarkInternal, {
      label: "Recommended emergency fund coverage",
      description: (items[0]?.description ?? combined).slice(0, 500),
      recommendedMonths,
      sourceSnapshotId: snapshotId,
      sourceUrl: items[0]?.url ?? `firecrawl-search:${BENCHMARK_QUERY}`,
      sourceLabel: "Web search: recommended emergency fund coverage",
    });
  } catch {
    // Unreachable — say nothing, the deterministic fallback threshold still applies.
  }
}

export const listIncomeResilienceBenchmarks = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — not household-scoped data
    return await ctx.db.query("incomeResilienceBenchmarks").withIndex("by_fetchedAt").collect();
  },
});

// =====================================================================
// Public, on-demand check — fully reactive on the frontend (this action
// is called explicitly, but a plain `useQuery` of listSnapshots/
// listResilienceBenchmarks stays live; the interactive score itself is
// recomputed fresh on demand rather than cached, since it's cheap).
// =====================================================================

export const ensureAccess = mutation({
  args: {},
  returns: v.id("households"),
  handler: async (ctx) => (await requireMembership(ctx)).householdId,
});

// =====================================================================
// Note — the one thing only the household can tell us. AI extracts a
// concern CATEGORY only (same extraction-only boundary as Document
// Intelligence / livelihood profiles) — it never touches the
// deterministic tier or weak-dimension list, only adds honest context
// to the narration below, read by BOTH the on-demand check and the
// weekly cron sweep (so a concern written today still colors next
// week's automatic check, until updated).
// =====================================================================

export const getNoteInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => await ctx.db.query("incomeResilienceNotes").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).first(),
});

export const getMyNote = query({
  args: {},
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("incomeResilienceNotes").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).first();
  },
});

export const saveNoteInternal = internalMutation({
  args: {
    householdId: v.id("households"),
    freeText: v.string(),
    interpretedConcernCategory: v.optional(v.union(v.literal("jobSecurity"), v.literal("healthOrDependent"), v.literal("majorLifeEvent"), v.literal("businessConcern"), v.literal("none"))),
  },
  returns: v.id("incomeResilienceNotes"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("incomeResilienceNotes").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { freeText: args.freeText, interpretedConcernCategory: args.interpretedConcernCategory, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("incomeResilienceNotes", { ...args, updatedAt: now });
  },
});

export const saveResilienceNote = action({
  args: { freeText: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const householdId = (await ctx.runMutation(api.incomeResilience.ensureAccess, {})) as Id<"households">;
    const trimmed = args.freeText.trim();
    if (trimmed === "") {
      await ctx.runMutation(internal.incomeResilience.saveNoteInternal, { householdId, freeText: "", interpretedConcernCategory: "none" });
      return { freeText: "", interpretedConcernCategory: "none" };
    }
    const system = `You extract a single concern CATEGORY from a household's free-text note about their income/job situation. This is EXTRACTION ONLY — never infer a concern the text doesn't support. Return ONLY JSON: { "category": "jobSecurity" | "healthOrDependent" | "majorLifeEvent" | "businessConcern" | "none" }. Use "none" if the text doesn't clearly express one of the other four.`;
    const parsed = await chatJson(system, JSON.stringify({ freeText: trimmed }));
    const allowed = ["jobSecurity", "healthOrDependent", "majorLifeEvent", "businessConcern", "none"];
    const category = typeof parsed.category === "string" && allowed.includes(parsed.category) ? (parsed.category as "jobSecurity" | "healthOrDependent" | "majorLifeEvent" | "businessConcern" | "none") : "none";
    await ctx.runMutation(internal.incomeResilience.saveNoteInternal, { householdId, freeText: trimmed, interpretedConcernCategory: category });
    return { freeText: trimmed, interpretedConcernCategory: category };
  },
});

const NARRATION_SYSTEM = `You put an ALREADY-DECIDED household income-resilience result into plain language. You are given the tier ("resilient" | "worthALook" | "atRisk" — already decided, never yours to change), a list of specific weak dimensions with plain descriptions, the real supporting figures, and optionally a real note the household wrote in their own words about a concern. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }. Name the SPECIFIC weak dimensions given, grounded only in what's provided — never invent a number or claim a dimension is weak that wasn't listed. If a household note is given, you MAY reference it honestly (e.g. connecting it to a relevant weak dimension) but NEVER let it change the tier or invent a fact beyond what the note itself says. NEVER recommend a specific investment, insurer, or product. NEVER state a specific date, year, deadline, or cutoff not explicitly present in the given detail. Frame this as a starting point to explore in the relevant FinComp section, not a financial plan.`;

async function narrateResilience(
  ctx: { runQuery: Function },
  householdId: Id<"households">,
  inputs: ScoreInputs,
  tier: Tier,
  weakDimensions: string[],
): Promise<{ headline: string; plainLanguage: string; caveats: string[] }> {
  const note = (await ctx.runQuery(internal.incomeResilience.getNoteInternal, { householdId })) as Doc<"incomeResilienceNotes"> | null;
  const parsed = await chatJson(
    NARRATION_SYSTEM,
    JSON.stringify({
      tier,
      weakDimensions: weakDimensions.map((d) => WEAK_DIMENSION_LABEL[d] ?? d),
      incomeConcentrationPercent: Math.round(inputs.incomeConcentrationPercent),
      runwayMonths: inputs.runwayStatus === "depleting" ? Math.round(inputs.runwayMonths * 10) / 10 : null,
      recommendedRunwayMonths: inputs.recommendedRunwayMonths,
      emiToIncomeRatioPercent: Math.round(inputs.emiToIncomeRatioPercent),
      hasIncomeProtectionInsurance: inputs.hasIncomeProtectionInsurance,
      hasBackupIncomeInProgress: inputs.hasBackupIncomeInProgress,
      liquidInvestmentsMinorUnits: inputs.liquidInvestmentsMinorUnits,
      hasRecentSignificantEconomicFinding: inputs.hasRecentSignificantEconomicFinding,
      householdNote: note && note.freeText ? { text: note.freeText, concernCategory: note.interpretedConcernCategory ?? "none" } : null,
    }),
  );
  return {
    headline: typeof parsed.headline === "string" && parsed.headline ? parsed.headline : `Income resilience: ${tier}`,
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c): c is string => typeof c === "string") : [],
  };
}

export const checkIncomeResilience = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const householdId = (await ctx.runMutation(api.incomeResilience.ensureAccess, {})) as Id<"households">;
    await ensureFreshBenchmark(ctx);
    const now = Date.now();
    const { inputs, tier, weakDimensions } = await computeForHousehold(ctx, householdId, now);
    const narration = await narrateResilience(ctx, householdId, inputs, tier, weakDimensions);

    await maybeSnapshot(ctx, householdId, tier, weakDimensions, inputs, narration);

    return { state: "COMPUTED", tier, weakDimensions: weakDimensions.map((d) => ({ key: d, label: WEAK_DIMENSION_LABEL[d] ?? d })), ...inputs, narration };
  },
});

// =====================================================================
// Snapshot — written ONLY when the tier genuinely changes (or none
// exists yet). This is what gives the proactive alert a real "last
// known tier" and a trend line, without recording noise on every view.
// =====================================================================

export const getLatestSnapshotInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("incomeResilienceSnapshots").withIndex("by_household_generatedAt", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.sort((a, b) => b.generatedAt - a.generatedAt)[0] ?? null;
  },
});

export const listMySnapshots = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const rows = await ctx.db.query("incomeResilienceSnapshots").withIndex("by_household_generatedAt", (q) => q.eq("householdId", membership.householdId)).collect();
    return rows.sort((a, b) => a.generatedAt - b.generatedAt);
  },
});

export const insertSnapshotInternal = internalMutation({
  args: {
    householdId: v.id("households"),
    tier: v.union(v.literal("resilient"), v.literal("worthALook"), v.literal("atRisk")),
    incomeConcentrationPercent: v.number(),
    runwayMonths: v.number(),
    emiToIncomeRatioPercent: v.number(),
    hasBreachedObligation: v.boolean(),
    hasIncomeProtectionInsurance: v.boolean(),
    liquidInvestmentsMinorUnits: v.number(),
    hasBackupIncomeInProgress: v.boolean(),
    hasRecentSignificantEconomicFinding: v.boolean(),
    weakDimensions: v.array(v.string()),
    narration: vNarration,
  },
  returns: v.id("incomeResilienceSnapshots"),
  handler: async (ctx, args) => await ctx.db.insert("incomeResilienceSnapshots", { ...args, emailSent: false, generatedAt: Date.now() }),
});

async function maybeSnapshot(
  ctx: { runQuery: Function; runMutation: Function; runAction: Function },
  householdId: Id<"households">,
  tier: Tier,
  weakDimensions: string[],
  inputs: ScoreInputs,
  narration: { headline: string; plainLanguage: string; caveats: string[] },
): Promise<void> {
  const latest = (await ctx.runQuery(internal.incomeResilience.getLatestSnapshotInternal, { householdId })) as Doc<"incomeResilienceSnapshots"> | null;
  if (latest !== null && latest.tier === tier) return; // no genuine change — no snapshot, no email

  const wasAtRiskBefore = latest?.tier === "atRisk";
  const snapshotId = (await ctx.runMutation(internal.incomeResilience.insertSnapshotInternal, {
    householdId,
    tier,
    incomeConcentrationPercent: inputs.incomeConcentrationPercent,
    runwayMonths: inputs.runwayMonths,
    emiToIncomeRatioPercent: inputs.emiToIncomeRatioPercent,
    hasBreachedObligation: inputs.hasBreachedObligation,
    hasIncomeProtectionInsurance: inputs.hasIncomeProtectionInsurance,
    liquidInvestmentsMinorUnits: inputs.liquidInvestmentsMinorUnits,
    hasBackupIncomeInProgress: inputs.hasBackupIncomeInProgress,
    hasRecentSignificantEconomicFinding: inputs.hasRecentSignificantEconomicFinding,
    weakDimensions,
    narration,
  })) as Id<"incomeResilienceSnapshots">;

  // Proactive alert ONLY on a genuine transition INTO the worst tier —
  // never on entering "worthALook", never repeated while it stays
  // "atRisk" (no new snapshot means no re-email), matching Government
  // Economic & Livelihood Intelligence's "don't over-alert" discipline.
  if (tier === "atRisk" && !wasAtRiskBefore && latest !== null) {
    await ctx.runAction(internal.incomeResilience.sendResilienceAlertInternal, { householdId, snapshotId });
  }
}

// =====================================================================
// Proactive AgentMail alert — same existing pattern as every other
// service, triggered by a genuine tier transition into "atRisk" only.
// =====================================================================

export const getHouseholdEmailInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const membership = await ctx.db.query("memberships").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).first();
    if (!membership) return null;
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

export const getSnapshotInternal = internalQuery({
  args: { snapshotId: v.id("incomeResilienceSnapshots") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => await ctx.db.get("incomeResilienceSnapshots", args.snapshotId),
});

export const markSnapshotEmailedInternal = internalMutation({
  args: { snapshotId: v.id("incomeResilienceSnapshots") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.snapshotId, { emailSent: true });
    return null;
  },
});

function composeAlertText(snapshot: Doc<"incomeResilienceSnapshots">): string {
  const lines = [snapshot.narration.headline, "", snapshot.narration.plainLanguage, ""];
  if (snapshot.weakDimensions.length > 0) {
    lines.push("What's weighing this down right now:");
    for (const d of snapshot.weakDimensions) lines.push(`  • ${WEAK_DIMENSION_LABEL[d] ?? d}`);
    lines.push("");
  }
  if (snapshot.narration.caveats.length > 0) {
    lines.push("Please keep in mind:");
    for (const c of snapshot.narration.caveats) lines.push(`  • ${c}`);
    lines.push("");
  }
  lines.push("This is a starting point to explore in the relevant FinComp section, not a financial plan.");
  lines.push("— Sent from FinComp's Income Resilience, automatically, because your resilience genuinely changed.");
  return lines.join("\n");
}

export const sendResilienceAlertInternal = internalAction({
  args: { householdId: v.id("households"), snapshotId: v.id("incomeResilienceSnapshots") },
  returns: v.object({ sent: v.boolean(), reason: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const snapshot = (await ctx.runQuery(internal.incomeResilience.getSnapshotInternal, { snapshotId: args.snapshotId })) as Doc<"incomeResilienceSnapshots"> | null;
    if (!snapshot) return { sent: false, reason: "Snapshot not found." };
    const toEmail = (await ctx.runQuery(internal.incomeResilience.getHouseholdEmailInternal, { householdId: args.householdId })) as string | null;
    if (!toEmail) return { sent: false, reason: "No email address is on file for this household." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) return { sent: false, reason: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    try {
      const outboundId = await agentmailSender.sendMessage(ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0], inboxId, {
        to: toEmail,
        subject: `FinComp — ${snapshot.narration.headline}`,
        text: composeAlertText(snapshot),
      });
      await ctx.runMutation(internal.incomeResilience.markSnapshotEmailedInternal, { snapshotId: args.snapshotId });
      return { sent: true, reason: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },
});

// =====================================================================
// "Email me this" — user-triggered, on-demand, same AgentMail pattern
// used everywhere else in the app for an explicit ask.
// =====================================================================

export const getCallerEmailInternal = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

export const emailResilienceSummary = action({
  args: { narration: vNarration, tier: v.union(v.literal("resilient"), v.literal("worthALook"), v.literal("atRisk")), weakDimensions: v.array(v.string()) },
  returns: v.object({ status: v.union(v.literal("sent"), v.literal("failed")), detail: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const toEmail = (await ctx.runQuery(internal.incomeResilience.getCallerEmailInternal, {})) as string | null;
    if (!toEmail) return { status: "failed" as const, detail: "No email address is on file for this account." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) return { status: "failed" as const, detail: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    const lines = [args.narration.headline, "", args.narration.plainLanguage, ""];
    if (args.weakDimensions.length > 0) {
      lines.push("What's weighing this down right now:");
      for (const d of args.weakDimensions) lines.push(`  • ${WEAK_DIMENSION_LABEL[d] ?? d}`);
      lines.push("");
    }
    if (args.narration.caveats.length > 0) {
      lines.push("Please keep in mind:");
      for (const c of args.narration.caveats) lines.push(`  • ${c}`);
    }
    lines.push("", "This is a starting point to explore in the relevant FinComp section, not a financial plan.", "— Sent from FinComp's Income Resilience, at your request.");
    try {
      const outboundId = await agentmailSender.sendMessage(ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0], inboxId, { to: toEmail, subject: `FinComp — ${args.narration.headline}`, text: lines.join("\n") });
      return { status: "sent" as const, detail: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return { status: "failed" as const, detail: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const emailResilienceSendStatus = query({
  args: { outboundId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await agentmailSender.status(ctx, args.outboundId as any);
  },
});

// =====================================================================
// Cron sweep — piggybacks on the same daily-cron pattern Government,
// Economic & Livelihood Intelligence established (see convex/crons.ts),
// staggered so it doesn't collide with that sweep's own Firecrawl load.
// =====================================================================

const SWEEP_HOUSEHOLD_LIMIT = 1000;
const STAGGER_INTERVAL_MS = 10_000;

export const listAllHouseholdsInternal = internalQuery({
  args: {},
  returns: v.array(v.id("households")),
  handler: async (ctx) => (await ctx.db.query("households").take(SWEEP_HOUSEHOLD_LIMIT)).map((h) => h._id),
});

export const runHouseholdResilienceCheckInternal = internalAction({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ensureFreshBenchmark(ctx);
    const now = Date.now();
    const { inputs, tier, weakDimensions } = await computeForHousehold(ctx, args.householdId, now);
    const narration = await narrateResilience(ctx, args.householdId, inputs, tier, weakDimensions);
    await maybeSnapshot(ctx, args.householdId, tier, weakDimensions, inputs, narration);
    return null;
  },
});

export const sweepAllHouseholds = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const householdIds = (await ctx.runQuery(internal.incomeResilience.listAllHouseholdsInternal, {})) as Id<"households">[];
    for (let i = 0; i < householdIds.length; i++) {
      await ctx.scheduler.runAfter(i * STAGGER_INTERVAL_MS, internal.incomeResilience.runHouseholdResilienceCheckInternal, { householdId: householdIds[i] });
    }
    return null;
  },
});

// Human consult ("Want a real person's opinion?") reuses the generic
// convex/humanConsult.ts mutation — called from the frontend with
// sourceService: "incomeResilience".

void rupees; // reserved for frontend-facing formatting reuse; kept here to match every other service's helper placement
