// Investment & Risk Planning (Service #6). Three pieces: Investment
// Readiness (capacity, not a recommendation), Goal-Based Scenarios
// (deterministic compound-growth arithmetic over a stated assumed
// range), and a reusable tax-bracket estimator (convex/taxBracket.ts).
//
// STRICTEST AI BOUNDARY IN THE APP. OpenAI may narrate an
// already-decided readiness state, explain what a scenario range means,
// explain what an asset category or tax slab generally is. OpenAI must
// NEVER recommend a specific investment, promise a return number,
// decide the readiness state, or invent a return-rate/tax figure not
// backed by a real sourced reference. This service never says "invest
// in X" or "this will return Y%" — only capacity and ranges, with
// visible assumptions and caveats.
//
// SECURITY: every action/query below that touches a household's own
// data calls requireMembership (or an internalQuery that does) FIRST —
// learned from the Side-Income gap; not deferred here.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";
import { resolveCountry, nonIndiaJurisdictionCaveat } from "./jurisdiction";

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);
// Send-only AgentMail handle — same pattern as Loan & Debt's
// agentmailSender, a parallel copy since each service file that sends
// mail gets its own (no onMessageReceived here; that instance lives in
// convex/email.ts and owns the inbound webhook path).
const agentmailSender = new AgentMail(components.agentmail);

const rupees = (minor: number) => `₹${Math.round(minor).toLocaleString("en-IN")}`;

const ASSET_CATEGORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — content changes rarely

// =====================================================================
// Investment Readiness — deterministic capacity, never a recommendation.
// =====================================================================

// Reuses Loan & Debt's exact gatherAffordabilityData (eligible liquid
// reserve excluding earmarked, existing EMI total, active goal count) —
// not reimplemented, called cross-file via internal.loanDebt.
export const gatherReadinessData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const base = (await ctx.runQuery(internal.loanDebt.gatherAffordabilityData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      country: string | null;
      dependableMonthlyIncome: number;
      essentialMonthlyExpenses: number;
      existingEmiTotal: number;
      eligibleLiquidAssets: number;
      activeGoalCount: number;
    };
    const assets = await ctx.db.query("assets").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect();
    const earmarkedForGoalsMinorUnits = assets
      .filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId !== undefined)
      .reduce((s, a) => s + a.valueMinorUnits, 0);
    return {
      householdId,
      stateRevision: base.stateRevision,
      country: base.country,
      dependableMonthlyIncome: base.dependableMonthlyIncome,
      eligibleLiquidReserveMinorUnits: base.eligibleLiquidAssets,
      emergencyReserveTargetMinorUnits: base.essentialMonthlyExpenses,
      earmarkedForGoalsMinorUnits,
      existingEmiTotalMinorUnits: base.existingEmiTotal,
      activeGoalCount: base.activeGoalCount,
    };
  },
});

// Explicit, documented rules — never a numeric "risk score". Downside
// -capacity context (EMI burden, active goals competing for the same
// surplus) can downgrade the tier by one step, per the spec's
// instruction to cross-reference them, but never invents a number.
type ReadinessState = "NO_SURPLUS_YET" | "LIMITED_CAPACITY" | "MODERATE_CAPACITY" | "STRONG_CAPACITY" | "INSUFFICIENT_DATA";
const TIER_LABEL: Record<1 | 2 | 3, "limited" | "moderate" | "strong"> = { 1: "limited", 2: "moderate", 3: "strong" };

// Same rules as before, but now exposes ITS OWN diagnostics (the tier
// before any downgrade, and why it was downgraded) instead of just the
// final enum — needed so "How this was calculated" and "What would
// change this answer" can be built from the SAME real decision, not a
// second guess at it. Still nothing here is AI — every field is a
// direct output of these explicit, deterministic rules.
// Reads the household's latest real insuranceAdequacyChecks row (from
// Insurance, Protection & Financial Rights — Service #7) and translates
// it into a tier modifier: a large, real life-cover shortfall should
// pull the readiness tier down by one step, the same way heavy EMI or
// competing goals already can (investing a surplus that should really
// be plugging an insurance gap overstates real capacity).
//
// "Large" is deliberately a single, simple, defensible threshold: the
// life-cover shortfall alone exceeds one full year of dependable
// income — the same income-replacement unit the adequacy formula
// itself is built from, so the threshold isn't an arbitrary new number.
//
// Returns 0 (neutral) whenever there is no adequacy check on file yet
// for this household (most households, including every existing
// verification fixture, which never ran one) or when dependable income
// on that check's own row is 0 (can't judge "one year of income" from
// nothing) — so this can only ever move a household that has BOTH run
// a real adequacy check AND has a measurable, large shortfall.
function insuranceAdequacyModifierFromCheck(
  check: { lifeCoverageGapMinorUnits: number; dependableMonthlyIncome: number } | null,
): number {
  if (check === null) return 0;
  const dependableAnnualIncome = check.dependableMonthlyIncome * 12;
  if (dependableAnnualIncome <= 0) return 0;
  const gapIsLarge = check.lifeCoverageGapMinorUnits > dependableAnnualIncome;
  return gapIsLarge ? -1 : 0;
}

function diagnoseReadiness(inp: {
  investableSurplusMinorUnits: number;
  emergencyReserveTargetMinorUnits: number;
  existingEmiTotalMinorUnits: number;
  dependableMonthlyIncome: number;
  activeGoalCount: number;
  // Optional and always 0 today — see getInsuranceAdequacyModifierPlaceholder
  // above. Negative = insurance gap severe enough to pull the tier down
  // by one step (same clamp-at-1 rule as the EMI/goals downgrade);
  // 0 = no effect (today's only real value); positive is reserved but
  // unused for now. Omitted entirely by any caller that hasn't been
  // updated to pass it — defaults to 0 below either way.
  insuranceAdequacyModifier?: number;
}): {
  state: ReadinessState;
  surplusToTargetRatio: number | null;
  emiToIncomeRatio: number | null;
  tierBeforeAdjustment: 1 | 2 | 3 | null;
  tierAfterAdjustment: 1 | 2 | 3 | null;
  downgradedForGoals: boolean;
  downgradedForEmi: boolean;
  downgradedForInsuranceGap: boolean;
} {
  if (inp.dependableMonthlyIncome <= 0 || inp.emergencyReserveTargetMinorUnits <= 0) {
    return { state: "INSUFFICIENT_DATA", surplusToTargetRatio: null, emiToIncomeRatio: null, tierBeforeAdjustment: null, tierAfterAdjustment: null, downgradedForGoals: false, downgradedForEmi: false, downgradedForInsuranceGap: false };
  }
  if (inp.investableSurplusMinorUnits <= 0) {
    return { state: "NO_SURPLUS_YET", surplusToTargetRatio: inp.investableSurplusMinorUnits / inp.emergencyReserveTargetMinorUnits, emiToIncomeRatio: inp.existingEmiTotalMinorUnits / inp.dependableMonthlyIncome, tierBeforeAdjustment: null, tierAfterAdjustment: null, downgradedForGoals: false, downgradedForEmi: false, downgradedForInsuranceGap: false };
  }
  const surplusToTargetRatio = inp.investableSurplusMinorUnits / inp.emergencyReserveTargetMinorUnits;
  const emiToIncomeRatio = inp.existingEmiTotalMinorUnits / inp.dependableMonthlyIncome;
  const tierBeforeAdjustment: 1 | 2 | 3 = surplusToTargetRatio > 3 ? 3 : surplusToTargetRatio > 1 ? 2 : 1;
  const heavyEmi = emiToIncomeRatio > 0.4;
  const goalsCompeting = inp.activeGoalCount > 0 && surplusToTargetRatio < 2;
  // Always 0 today (see the placeholder above), so this branch can never
  // fire yet — kept as a real conditional, not commented out, so the
  // hook is exercised (and typo-checked) rather than silently bit-rotting.
  const insuranceGapSevere = (inp.insuranceAdequacyModifier ?? 0) < 0;
  let tierAfterAdjustment = tierBeforeAdjustment;
  if ((heavyEmi || goalsCompeting || insuranceGapSevere) && tierAfterAdjustment > 1) tierAfterAdjustment = (tierAfterAdjustment - 1) as 1 | 2;
  const state: ReadinessState = tierAfterAdjustment === 1 ? "LIMITED_CAPACITY" : tierAfterAdjustment === 2 ? "MODERATE_CAPACITY" : "STRONG_CAPACITY";
  return {
    state,
    surplusToTargetRatio,
    emiToIncomeRatio,
    tierBeforeAdjustment,
    tierAfterAdjustment,
    downgradedForGoals: tierAfterAdjustment < tierBeforeAdjustment && goalsCompeting,
    downgradedForEmi: tierAfterAdjustment < tierBeforeAdjustment && heavyEmi,
    downgradedForInsuranceGap: tierAfterAdjustment < tierBeforeAdjustment && insuranceGapSevere,
  };
}

// Backward-compatible bare-state wrapper — kept because it's a cleaner
// export for anything that only needs the enum (e.g. tests).
export function determineReadinessState(inp: Parameters<typeof diagnoseReadiness>[0]): ReadinessState {
  return diagnoseReadiness(inp).state;
}

// Deterministic (not AI) explanatory template for the ONE sentence that
// says why the tier did or didn't get pulled down — built directly from
// diagnoseReadiness's own output, so it can never disagree with the
// state it's explaining.
function explainCalculation(diag: ReturnType<typeof diagnoseReadiness>, activeGoalCount: number): string {
  if (diag.tierBeforeAdjustment === null || diag.tierAfterAdjustment === null) return "";
  if (diag.tierBeforeAdjustment === diag.tierAfterAdjustment) return "";
  const before = TIER_LABEL[diag.tierBeforeAdjustment];
  const after = TIER_LABEL[diag.tierAfterAdjustment];
  const reasons: string[] = [];
  if (diag.downgradedForGoals) {
    reasons.push(`you have ${activeGoalCount} active goal${activeGoalCount === 1 ? "" : "s"} already relying on part of it`);
  }
  if (diag.downgradedForEmi) {
    reasons.push("your existing EMI commitments are a large share of your dependable income");
  }
  if (diag.downgradedForInsuranceGap) {
    reasons.push("your latest insurance adequacy check found a life cover shortfall larger than a year of your dependable income");
  }
  const reasonText = reasons.join(", and ");
  return `Your surplus alone would normally read as ${before} capacity, but ${reasonText} — that's what pulled this down to "${after}" rather than "${before}".`;
}

// Deterministic bullet list — what, concretely, would move the tier.
// Built from the same real thresholds diagnoseReadiness already applied
// (surplus > 1x / 3x the reserve target; EMI > 40% of income; goals
// competing below 2x) — not a new judgment, just naming the levers.
function explainWhatWouldChange(diag: ReturnType<typeof diagnoseReadiness>): string[] {
  const out: string[] = [];
  if (diag.state === "INSUFFICIENT_DATA") {
    out.push("Recording dependable income and essential expenses in Financial Foundation would let this be assessed at all.");
    return out;
  }
  if (diag.state === "NO_SURPLUS_YET") {
    out.push("Growing your eligible liquid reserve above your emergency reserve target (and any amount earmarked for goals) would create a surplus to assess.");
    return out;
  }
  if (diag.tierAfterAdjustment !== null && diag.tierAfterAdjustment < 3) {
    out.push("A larger investable surplus relative to your reserve target would raise this tier.");
  }
  if (diag.downgradedForGoals) {
    out.push("Fewer active goals competing for this same surplus — or a larger surplus relative to your reserve target — would likely raise this.");
  }
  if (diag.downgradedForEmi) {
    out.push("Lowering existing EMI commitments relative to your dependable income would likely raise this.");
  }
  if (diag.downgradedForInsuranceGap) {
    out.push("Closing the life cover shortfall found in Insurance & Risk Planning's adequacy check — or a larger surplus relative to your reserve target — would likely raise this.");
  }
  if (out.length === 0) {
    out.push("This is already the strongest tier this method assigns — it would take a materially larger surplus or reserve target to change further.");
  }
  return out;
}

function explainWhatThisDoesntTell(): string[] {
  return [
    "It doesn't know your personal risk tolerance, time horizon, or how you'd feel about a loss — capacity to absorb risk isn't the same as willingness to take it.",
    "It doesn't account for irregular or one-off income, upcoming large expenses, or plans that haven't been entered into Financial Foundation or Goal & Situation Planning yet.",
    "It says nothing about what to actually invest in — that decision, and any product-specific research, is entirely yours.",
  ];
}

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

export const checkInvestmentReadiness = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.investment.gatherReadinessData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      country: string | null;
      dependableMonthlyIncome: number;
      eligibleLiquidReserveMinorUnits: number;
      emergencyReserveTargetMinorUnits: number;
      earmarkedForGoalsMinorUnits: number;
      existingEmiTotalMinorUnits: number;
      activeGoalCount: number;
    };
    const jurisdictionCaveat = nonIndiaJurisdictionCaveat(resolveCountry(data.country), "SEBI");
    const investableSurplusMinorUnits =
      data.eligibleLiquidReserveMinorUnits - data.emergencyReserveTargetMinorUnits - data.earmarkedForGoalsMinorUnits;
    // See insuranceAdequacyModifierFromCheck's comment — reads Insurance
    // & Risk Planning's latest real verdict for this household, 0
    // whenever none exists yet. Wired through explicitly (rather than
    // left for diagnoseReadiness's own default) so the hook is visible
    // right at the call site, not just inside the function.
    const latestAdequacyCheck = (await ctx.runQuery(internal.insuranceRiskPlanning.getLatestAdequacyCheckForCaller, {})) as {
      lifeCoverageGapMinorUnits: number;
      dependableMonthlyIncome: number;
    } | null;
    const diag = diagnoseReadiness({
      investableSurplusMinorUnits,
      emergencyReserveTargetMinorUnits: data.emergencyReserveTargetMinorUnits,
      existingEmiTotalMinorUnits: data.existingEmiTotalMinorUnits,
      dependableMonthlyIncome: data.dependableMonthlyIncome,
      activeGoalCount: data.activeGoalCount,
      insuranceAdequacyModifier: insuranceAdequacyModifierFromCheck(latestAdequacyCheck),
    });
    const readinessState = diag.state;
    // Deterministic explanatory text (not AI, not cached/stored — cheap
    // to recompute every call, INCLUDING on a cache hit below, so it's
    // always present and never goes stale relative to the figures it
    // describes).
    const calculationExplanation = explainCalculation(diag, data.activeGoalCount);
    const whatWouldChange = explainWhatWouldChange(diag);
    const whatThisDoesntTell = explainWhatThisDoesntTell();
    const deterministic = {
      eligibleLiquidReserveMinorUnits: data.eligibleLiquidReserveMinorUnits,
      emergencyReserveTargetMinorUnits: data.emergencyReserveTargetMinorUnits,
      earmarkedForGoalsMinorUnits: data.earmarkedForGoalsMinorUnits,
      investableSurplusMinorUnits,
      existingEmiTotalMinorUnits: data.existingEmiTotalMinorUnits,
      activeGoalCount: data.activeGoalCount,
      readinessState,
    };
    const extras = { dependableMonthlyIncome: data.dependableMonthlyIncome, calculationExplanation, whatWouldChange, whatThisDoesntTell };

    // Cache check — only skips the OpenAI narration call; the cheap
    // deterministic figures/explanations above are always freshly
    // computed regardless, so they can never disagree with what's shown.
    const cached = await ctx.runQuery(internal.investment.findCachedReadinessCheck, {
      householdId: data.householdId,
      stateRevision: data.stateRevision,
    });
    if (cached) {
      const c = cached as { _id: Id<"investmentReadinessChecks">; narration: { headline: string; plainLanguage: string; caveats: string[] } };
      const cachedNarration = jurisdictionCaveat ? { ...c.narration, caveats: [...c.narration.caveats, jurisdictionCaveat] } : c.narration;
      return { checkId: c._id, ...deterministic, narration: cachedNarration, ...extras, _fromCache: true };
    }

    const system = `You put an ALREADY-DECIDED investment-readiness result into plain language for an Indian household. You are given the readiness state (one of NO_SURPLUS_YET, LIMITED_CAPACITY, MODERATE_CAPACITY, STRONG_CAPACITY, INSUFFICIENT_DATA) and the deterministic figures behind it. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- The state is final. Explain what it means; do NOT re-judge it or suggest it should be different.
- NEVER recommend a specific investment product, fund, or asset ("invest in X"). NEVER promise or imply a return figure. This describes CAPACITY only — how much the household's own finances can currently absorb — never advice on what to do with it.
- Every field ending in "MinorUnits" is a plain rupee amount — write "₹" with Indian digit grouping. Never write "minor units".
- "caveats" = 2-3 short statements a reasonable reader needs to see (e.g. this is not personalized financial advice; reserves/goals can change; this doesn't account for [whatever the figures don't cover]).`;
    const parsed = await chatJson(system, JSON.stringify(deterministic));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : `Readiness: ${readinessState}`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.investment.saveReadinessCheck, {
      householdId: data.householdId,
      ...deterministic,
      narration,
      inputStateRevision: data.stateRevision,
    });
    const narrationForCaller = jurisdictionCaveat ? { ...narration, caveats: [...narration.caveats, jurisdictionCaveat] } : narration;
    return { checkId: id, ...deterministic, narration: narrationForCaller, ...extras, _fromCache: false };
  },
});

export const findCachedReadinessCheck = internalQuery({
  args: { householdId: v.id("households"), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("investmentReadinessChecks").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const saveReadinessCheck = internalMutation({
  args: {
    householdId: v.id("households"),
    eligibleLiquidReserveMinorUnits: v.number(),
    emergencyReserveTargetMinorUnits: v.number(),
    earmarkedForGoalsMinorUnits: v.number(),
    investableSurplusMinorUnits: v.number(),
    existingEmiTotalMinorUnits: v.number(),
    activeGoalCount: v.number(),
    readinessState: v.union(
      v.literal("NO_SURPLUS_YET"),
      v.literal("LIMITED_CAPACITY"),
      v.literal("MODERATE_CAPACITY"),
      v.literal("STRONG_CAPACITY"),
      v.literal("INSUFFICIENT_DATA"),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
  },
  returns: v.id("investmentReadinessChecks"),
  handler: async (ctx, args) => await ctx.db.insert("investmentReadinessChecks", { ...args, createdAt: Date.now() }),
});

export const listInvestmentReadinessChecks = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("investmentReadinessChecks").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});

// =====================================================================
// Goal-Based Investment Scenarios — pure compound-growth arithmetic.
// The assumed rate range is a clearly labeled assumption: one real
// Firecrawl search for a general, sourced reference to typical
// long-term category returns, grounded extraction only (same discipline
// as Side-Income's rough-estimate search) — a clearly-labeled
// placeholder if nothing usable is found, never an invented figure.
// =====================================================================

// Ordinary-annuity future value: contribution at the end of each month,
// compounded monthly at the given ANNUAL percentage rate. Pure
// deterministic arithmetic — not a prediction.
export function computeCompoundGrowthMinor(monthlyContributionMinorUnits: number, horizonYears: number, annualRatePercent: number): number {
  const n = Math.round(horizonYears * 12);
  const i = annualRatePercent / 100 / 12;
  if (i === 0) return Math.round(monthlyContributionMinorUnits * n);
  const fv = monthlyContributionMinorUnits * ((Math.pow(1 + i, n) - 1) / i);
  return Math.round(fv);
}

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 5381;
  for (let i = 0; i < json.length; i++) hash = (hash * 33) ^ json.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

export const findCachedScenario = internalQuery({
  args: { householdId: v.id("households"), inputHash: v.string(), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("investmentScenarios").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return (
      rows
        .filter((r) => r.inputHash === args.inputHash && r.inputStateRevision === args.stateRevision)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },
});

// Also validates timelineId ownership when one is passed — a scenario
// must not be linkable to another household's goal. Learned from the
// Side-Income gap: checked here, from the first version of this
// function, not deferred to a follow-up fix.
export const gatherHouseholdRevision = internalQuery({
  args: { timelineId: v.optional(v.id("timelines")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    if (args.timelineId !== undefined) {
      const timeline = await ctx.db.get("timelines", args.timelineId);
      if (timeline === null || timeline.householdId !== membership.householdId) {
        throw new ConvexError("Timeline not found.");
      }
    }
    const household = await ctx.db.get("households", membership.householdId);
    return { householdId: membership.householdId, stateRevision: household?.stateRevision ?? 0 };
  },
});

export const saveScenarioSearchSnapshot = internalMutation({
  args: { contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => {
    const url = "firecrawl-search:typical long-term investment category returns India";
    let source = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", url)).first();
    const sourceId = source ? source._id : await ctx.db.insert("sourceRegistry", { url, label: "Web search: typical long-term investment returns (India)", isAllowlisted: true, authorityLevel: "web-search-aggregate" });
    return await ctx.db.insert("sourceSnapshots", { sourceRegistryId: sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 3000) });
  },
});

async function getAssumedReturnRange(
  ctx: Parameters<typeof firecrawl.search>[0] & { runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
): Promise<{ low: number; high: number; note: string; sourceSnapshotId: Id<"sourceSnapshots"> | null }> {
  const PLACEHOLDER = {
    low: 6,
    high: 10,
    note: "No specific source could be verified this session — this is a clearly-labeled conservative placeholder range, not a projection or promise.",
    sourceSnapshotId: null,
  };
  try {
    const results = await firecrawl.search(ctx, "typical long-term average annual return equity index mutual fund India historical", { limit: 5, sources: ["web"] });
    const items = (results.web ?? []).slice(0, 5);
    if (items.length === 0) return PLACEHOLDER;
    const snippets = items.map((it) => `${("title" in it && it.title) || ""}: ${("description" in it && it.description) || ""}`).join("\n").slice(0, 3000);
    const sourceSnapshotId = (await ctx.runMutation(internal.investment.saveScenarioSearchSnapshot, { contentSummary: snippets })) as Id<"sourceSnapshots">;
    const system = `You read real web search snippets about typical long-term investment returns in India and extract a CONSERVATIVE low/high annual percentage range. Return ONLY JSON: { "low": number, "high": number, "note": string }. Ground the range only in what the snippets actually say — prefer the lower end of what's cited, since this must read as conservative, not aspirational. If the snippets don't give a usable range, return { "low": 0, "high": 0, "note": "<why>" }. "note" must briefly say where the range comes from (e.g. "commonly cited historical range for diversified long-term equity index funds, per general financial publications — not a guarantee").`;
    const parsed = await chatJson(system, snippets);
    const low = typeof parsed.low === "number" ? parsed.low : 0;
    const high = typeof parsed.high === "number" ? parsed.high : 0;
    if (low <= 0 || high <= 0 || high < low) return PLACEHOLDER;
    return { low, high, note: typeof parsed.note === "string" ? parsed.note : "Sourced from general financial publications.", sourceSnapshotId };
  } catch {
    return PLACEHOLDER;
  }
}

export const generateInvestmentScenario = action({
  args: {
    monthlyContributionMinorUnits: v.number(),
    horizonYears: v.number(),
    timelineId: v.optional(v.id("timelines")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    if (!Number.isInteger(args.monthlyContributionMinorUnits) || args.monthlyContributionMinorUnits <= 0) {
      throw new ConvexError("monthlyContributionMinorUnits must be a positive whole number of rupees.");
    }
    if (!Number.isFinite(args.horizonYears) || args.horizonYears <= 0 || args.horizonYears > 60) {
      throw new ConvexError("horizonYears must be a positive number, at most 60.");
    }
    const { householdId, stateRevision } = (await ctx.runQuery(internal.investment.gatherHouseholdRevision, { timelineId: args.timelineId })) as {
      householdId: Id<"households">;
      stateRevision: number;
    };
    const inputHash = stableHash({ monthlyContributionMinorUnits: args.monthlyContributionMinorUnits, horizonYears: args.horizonYears, timelineId: args.timelineId ?? null });
    const cached = await ctx.runQuery(internal.investment.findCachedScenario, { householdId, inputHash, stateRevision });
    if (cached) return { ...(cached as Record<string, unknown>), _fromCache: true };

    const range = await getAssumedReturnRange(ctx as never);
    const projectedRangeLowMinorUnits = computeCompoundGrowthMinor(args.monthlyContributionMinorUnits, args.horizonYears, range.low);
    const projectedRangeHighMinorUnits = computeCompoundGrowthMinor(args.monthlyContributionMinorUnits, args.horizonYears, range.high);

    const deterministic = {
      monthlyContributionMinorUnits: args.monthlyContributionMinorUnits,
      horizonYears: args.horizonYears,
      assumedAnnualReturnRangeLow: range.low,
      assumedAnnualReturnRangeHigh: range.high,
      assumptionSourceNote: range.note,
      projectedRangeLowMinorUnits,
      projectedRangeHighMinorUnits,
    };
    const system = `You explain an ALREADY-COMPUTED investment scenario range in plain language. You are given a monthly contribution, a time horizon, an assumed annual return range (with a note on where that range came from), and the resulting projected value range — all already calculated by compound-growth arithmetic, not by you. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- NEVER state or imply a different number than given. NEVER promise this range will actually happen — it is a range under a STATED ASSUMPTION, not a forecast.
- NEVER recommend a specific fund, product, or platform.
- Every field ending in "MinorUnits" is a plain rupee amount — write "₹" with Indian digit grouping. Never write "minor units".
- "caveats" = 2-3 short statements: that returns are never guaranteed, that this ignores taxes/fees/inflation unless stated, and that the assumed range's source should be read (echo assumptionSourceNote's substance briefly).`;
    const parsed = await chatJson(system, JSON.stringify(deterministic));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : "Scenario projection",
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.investment.saveScenario, {
      householdId,
      timelineId: args.timelineId,
      ...deterministic,
      assumptionSourceSnapshotId: range.sourceSnapshotId ?? undefined,
      narration,
      inputHash,
      inputStateRevision: stateRevision,
    });
    return { scenarioId: id, ...deterministic, narration };
  },
});

export const saveScenario = internalMutation({
  args: {
    householdId: v.id("households"),
    timelineId: v.optional(v.id("timelines")),
    monthlyContributionMinorUnits: v.number(),
    horizonYears: v.number(),
    assumedAnnualReturnRangeLow: v.number(),
    assumedAnnualReturnRangeHigh: v.number(),
    assumptionSourceNote: v.string(),
    assumptionSourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    projectedRangeLowMinorUnits: v.number(),
    projectedRangeHighMinorUnits: v.number(),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputHash: v.string(),
    inputStateRevision: v.number(),
  },
  returns: v.id("investmentScenarios"),
  handler: async (ctx, args) => await ctx.db.insert("investmentScenarios", { ...args, createdAt: Date.now() }),
});

export const listInvestmentScenarios = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("investmentScenarios").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});

// =====================================================================
// Single "ask box" entry point — deterministic routing, mirrors the
// Goal & Situation Planning what-if tool's UX pattern.
// =====================================================================

const TAX_KEYWORDS = ["tax", "taxes", "slab", "tds", "deduction", "deductions"];

// Deterministic (regex, not AI) extraction of a stated monthly amount,
// e.g. "₹10,000/month" or "10000 per month" — used ONLY to decide
// routing and to pre-fill a scenario call; never treated as a decision
// about what the amount SHOULD be.
const AMOUNT_PER_MONTH_RE = /₹?\s*([\d,]+)\s*(?:\/|per\s+)\s*month/i;
const DEFAULT_SCENARIO_HORIZON_YEARS = 10; // clearly-labelled default when the question states no horizon

export const askInvestmentQuestion = action({
  args: { question: v.string(), timelineId: v.optional(v.id("timelines")) },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const q = args.question.toLowerCase();

    if (args.timelineId !== undefined) {
      const amountMatchForGoal = args.question.match(AMOUNT_PER_MONTH_RE);
      const monthlyContributionMinorUnits = amountMatchForGoal ? Number(amountMatchForGoal[1].replace(/,/g, "")) : null;
      if (monthlyContributionMinorUnits !== null && monthlyContributionMinorUnits > 0) {
        const result = await ctx.runAction(api.investment.generateInvestmentScenario, {
          monthlyContributionMinorUnits,
          horizonYears: DEFAULT_SCENARIO_HORIZON_YEARS,
          timelineId: args.timelineId,
        });
        return { route: "goalBasedScenario", question: args.question, result, defaultHorizonYearsUsed: DEFAULT_SCENARIO_HORIZON_YEARS };
      }
      return {
        route: "goalBasedScenario",
        question: args.question,
        needsInput: true,
        reason: "A goal was selected, but no monthly amount was stated — say how much per month (e.g. \"₹10,000/month\") to see a projected range for this goal.",
      };
    }

    if (TAX_KEYWORDS.some((k) => q.includes(k))) {
      const estimate = await ctx.runAction(api.taxBracket.estimateTaxBracket, {});
      return {
        route: "taxBracketEstimate",
        question: args.question,
        result: estimate,
        deferralNote:
          "This is a rough current-slab estimate only. Full tax optimization — deductions, regime comparison, planning across the year — is covered by Tax Planning, which isn't built yet. This isn't a placeholder deflection: the slab estimate above is real and usable today; the rest is a genuine, honestly-deferred future service.",
      };
    }

    const amountMatch = args.question.match(AMOUNT_PER_MONTH_RE);
    if (amountMatch) {
      const monthlyContributionMinorUnits = Number(amountMatch[1].replace(/,/g, ""));
      if (Number.isInteger(monthlyContributionMinorUnits) && monthlyContributionMinorUnits > 0) {
        const result = await ctx.runAction(api.investment.generateInvestmentScenario, {
          monthlyContributionMinorUnits,
          horizonYears: DEFAULT_SCENARIO_HORIZON_YEARS,
        });
        return { route: "goalBasedScenario", question: args.question, result, defaultHorizonYearsUsed: DEFAULT_SCENARIO_HORIZON_YEARS };
      }
    }

    const result = await ctx.runAction(api.investment.checkInvestmentReadiness, {});
    return { route: "investmentReadiness", question: args.question, result };
  },
});

// =====================================================================
// Asset category education — shared, non-product-specific, NOT
// household-scoped. Still requires being signed in (no free-for-all
// unauthenticated Firecrawl calls), but there is no per-household
// ownership boundary to enforce since nothing here is private data.
// =====================================================================

const ASSET_CATEGORIES = ["fixedDeposit", "governmentBond", "indexFund", "mutualFund", "ppf", "gold"] as const;

// Small set of clearly-labeled generic descriptions used ONLY when no
// reliably scrapable general source is found for a category — flagged
// per-category in the returned `source` field, never silently invented
// as if it were sourced.
const GENERIC_FALLBACK_DESCRIPTIONS: Record<(typeof ASSET_CATEGORIES)[number], string> = {
  fixedDeposit: "A fixed deposit is a bank deposit that locks in a fixed interest rate for a chosen term, in exchange for restricted access to the money before maturity.",
  governmentBond: "A government bond is a debt instrument issued by a government, generally considered low-risk relative to other securities since it's backed by the issuing government.",
  indexFund: "An index fund is a pooled investment that aims to track the composition and performance of a specific market index rather than being actively managed.",
  mutualFund: "A mutual fund pools money from many investors and is professionally managed to invest in a mix of assets (stocks, bonds, or both) according to a stated objective.",
  ppf: "The Public Provident Fund (PPF) is a long-term Government of India savings scheme with a fixed tenure, government-set interest rate, and tax benefits under current rules.",
  gold: "Gold, held physically or through instruments like gold ETFs/bonds, is commonly used as a store of value and portfolio diversifier rather than an income-generating asset.",
};

export const ensureAssetCategoryReferences = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — this data isn't household-scoped
    return null;
  },
});

export const listAssetCategoryReferences = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireMembership(ctx);
    return await ctx.db.query("assetCategoryReferences").collect();
  },
});

export const getAssetCategoryReferenceInternal = internalQuery({
  args: { category: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("assetCategoryReferences").withIndex("by_category", (q) => q.eq("category", args.category as never)).collect();
    const fresh = rows.filter((r) => Date.now() - r.fetchedAt < ASSET_CATEGORY_MAX_AGE_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return fresh ?? null;
  },
});

export const saveAssetCategoryReference = internalMutation({
  args: { category: v.string(), description: v.string(), sourceSnapshotId: v.optional(v.id("sourceSnapshots")) },
  returns: v.id("assetCategoryReferences"),
  handler: async (ctx, args) =>
    await ctx.db.insert("assetCategoryReferences", { category: args.category as never, description: args.description, sourceSnapshotId: args.sourceSnapshotId, fetchedAt: Date.now() }),
});

export const saveCategorySourceSnapshot = internalMutation({
  args: { url: v.string(), label: v.string(), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => {
    let source = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    const sourceId = source ? source._id : await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: "investor-education" });
    return await ctx.db.insert("sourceSnapshots", { sourceRegistryId: sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 2000) });
  },
});

// One real scrape of a general investor-education source (SEBI's own
// investor-education page), one deterministic extraction pass per
// category. Falls back to the clearly-labeled generic description set
// if the source is unreachable or the category isn't well covered there.
export const refreshAssetCategoryReference = action({
  args: { category: v.union(...ASSET_CATEGORIES.map((c) => v.literal(c))) },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(api.investment.ensureAssetCategoryReferences, {}); // signed-in gate
    const cached = await ctx.runQuery(internal.investment.getAssetCategoryReferenceInternal, { category: args.category });
    if (cached) return { ...cached, _fromCache: true };

    const SOURCE_URL = "https://www.sebi.gov.in/sebi_data/docfiles/20616_t.html";
    const SOURCE_LABEL = "SEBI Investor Education — Investment in Mutual Funds";
    let description: string | null = null;
    let sourceSnapshotId: Id<"sourceSnapshots"> | null = null;
    try {
      const doc = await firecrawl.scrape(ctx, SOURCE_URL, { formats: ["markdown"] });
      const md = ((doc.markdown ?? "") as string).slice(0, 6000);
      sourceSnapshotId = (await ctx.runMutation(internal.investment.saveCategorySourceSnapshot, { url: SOURCE_URL, label: SOURCE_LABEL, contentSummary: md })) as Id<"sourceSnapshots">;
      const system = `You write ONE general, non-product-specific, educational description (2-3 sentences) of the investment category "${args.category}", grounded ONLY in the real reference text given if it actually covers this category. Return ONLY JSON: { "description": string, "grounded": boolean }. Set "grounded": false and leave "description" empty if the reference text doesn't actually cover this category — do not invent a description and claim it's sourced.`;
      const parsed = await chatJson(system, JSON.stringify({ category: args.category, referenceText: md }));
      if (parsed.grounded === true && typeof parsed.description === "string" && parsed.description.trim() !== "") {
        description = parsed.description;
      }
    } catch {
      // fall through to the generic fallback below
    }
    const usedFallback = description === null;
    const finalDescription = description ?? GENERIC_FALLBACK_DESCRIPTIONS[args.category];
    const id = await ctx.runMutation(internal.investment.saveAssetCategoryReference, {
      category: args.category,
      description: finalDescription,
      sourceSnapshotId: usedFallback ? undefined : sourceSnapshotId ?? undefined,
    });
    return { referenceId: id, category: args.category, description: finalDescription, usedGenericFallback: usedFallback, sourceLabel: usedFallback ? "Generic description (no source page covered this category well)" : SOURCE_LABEL };
  },
});

// =====================================================================
// "Email me a summary" — exact same pattern as Loan & Debt's
// emailLoanResultSummary. Reuses the result's own narration verbatim;
// recipient resolved server-side; delivery status via AgentMail's own
// outboundId.
// =====================================================================

const vInvestmentNarration = v.object({
  headline: v.string(),
  plainLanguage: v.string(),
  caveats: v.array(v.string()),
});

export const getCallerEmail = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

function composeInvestmentEmailText(narration: { headline: string; plainLanguage: string; caveats: string[] }, figures: { label: string; value: string }[]): string {
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
  lines.push("This is educational information, not personalized financial advice.");
  lines.push("— Sent from FinComp's Investment & Risk Planning, at your request.");
  return lines.join("\n");
}

function pickInvestmentFigures(deterministic: Record<string, unknown>): { label: string; value: string }[] {
  const wanted: [string, string][] = [
    ["investableSurplusMinorUnits", "Investable surplus"],
    ["eligibleLiquidReserveMinorUnits", "Eligible liquid reserve"],
    ["projectedRangeLowMinorUnits", "Projected range (low)"],
    ["projectedRangeHighMinorUnits", "Projected range (high)"],
    ["monthlyContributionMinorUnits", "Monthly contribution"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of wanted) {
    const val = deterministic[key];
    if (typeof val === "number") out.push({ label, value: rupees(val) });
  }
  return out;
}

export const emailInvestmentSummary = action({
  args: { narration: vInvestmentNarration, deterministic: v.any() },
  returns: v.object({ status: v.union(v.literal("sent"), v.literal("failed")), detail: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const toEmail = (await ctx.runQuery(internal.investment.getCallerEmail, {})) as string | null;
    if (!toEmail) return { status: "failed" as const, detail: "No email address is on file for this account." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) {
      return { status: "failed" as const, detail: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    }
    const figures = pickInvestmentFigures((args.deterministic ?? {}) as Record<string, unknown>);
    const text = composeInvestmentEmailText(args.narration, figures);
    try {
      const outboundId = await agentmailSender.sendMessage(
        ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0],
        inboxId,
        { to: toEmail, subject: `FinComp — ${args.narration.headline}`, text },
      );
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
