// Loan & Debt Resilience — Session 1: Debt Overview, New Loan
// Affordability, Prepayment Simulator.
//
// Boundary: every number and every result state is produced by the
// deterministic functions in this file. OpenAI is only ever handed a
// finished result to put into words — it never computes an EMI, invents
// a rate or fee, or decides a state. The Firecrawl benchmark rate is
// shown as context only and never feeds the calculation or the state.

import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";

declare const process: { env: Record<string, string | undefined> };

// Send-only AgentMail handle (no onMessageReceived here — that instance
// lives in convex/email.ts and owns the inbound webhook path). Used only
// by the explicit, user-clicked "email me a summary" action below.
const agentmailSender = new AgentMail(components.agentmail);

const firecrawl = new FirecrawlClient(components.firecrawl);

// The one allowlisted public benchmark-rate source — RBI's own homepage
// "Current Rates" table (official central-bank source, not a news
// aggregator), verified to load and scrape cleanly (2026-09-12: its
// Policy Repo Rate cell parses to the same 5.25% the prior aggregator
// source reported). Context only — never part of the maths, and never
// a stand-in for the user's specific lender's rate.
const RATE_SOURCE_URL = "https://www.rbi.org.in/";
const RATE_SOURCE_LABEL = "Reserve Bank of India — official Policy Repo Rate";
const RATE_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // re-scrape at most once/day

// =====================================================================
// Pure amortization maths (new — not shared with the runway calc)
// =====================================================================

function monthlyRateFromBps(annualBps: number): number {
  return annualBps / 12 / 10000;
}

// Standard amortization EMI. Zero-interest is P / n (no division by zero).
export function computeEmiMinor(
  principalMinor: number,
  annualBps: number,
  tenureMonths: number,
): number {
  const r = monthlyRateFromBps(annualBps);
  if (r === 0) return principalMinor / tenureMonths;
  const factor = Math.pow(1 + r, tenureMonths);
  return (principalMinor * r * factor) / (factor - 1);
}

// Derive remaining months from balance + rate + EMI when the loan didn't
// record a tenure. Returns null when the EMI can't cover the interest
// (loan would never close) or inputs are unusable.
function deriveRemainingTenureMonths(
  balanceMinor: number,
  annualBps: number,
  emiMinor: number,
): number | null {
  if (balanceMinor <= 0 || emiMinor <= 0) return null;
  const r = monthlyRateFromBps(annualBps);
  if (r === 0) return Math.ceil(balanceMinor / emiMinor);
  if (emiMinor <= balanceMinor * r) return null; // interest-only or worse
  const n = -Math.log(1 - (r * balanceMinor) / emiMinor) / Math.log(1 + r);
  return Math.ceil(n);
}

type AmortizeResult = { months: number; totalInterestMinor: number; payoffDate: number };

// Month-by-month reducing-balance schedule. `monthlyPaymentMinor` is the
// full payment applied each month (EMI + any extra). Returns months=Infinity
// when the payment never closes the balance.
function amortize(params: {
  balanceMinor: number;
  annualBps: number;
  monthlyPaymentMinor: number;
  startDate: number;
  capMonths?: number;
}): AmortizeResult {
  const r = monthlyRateFromBps(params.annualBps);
  const cap = params.capMonths ?? 1200;
  let bal = params.balanceMinor;
  let totalInterest = 0;
  let m = 0;
  while (bal > 0.5 && m < cap) {
    const interest = bal * r;
    let principalPaid = params.monthlyPaymentMinor - interest;
    if (principalPaid <= 0) {
      return { months: Infinity, totalInterestMinor: Infinity, payoffDate: 0 };
    }
    if (principalPaid > bal) principalPaid = bal;
    bal -= principalPaid;
    totalInterest += interest;
    m++;
  }
  return {
    months: m,
    totalInterestMinor: Math.round(totalInterest),
    payoffDate: addMonths(params.startDate, m),
  };
}

function addMonths(ts: number, n: number): number {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

function nextPaymentDate(dueDayOfMonth: number, nowTs: number): number {
  const now = new Date(nowTs);
  const day = Math.min(Math.max(Math.round(dueDayOfMonth) || 1, 1), 28);
  let candidate = new Date(now.getFullYear(), now.getMonth(), day);
  if (candidate.getTime() <= nowTs) {
    candidate = new Date(now.getFullYear(), now.getMonth() + 1, day);
  }
  return candidate.getTime();
}

// Small stable hash for cache keys (order-independent JSON).
function stableHash(obj: unknown): string {
  const json = JSON.stringify(sortKeys(obj));
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

const bpsToPercent = (bps: number) => bps / 100;
const rupees = (minor: number) => `₹${Math.round(minor).toLocaleString("en-IN")}`;

// =====================================================================
// Mutation: fill loan-specific detail fields onto an existing obligation
// =====================================================================

function assertIntegerAtLeast(value: number, min: number, field: string): void {
  if (!Number.isInteger(value) || value < min) {
    throw new ConvexError(`${field} must be a whole number ${min === 0 ? "of 0 or more" : `of ${min} or more`}.`);
  }
}

export const updateLoanDetails = mutation({
  args: {
    obligationId: v.id("obligations"),
    obligationType: v.optional(
      v.union(
        v.literal("homeLoan"),
        v.literal("personalLoan"),
        v.literal("vehicleLoan"),
        v.literal("educationLoan"),
        v.literal("other"),
      ),
    ),
    annualRateBasisPoints: v.optional(v.number()),
    rateType: v.optional(v.union(v.literal("fixed"), v.literal("floating"))),
    remainingTenureMonths: v.optional(v.number()),
    originalPrincipalMinorUnits: v.optional(v.number()),
    minimumPaymentMinorUnits: v.optional(v.number()),
    feesMinorUnits: v.optional(v.number()),
    prepaymentTerms: v.optional(v.string()),
    nextResetDate: v.optional(v.number()),
    // Insurance & Risk Planning prep — purely informational, never read
    // by computeEmiMinor/amortize or any affordability/prepayment result.
    bundledInsuranceCoverageMinorUnits: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const obligation = await ctx.db.get("obligations", args.obligationId);
    if (obligation === null || obligation.householdId !== membership.householdId) {
      throw new ConvexError("Obligation not found.");
    }

    if (args.annualRateBasisPoints !== undefined)
      assertIntegerAtLeast(args.annualRateBasisPoints, 0, "annualRateBasisPoints");
    if (args.remainingTenureMonths !== undefined)
      assertIntegerAtLeast(args.remainingTenureMonths, 1, "remainingTenureMonths");
    if (args.originalPrincipalMinorUnits !== undefined)
      assertIntegerAtLeast(args.originalPrincipalMinorUnits, 0, "originalPrincipalMinorUnits");
    if (args.minimumPaymentMinorUnits !== undefined)
      assertIntegerAtLeast(args.minimumPaymentMinorUnits, 0, "minimumPaymentMinorUnits");
    if (args.feesMinorUnits !== undefined)
      assertIntegerAtLeast(args.feesMinorUnits, 0, "feesMinorUnits");
    if (args.bundledInsuranceCoverageMinorUnits !== undefined)
      assertIntegerAtLeast(args.bundledInsuranceCoverageMinorUnits, 0, "bundledInsuranceCoverageMinorUnits");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(args)) {
      if (k === "obligationId") continue;
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch("obligations", args.obligationId, patch);
    return null;
  },
});

// =====================================================================
// Debt Overview — pure live query, no AI, no cached row
// =====================================================================

export const getDebtOverview = query({
  args: { now: v.number() },
  returns: v.object({
    totalOutstandingMinorUnits: v.number(),
    combinedMonthlyPaymentMinorUnits: v.number(),
    activeDebtCount: v.number(),
    debts: v.array(
      v.object({
        obligationId: v.id("obligations"),
        label: v.string(),
        balanceMinorUnits: v.number(),
        monthlyPaymentMinorUnits: v.number(),
        annualRatePercent: v.union(v.number(), v.null()),
        rateType: v.union(v.literal("fixed"), v.literal("floating"), v.null()),
        remainingTenureMonths: v.union(v.number(), v.null()),
        nextPaymentDate: v.number(),
        nextResetDate: v.union(v.number(), v.null()),
        obligationType: v.union(v.string(), v.null()),
        bundledInsuranceCoverageMinorUnits: v.union(v.number(), v.null()),
        warnings: v.array(v.string()),
      }),
    ),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const obligations = await ctx.db
      .query("obligations")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();

    // Informational-only threshold for flagging a "large loan with no
    // bundled insurance recorded" gap in Debt Overview — never fed into
    // any affordability/prepayment calculation. ₹5,00,000 is a simple,
    // round cutoff (a typical home-loan-sized balance); revisit once a
    // real Insurance service can judge this per-household instead.
    const LARGE_LOAN_THRESHOLD_MINOR_UNITS = 500_000; // ₹5,00,000 — "MinorUnits" here is a plain rupee integer, not paise (see documentIntelligence.ts's comment on the same convention)

    let totalOutstanding = 0;
    let combinedMonthly = 0;
    const debts = obligations.map((o) => {
      const monthlyPayment = o.minimumPaymentMinorUnits ?? o.emiMinorUnits;
      totalOutstanding += o.balanceMinorUnits;
      combinedMonthly += monthlyPayment;

      const warnings: string[] = [];
      if (o.annualRateBasisPoints === undefined)
        warnings.push(`"${o.label}" is missing its interest rate — prepayment simulation can't run for it.`);
      if (o.rateType === undefined)
        warnings.push(`"${o.label}" doesn't say whether its rate is fixed or floating.`);
      if (o.remainingTenureMonths === undefined && o.annualRateBasisPoints === undefined)
        warnings.push(`"${o.label}" has no remaining tenure and no rate, so its payoff date can't be estimated.`);
      if (o.rateType === "floating" && o.nextResetDate === undefined)
        warnings.push(`"${o.label}" is floating-rate but has no next reset date recorded.`);
      if (o.bundledInsuranceCoverageMinorUnits === undefined && o.balanceMinorUnits >= LARGE_LOAN_THRESHOLD_MINOR_UNITS)
        warnings.push(`"${o.label}" has a large outstanding balance with no bundled insurance recorded — worth checking whether it has any.`);

      return {
        obligationId: o._id,
        label: o.label,
        balanceMinorUnits: o.balanceMinorUnits,
        monthlyPaymentMinorUnits: monthlyPayment,
        annualRatePercent:
          o.annualRateBasisPoints !== undefined ? bpsToPercent(o.annualRateBasisPoints) : null,
        rateType: o.rateType ?? null,
        remainingTenureMonths:
          o.remainingTenureMonths ??
          (o.annualRateBasisPoints !== undefined
            ? deriveRemainingTenureMonths(o.balanceMinorUnits, o.annualRateBasisPoints, o.emiMinorUnits)
            : null),
        nextPaymentDate: nextPaymentDate(o.dueDayOfMonth, args.now),
        nextResetDate: o.nextResetDate ?? null,
        obligationType: o.obligationType ?? null,
        bundledInsuranceCoverageMinorUnits: o.bundledInsuranceCoverageMinorUnits ?? null,
        warnings,
      };
    });

    const householdWarnings: string[] = [];
    const missingRateCount = obligations.filter((o) => o.annualRateBasisPoints === undefined).length;
    if (missingRateCount > 0)
      householdWarnings.push(
        `${missingRateCount} of ${obligations.length} debts have no interest rate recorded — totals are complete but rate-based projections are limited.`,
      );

    return {
      totalOutstandingMinorUnits: totalOutstanding,
      combinedMonthlyPaymentMinorUnits: combinedMonthly,
      activeDebtCount: obligations.length,
      debts,
      warnings: householdWarnings,
    };
  },
});

export const listObligations = query({
  args: {},
  returns: v.array(
    v.object({
      obligationId: v.id("obligations"),
      label: v.string(),
      balanceMinorUnits: v.number(),
      emiMinorUnits: v.number(),
      hasRate: v.boolean(),
      annualRateBasisPoints: v.union(v.number(), v.null()),
      rateType: v.union(v.literal("fixed"), v.literal("floating"), v.null()),
      remainingTenureMonths: v.union(v.number(), v.null()),
      prepaymentTerms: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const obligations = await ctx.db
      .query("obligations")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    return obligations.map((o) => ({
      obligationId: o._id,
      label: o.label,
      balanceMinorUnits: o.balanceMinorUnits,
      emiMinorUnits: o.emiMinorUnits,
      hasRate: o.annualRateBasisPoints !== undefined,
      annualRateBasisPoints: o.annualRateBasisPoints ?? null,
      rateType: o.rateType ?? null,
      remainingTenureMonths: o.remainingTenureMonths ?? null,
      prepaymentTerms: o.prepaymentTerms ?? null,
    }));
  },
});

// =====================================================================
// Cache helpers (loanAnalyses — insert only, never prune/overwrite)
// =====================================================================

export const findCachedLoanAnalysis = internalQuery({
  args: {
    analysisType: v.union(v.literal("affordability"), v.literal("prepayment"), v.literal("prepaymentTarget")),
    obligationId: v.optional(v.id("obligations")),
    inputHash: v.string(),
    stateRevision: v.number(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const rows = await ctx.db
      .query("loanAnalyses")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    const match = rows
      .filter(
        (r) =>
          r.analysisType === args.analysisType &&
          (r.obligationId ?? null) === (args.obligationId ?? null) &&
          r.inputHash === args.inputHash &&
          r.inputStateRevision === args.stateRevision,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return match ? { result: match.result, createdAt: match.createdAt } : null;
  },
});

export const saveLoanAnalysis = internalMutation({
  args: {
    householdId: v.id("households"),
    analysisType: v.union(v.literal("affordability"), v.literal("prepayment"), v.literal("prepaymentTarget")),
    obligationId: v.optional(v.id("obligations")),
    inputHash: v.string(),
    inputStateRevision: v.number(),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // No prune — every version is kept as decision history.
    await ctx.db.insert("loanAnalyses", {
      householdId: args.householdId,
      analysisType: args.analysisType,
      obligationId: args.obligationId,
      inputHash: args.inputHash,
      inputStateRevision: args.inputStateRevision,
      result: args.result,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const checkAnalysisCurrent = query({
  args: {
    analysisType: v.union(v.literal("affordability"), v.literal("prepayment"), v.literal("prepaymentTarget")),
    obligationId: v.optional(v.id("obligations")),
    inputHash: v.string(),
  },
  returns: v.object({
    exists: v.boolean(),
    isCurrent: v.boolean(),
    latestCreatedAt: v.union(v.number(), v.null()),
    versionCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const household = await ctx.db.get("households", membership.householdId);
    const rows = (
      await ctx.db
        .query("loanAnalyses")
        .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
        .collect()
    ).filter(
      (r) =>
        r.analysisType === args.analysisType &&
        (r.obligationId ?? null) === (args.obligationId ?? null) &&
        r.inputHash === args.inputHash,
    );
    const latest = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      exists: rows.length > 0,
      isCurrent: latest ? latest.inputStateRevision === (household?.stateRevision ?? -1) : false,
      latestCreatedAt: latest ? latest.createdAt : null,
      versionCount: rows.length,
    };
  },
});

// =====================================================================
// Firecrawl benchmark-rate reference (context only)
// =====================================================================

export const ensureRateSource = internalMutation({
  args: {},
  returns: v.id("sourceRegistry"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("sourceRegistry")
      .withIndex("by_url", (q) => q.eq("url", RATE_SOURCE_URL))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", {
      url: RATE_SOURCE_URL,
      label: RATE_SOURCE_LABEL,
      isAllowlisted: true,
      authorityLevel: "official-central-bank",
    });
  },
});

export const getRecentRateSnapshot = internalQuery({
  args: { sourceId: v.id("sourceRegistry"), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({ fetchedAt: v.number(), extractedRateBasisPoints: v.union(v.number(), v.null()), excerpt: v.string() }),
  ),
  handler: async (ctx, args) => {
    const snap = (
      await ctx.db
        .query("sourceSnapshots")
        .withIndex("by_source", (q) => q.eq("sourceRegistryId", args.sourceId))
        .collect()
    ).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (!snap || args.now - snap.fetchedAt > RATE_SNAPSHOT_MAX_AGE_MS) return null;
    return {
      fetchedAt: snap.fetchedAt,
      extractedRateBasisPoints: snap.extractedRateBasisPoints ?? null,
      excerpt: snap.contentSummary,
    };
  },
});

export const saveRateSnapshot = internalMutation({
  args: {
    sourceId: v.id("sourceRegistry"),
    extractedRateBasisPoints: v.union(v.number(), v.null()),
    excerpt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("sourceSnapshots", {
      sourceRegistryId: args.sourceId,
      fetchedAt: Date.now(),
      contentSummary: args.excerpt.slice(0, 600),
      extractedRateBasisPoints: args.extractedRateBasisPoints ?? undefined,
    });
    return null;
  },
});

// Deterministic parse (regex, never AI) of a benchmark percentage from
// scraped markdown. Returns basis points or null. Targets RBI's own
// "Current Rates" table first (e.g. "Policy Repo Rate | :<br> 5.25%");
// falls back to looser phrasing so a markup change degrades gracefully
// instead of going silent.
function parseBenchmarkRateBps(markdown: string): number | null {
  const text = markdown.replace(/\s+/g, " ");
  const patterns = [
    /policy repo rate\s*\|?\s*:?\s*(?:<br>)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i,
    /(?:policy )?repo rate[^.|]{0,40}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:percent|%)/i,
    /benchmark interest rate[^.]*?(\d{1,2}(?:\.\d{1,2})?)\s*(?:percent|%)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const pct = Number(m[1]);
      if (pct >= 0 && pct <= 25) return Math.round(pct * 100);
    }
  }
  return null;
}

type RateContext = {
  available: boolean;
  referenceRatePercent: number | null;
  retrievalDate: number | null;
  sourceUrl: string;
  sourceLabel: string;
  quotedRatePercent: number;
  differencePercentagePoints: number | null;
  note: string;
};

async function getRateContext(
  ctx: Parameters<typeof firecrawl.scrape>[0] & {
    runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
    runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
  },
  quotedRateBps: number,
): Promise<RateContext> {
  const base: RateContext = {
    available: false,
    referenceRatePercent: null,
    retrievalDate: null,
    sourceUrl: RATE_SOURCE_URL,
    sourceLabel: RATE_SOURCE_LABEL,
    quotedRatePercent: bpsToPercent(quotedRateBps),
    differencePercentagePoints: null,
    note: "The official reference rate wasn't available this time (source unreachable or unparseable) — the affordability result above was calculated without it and is unaffected. This context, when available, only informs the picture; it never validates or invalidates your specific loan offer.",
  };
  try {
    const sourceId = (await ctx.runMutation(internal.loanDebt.ensureRateSource, {})) as Id<"sourceRegistry">;
    const recent = (await ctx.runQuery(internal.loanDebt.getRecentRateSnapshot, {
      sourceId,
      now: Date.now(),
    })) as { fetchedAt: number; extractedRateBasisPoints: number | null; excerpt: string } | null;

    let fetchedAt: number;
    let rateBps: number | null;
    if (recent) {
      fetchedAt = recent.fetchedAt;
      rateBps = recent.extractedRateBasisPoints;
    } else {
      // Allowlist assertion before any scrape.
      if (RATE_SOURCE_URL !== RATE_SOURCE_URL) throw new Error("URL not allowlisted");
      const doc = await firecrawl.scrape(ctx, RATE_SOURCE_URL, { formats: ["markdown"] });
      const md = (doc.markdown ?? doc.summary ?? "") as string;
      rateBps = parseBenchmarkRateBps(md);
      fetchedAt = Date.now();
      await ctx.runMutation(internal.loanDebt.saveRateSnapshot, {
        sourceId,
        extractedRateBasisPoints: rateBps ?? null,
        excerpt: md.slice(0, 600),
      });
    }

    if (rateBps === null) {
      return { ...base, retrievalDate: fetchedAt, note: base.note };
    }
    return {
      available: true,
      referenceRatePercent: bpsToPercent(rateBps),
      retrievalDate: fetchedAt,
      sourceUrl: RATE_SOURCE_URL,
      sourceLabel: RATE_SOURCE_LABEL,
      quotedRatePercent: bpsToPercent(quotedRateBps),
      differencePercentagePoints:
        Math.round((bpsToPercent(quotedRateBps) - bpsToPercent(rateBps)) * 100) / 100,
      note: "This is RBI's official policy rate, shown as background context — it is not a check of your specific lender's rate, and it does not validate or invalidate the affordability result above (already decided without it). Your lender's actual offer may reasonably sit above or below it.",
    };
  } catch {
    return base;
  }
}

// =====================================================================
// New Loan Affordability
// =====================================================================

type AffordabilityState =
  | "FEASIBLE_WITH_CURRENT_CONSTRAINTS"
  | "CONSTRAINT_BREACHED"
  | "MONTHLY_DEFICIT"
  | "INSUFFICIENT_DATA"
  | "NEEDS_HUMAN_REVIEW";

export const gatherAffordabilityData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const household = await ctx.db.get("households", householdId);

    const now = Date.now();
    const [income, expenses, obligations, assets, timelines, goals, timelineLoans] = await Promise.all([
      ctx.db.query("incomeSources").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("expenses").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("assets").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("timelines").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("goals").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("timelineLoans").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
    ]);

    const monthlyEquiv = (amount: number, cadence: string): number => {
      if (cadence === "monthly") return amount;
      if (cadence === "weekly") return Math.round((amount * 52) / 12);
      if (cadence === "annual") return Math.round(amount / 12);
      return 0; // irregular / oneOff — not steady
    };

    const dependableMonthlyIncome = income
      .filter(
        (i) =>
          i.reliability === "dependable" &&
          i.activeFrom <= now &&
          (i.activeTo === undefined || i.activeTo > now),
      )
      .reduce((s, i) => s + monthlyEquiv(i.amountMinorUnits, i.cadence), 0);

    const essentialMonthlyExpenses = expenses
      .filter((e) => e.classification === "essential")
      .reduce((s, e) => s + monthlyEquiv(e.amountMinorUnits, e.recurrence), 0);

    const existingEmiTotal = obligations.reduce((s, o) => s + o.emiMinorUnits, 0);

    const eligibleLiquidAssets = assets
      .filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId === undefined)
      .reduce((s, a) => s + a.valueMinorUnits, 0);

    const confirmedTimelineIds = new Set(
      timelines.filter((t) => t.confirmed === true).map((t) => t._id),
    );
    const plannedTimelineEmi = timelineLoans
      .filter((l) => l.timelineId !== undefined && confirmedTimelineIds.has(l.timelineId))
      .reduce((s, l) => s + l.emiMinorUnits, 0);
    const activeGoalCount = goals.filter(
      (g) => g.status === "active" && confirmedTimelineIds.has(g.timelineId as Id<"timelines">),
    ).length;

    return {
      householdId,
      stateRevision: household?.stateRevision ?? 0,
      dependableMonthlyIncome,
      essentialMonthlyExpenses,
      existingEmiTotal,
      eligibleLiquidAssets,
      plannedTimelineEmi,
      activeGoalCount,
    };
  },
});

export const checkAffordability = action({
  args: {
    offer: v.object({
      principalMinorUnits: v.number(),
      downPaymentMinorUnits: v.number(),
      annualRateBasisPoints: v.number(),
      rateType: v.union(v.literal("fixed"), v.literal("floating")),
      tenureMonths: v.number(),
      feesMinorUnits: v.number(),
      firstPaymentDate: v.optional(v.number()),
    }),
  },
  returns: v.object({ result: v.any(), cached: v.boolean() }),
  handler: async (ctx, args): Promise<{ result: unknown; cached: boolean }> => {
    const o = args.offer;
    const data = (await ctx.runQuery(internal.loanDebt.gatherAffordabilityData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      dependableMonthlyIncome: number;
      essentialMonthlyExpenses: number;
      existingEmiTotal: number;
      eligibleLiquidAssets: number;
      plannedTimelineEmi: number;
      activeGoalCount: number;
    };

    const inputHash = stableHash({ offer: o });
    const cached = (await ctx.runQuery(internal.loanDebt.findCachedLoanAnalysis, {
      analysisType: "affordability",
      obligationId: undefined,
      inputHash,
      stateRevision: data.stateRevision,
    })) as { result: unknown; createdAt: number } | null;
    if (cached) {
      return { result: { ...(cached.result as object), _fromCache: true }, cached: true };
    }

    // ---- deterministic calculation ----
    const warnings: string[] = [];
    const invalidOffer =
      o.principalMinorUnits <= 0 ||
      !Number.isInteger(o.principalMinorUnits) ||
      o.downPaymentMinorUnits < 0 ||
      !Number.isInteger(o.downPaymentMinorUnits) ||
      o.annualRateBasisPoints < 0 ||
      !Number.isInteger(o.annualRateBasisPoints) ||
      !Number.isInteger(o.tenureMonths) ||
      o.tenureMonths < 1 ||
      o.feesMinorUnits < 0 ||
      !Number.isInteger(o.feesMinorUnits);

    if (data.dependableMonthlyIncome <= 0)
      warnings.push("No dependable monthly income is recorded in Financial Foundation.");
    if (data.essentialMonthlyExpenses <= 0)
      warnings.push("No essential monthly expenses are recorded in Financial Foundation.");

    const emiMinor = invalidOffer
      ? 0
      : Math.round(computeEmiMinor(o.principalMinorUnits, o.annualRateBasisPoints, o.tenureMonths));
    const totalRepaymentMinor = emiMinor * o.tenureMonths;
    const totalInterestMinor = totalRepaymentMinor - o.principalMinorUnits;
    const upfrontCashMinor = o.downPaymentMinorUnits + o.feesMinorUnits;
    const monthlyCashRemainingMinor =
      data.dependableMonthlyIncome - data.essentialMonthlyExpenses - data.existingEmiTotal - emiMinor;
    const reserveRemainingMinor = data.eligibleLiquidAssets - upfrontCashMinor;
    const closureDate = addMonths(o.firstPaymentDate ?? Date.now(), o.tenureMonths);
    const totalMonthlyDebtService = data.existingEmiTotal + data.plannedTimelineEmi + emiMinor;

    const timelineConflict =
      data.dependableMonthlyIncome > 0 && totalMonthlyDebtService > data.dependableMonthlyIncome;
    const thinMonthly =
      data.dependableMonthlyIncome > 0 &&
      monthlyCashRemainingMinor >= 0 &&
      monthlyCashRemainingMinor < 0.1 * data.dependableMonthlyIncome;
    const thinReserve =
      reserveRemainingMinor >= 0 && reserveRemainingMinor < data.essentialMonthlyExpenses;
    const softGoalConflict = data.activeGoalCount > 0 && thinReserve;

    // ---- result state (explicit rules, in order) ----
    let state: AffordabilityState;
    if (
      invalidOffer ||
      data.dependableMonthlyIncome <= 0 ||
      data.essentialMonthlyExpenses <= 0
    ) {
      state = "INSUFFICIENT_DATA";
    } else if (reserveRemainingMinor < 0 || timelineConflict) {
      state = "CONSTRAINT_BREACHED";
    } else if (monthlyCashRemainingMinor < 0) {
      state = "MONTHLY_DEFICIT";
    } else if (thinMonthly || thinReserve || softGoalConflict) {
      state = "NEEDS_HUMAN_REVIEW";
    } else {
      state = "FEASIBLE_WITH_CURRENT_CONSTRAINTS";
    }

    const conflicts: string[] = [];
    if (timelineConflict)
      conflicts.push(
        `Existing EMIs (${rupees(data.existingEmiTotal)}) + confirmed-timeline planned EMIs (${rupees(
          data.plannedTimelineEmi,
        )}) + this EMI (${rupees(emiMinor)}) exceed dependable income (${rupees(data.dependableMonthlyIncome)}).`,
      );
    if (softGoalConflict)
      conflicts.push(
        `The reserve left after upfront cash (${rupees(reserveRemainingMinor)}) is below one month of essentials (${rupees(
          data.essentialMonthlyExpenses,
        )}), with ${data.activeGoalCount} active goal(s) in confirmed timelines.`,
      );

    const deterministic = {
      emiMinorUnits: emiMinor,
      totalInterestMinorUnits: totalInterestMinor,
      totalRepaymentMinorUnits: totalRepaymentMinor,
      upfrontCashRequiredMinorUnits: upfrontCashMinor,
      monthlyCashRemainingMinorUnits: monthlyCashRemainingMinor,
      reserveRemainingMinorUnits: reserveRemainingMinor,
      closureDate,
      rateType: o.rateType,
      conflicts,
      warnings,
      autoRead: {
        dependableMonthlyIncomeMinorUnits: data.dependableMonthlyIncome,
        essentialMonthlyExpensesMinorUnits: data.essentialMonthlyExpenses,
        existingEmiTotalMinorUnits: data.existingEmiTotal,
        eligibleLiquidAssetsMinorUnits: data.eligibleLiquidAssets,
        plannedTimelineEmiMinorUnits: data.plannedTimelineEmi,
      },
    };

    const rateContext = await getRateContext(ctx as never, o.annualRateBasisPoints);
    const narration = await narrateAffordability(state, deterministic, rateContext);

    const result = { state, deterministic, rateContext, narration, generatedAtStateRevision: data.stateRevision };

    await ctx.runMutation(internal.loanDebt.saveLoanAnalysis, {
      householdId: data.householdId,
      analysisType: "affordability",
      obligationId: undefined,
      inputHash,
      inputStateRevision: data.stateRevision,
      result,
    });
    return { result, cached: false };
  },
});

// =====================================================================
// Prepayment Simulator
// =====================================================================

export const gatherPrepaymentData = internalQuery({
  args: { obligationId: v.id("obligations") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const household = await ctx.db.get("households", membership.householdId);
    const obligation = await ctx.db.get("obligations", args.obligationId);
    if (obligation === null || obligation.householdId !== membership.householdId) {
      throw new ConvexError("Obligation not found.");
    }
    const [assets, expenses, goals, timelines] = await Promise.all([
      ctx.db.query("assets").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect(),
      ctx.db.query("expenses").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect(),
      ctx.db.query("goals").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect(),
      ctx.db.query("timelines").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect(),
    ]);
    const eligibleLiquidAssets = assets
      .filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId === undefined)
      .reduce((s, a) => s + a.valueMinorUnits, 0);
    const essentialMonthly = expenses
      .filter((e) => e.classification === "essential" && e.recurrence === "monthly")
      .reduce((s, e) => s + e.amountMinorUnits, 0);
    const confirmedTimelineIds = new Set(timelines.filter((t) => t.confirmed === true).map((t) => t._id));
    const activeGoalCount = goals.filter(
      (g) => g.status === "active" && confirmedTimelineIds.has(g.timelineId as Id<"timelines">),
    ).length;
    return {
      householdId: membership.householdId,
      stateRevision: household?.stateRevision ?? 0,
      obligation: {
        label: obligation.label,
        balanceMinorUnits: obligation.balanceMinorUnits,
        emiMinorUnits: obligation.emiMinorUnits,
        annualRateBasisPoints: obligation.annualRateBasisPoints ?? null,
        rateType: obligation.rateType ?? null,
        remainingTenureMonths: obligation.remainingTenureMonths ?? null,
        prepaymentTerms: obligation.prepaymentTerms ?? null,
        dueDayOfMonth: obligation.dueDayOfMonth,
        bundledInsuranceCoverageMinorUnits: obligation.bundledInsuranceCoverageMinorUnits ?? null,
      },
      eligibleLiquidAssets,
      essentialMonthly,
      activeGoalCount,
    };
  },
});

export const simulatePrepayment = action({
  args: {
    obligationId: v.id("obligations"),
    scenario: v.object({
      lumpSumMinorUnits: v.number(),
      extraMonthlyMinorUnits: v.number(),
      mode: v.union(v.literal("reduceTenure"), v.literal("reduceEmi")),
      prepaymentChargeMinorUnits: v.number(),
    }),
  },
  returns: v.object({ result: v.any(), cached: v.boolean() }),
  handler: async (ctx, args): Promise<{ result: unknown; cached: boolean }> => {
    const s = args.scenario;
    if (
      s.lumpSumMinorUnits < 0 ||
      s.extraMonthlyMinorUnits < 0 ||
      s.prepaymentChargeMinorUnits < 0 ||
      !Number.isInteger(s.lumpSumMinorUnits) ||
      !Number.isInteger(s.extraMonthlyMinorUnits) ||
      !Number.isInteger(s.prepaymentChargeMinorUnits)
    ) {
      throw new ConvexError("Prepayment amounts must be whole numbers of 0 or more.");
    }

    const data = (await ctx.runQuery(internal.loanDebt.gatherPrepaymentData, {
      obligationId: args.obligationId,
    })) as {
      householdId: Id<"households">;
      stateRevision: number;
      obligation: {
        label: string;
        balanceMinorUnits: number;
        emiMinorUnits: number;
        annualRateBasisPoints: number | null;
        rateType: "fixed" | "floating" | null;
        remainingTenureMonths: number | null;
        prepaymentTerms: string | null;
        dueDayOfMonth: number;
        bundledInsuranceCoverageMinorUnits: number | null;
      };
      eligibleLiquidAssets: number;
      essentialMonthly: number;
      activeGoalCount: number;
    };
    const ob = data.obligation;

    // Rejected loudly, never clamped.
    if (s.lumpSumMinorUnits > ob.balanceMinorUnits) {
      throw new ConvexError(
        `Lump sum ${rupees(s.lumpSumMinorUnits)} exceeds the outstanding balance ${rupees(
          ob.balanceMinorUnits,
        )}. Enter an amount up to the balance.`,
      );
    }

    if (ob.annualRateBasisPoints === null) {
      const result = {
        state: "INSUFFICIENT_DATA" as const,
        reason: `"${ob.label}" has no interest rate recorded — an amortization schedule can't be built. Add its rate in Debt Overview first.`,
        generatedAtStateRevision: data.stateRevision,
      };
      return { result, cached: false };
    }

    const inputHash = stableHash({ obligationId: args.obligationId, scenario: s });
    const cachedRow = (await ctx.runQuery(internal.loanDebt.findCachedLoanAnalysis, {
      analysisType: "prepayment",
      obligationId: args.obligationId,
      inputHash,
      stateRevision: data.stateRevision,
    })) as { result: unknown; createdAt: number } | null;
    if (cachedRow) {
      return { result: { ...(cachedRow.result as object), _fromCache: true }, cached: true };
    }

    const rateBps = ob.annualRateBasisPoints;
    const startDate = nextPaymentDate(ob.dueDayOfMonth, Date.now());

    // Baseline: current EMI only, no extra, no lump.
    const baseline = amortize({
      balanceMinor: ob.balanceMinorUnits,
      annualBps: rateBps,
      monthlyPaymentMinor: ob.emiMinorUnits,
      startDate,
    });

    let revised: AmortizeResult;
    let revisedEmiMinor = ob.emiMinorUnits;
    const balanceAfterLump = ob.balanceMinorUnits - s.lumpSumMinorUnits;

    if (balanceAfterLump <= 0.5) {
      // Lump sum fully closes the loan now.
      revised = { months: 0, totalInterestMinor: 0, payoffDate: startDate };
    } else if (s.mode === "reduceEmi") {
      const tenureForRecalc =
        ob.remainingTenureMonths ??
        deriveRemainingTenureMonths(ob.balanceMinorUnits, rateBps, ob.emiMinorUnits) ??
        baseline.months;
      revisedEmiMinor = Math.round(computeEmiMinor(balanceAfterLump, rateBps, Math.max(tenureForRecalc, 1)));
      revised = amortize({
        balanceMinor: balanceAfterLump,
        annualBps: rateBps,
        monthlyPaymentMinor: revisedEmiMinor + s.extraMonthlyMinorUnits,
        startDate,
      });
    } else {
      // reduceTenure: keep EMI, add any extra monthly.
      revised = amortize({
        balanceMinor: balanceAfterLump,
        annualBps: rateBps,
        monthlyPaymentMinor: ob.emiMinorUnits + s.extraMonthlyMinorUnits,
        startDate,
      });
    }

    const interestSavedGrossMinor =
      baseline.totalInterestMinor === Infinity || revised.totalInterestMinor === Infinity
        ? 0
        : baseline.totalInterestMinor - revised.totalInterestMinor;
    const netSavingMinor = interestSavedGrossMinor - s.prepaymentChargeMinorUnits;
    const reserveAfterMinor = data.eligibleLiquidAssets - s.lumpSumMinorUnits;
    const reserveBelowFloor = reserveAfterMinor < data.essentialMonthly;
    const affectsGoals = data.activeGoalCount > 0 && reserveBelowFloor;

    const deterministic = {
      loanLabel: ob.label,
      rateType: ob.rateType,
      annualRatePercent: bpsToPercent(rateBps),
      prepaymentTermsText: ob.prepaymentTerms,
      bundledInsuranceCoverageMinorUnits: ob.bundledInsuranceCoverageMinorUnits ?? null,
      baseline: {
        months: baseline.months === Infinity ? null : baseline.months,
        debtFreeDate: baseline.months === Infinity ? null : baseline.payoffDate,
        remainingInterestMinorUnits:
          baseline.totalInterestMinor === Infinity ? null : baseline.totalInterestMinor,
      },
      revised: {
        months: revised.months === Infinity ? null : revised.months,
        debtFreeDate: revised.months === Infinity ? null : revised.payoffDate,
        remainingInterestMinorUnits:
          revised.totalInterestMinor === Infinity ? null : revised.totalInterestMinor,
        newEmiMinorUnits: s.mode === "reduceEmi" ? revisedEmiMinor : ob.emiMinorUnits,
        mode: s.mode,
      },
      interestSavedGrossMinorUnits: interestSavedGrossMinor,
      prepaymentChargeMinorUnits: s.prepaymentChargeMinorUnits,
      netSavingMinorUnits: netSavingMinor,
      reserveAfterLumpSumMinorUnits: reserveAfterMinor,
      reserveBelowOneMonthEssentials: reserveBelowFloor,
      affectedGoalsFlag: affectsGoals,
      lumpSumClosesLoan: balanceAfterLump <= 0.5,
    };

    const narration = await narratePrepayment(deterministic);
    const result = { state: "COMPUTED" as const, deterministic, narration, generatedAtStateRevision: data.stateRevision };

    await ctx.runMutation(internal.loanDebt.saveLoanAnalysis, {
      householdId: data.householdId,
      analysisType: "prepayment",
      obligationId: args.obligationId,
      inputHash,
      inputStateRevision: data.stateRevision,
      result,
    });
    return { result, cached: false };
  },
});

// =====================================================================
// Prepayment Simulator — TARGET MODE (reverse calculation)
//
// "I want to be debt-free by date D — how much extra per month, and can
// I afford it?" Solves the amortization formula for the payment given a
// fixed number of months, then runs three deterministic checks
// (round-trip consistency, goal/reserve conflict, shortfall vs current
// surplus). OpenAI narrates the finished numbers only.
// =====================================================================

// Convert a target (absolute date or months-from-now) into a count of
// monthly payments starting at the next payment date. `ok:false` when
// the target is in the past or sooner than one payment away.
function resolveTargetMonths(
  target: { kind: "date"; targetDate: number } | { kind: "months"; months: number },
  nowTs: number,
  nextPaymentTs: number,
):
  | { ok: true; months: number; targetPayoffDate: number }
  | { ok: false; error: string; earliestAchievableDate: number } {
  const earliest = nextPaymentTs; // one payment clears the whole balance

  if (target.kind === "months") {
    if (!Number.isInteger(target.months)) {
      return { ok: false, error: "Target months must be a whole number.", earliestAchievableDate: earliest };
    }
    if (target.months < 1) {
      return {
        ok: false,
        error: `The earliest you could be debt-free on this loan is one payment away (${new Date(
          earliest,
        ).toISOString().slice(0, 10)}). Choose 1 month or more.`,
        earliestAchievableDate: earliest,
      };
    }
    return {
      ok: true,
      months: target.months,
      targetPayoffDate: addMonths(nextPaymentTs, target.months - 1),
    };
  }

  if (target.targetDate <= nowTs) {
    return {
      ok: false,
      error: `Your target date (${new Date(target.targetDate).toISOString().slice(0, 10)}) is in the past.`,
      earliestAchievableDate: earliest,
    };
  }
  // Count payment dates on or before the target.
  let n = 0;
  while (addMonths(nextPaymentTs, n) <= target.targetDate && n < 1200) n++;
  if (n < 1) {
    return {
      ok: false,
      error: `The earliest you could be debt-free on this loan is ${new Date(earliest)
        .toISOString()
        .slice(0, 10)} — one payment from now, even paying the whole balance at once. Your target is sooner than that.`,
      earliestAchievableDate: earliest,
    };
  }
  return { ok: true, months: n, targetPayoffDate: addMonths(nextPaymentTs, n - 1) };
}

// Solve the amortization formula for the monthly payment given a fixed n.
// Reuses the verified computeEmiMinor (which already handles r === 0 as
// balance / n). Rounded UP so the target is met, never missed.
function computeRequiredMonthlyPaymentMinor(
  balanceMinor: number,
  annualBps: number,
  targetMonths: number,
): number {
  return Math.ceil(computeEmiMinor(balanceMinor, annualBps, targetMonths));
}

// Pure deterministic core of target mode. Every number it needs is passed
// in (obligation figures, FF's current surplus / reserve target, goal and
// liquid-reserve counts) so this function does ALL the calculation and
// decision-making with no ctx, no auth, no network. The action is a thin
// shell that gathers those inputs, runs this, then hands the finished
// object to OpenAI for narration only. Returns either a terminal reject
// result or `{ ok: true, deterministic }` for the caller to narrate.
type PrepaymentTargetCore =
  | { ok: false; result: Record<string, unknown> }
  | { ok: true; deterministic: Record<string, unknown> };

function computePrepaymentTargetCore(inp: {
  now: number;
  nextPaymentTs: number;
  target: { kind: "date"; targetDate: number } | { kind: "months"; months: number };
  loanLabel: string;
  balanceMinorUnits: number;
  emiMinorUnits: number;
  annualRateBasisPoints: number | null;
  rateType: "fixed" | "floating" | null;
  activeGoalCount: number;
  eligibleLiquidAssets: number;
  availableMonthlySurplusMinor: number;
  emergencyReserveTargetMinor: number;
  stateRevision: number;
}): PrepaymentTargetCore {
  if (inp.annualRateBasisPoints === null) {
    return {
      ok: false,
      result: {
        state: "INSUFFICIENT_DATA",
        reason: `"${inp.loanLabel}" has no interest rate recorded — a target payoff can't be solved. Add its rate in Debt Overview first.`,
        generatedAtStateRevision: inp.stateRevision,
      },
    };
  }

  const resolved = resolveTargetMonths(inp.target, inp.now, inp.nextPaymentTs);
  if (!resolved.ok) {
    return {
      ok: false,
      result: {
        state: "REJECTED",
        error: resolved.error,
        earliestAchievableDate: resolved.earliestAchievableDate,
        generatedAtStateRevision: inp.stateRevision,
      },
    };
  }

  const rateBps = inp.annualRateBasisPoints;
  const targetMonths = resolved.months;

  // ---- 1. reverse amortization ----
  const requiredTotalMonthlyMinor = computeRequiredMonthlyPaymentMinor(
    inp.balanceMinorUnits,
    rateBps,
    targetMonths,
  );
  const requiredExtraMonthlyMinor = Math.max(0, requiredTotalMonthlyMinor - inp.emiMinorUnits);
  // Round-trip: feed the solved payment back through the forward schedule.
  const roundTrip = amortize({
    balanceMinor: inp.balanceMinorUnits,
    annualBps: rateBps,
    monthlyPaymentMinor: requiredTotalMonthlyMinor,
    startDate: inp.nextPaymentTs,
  });
  const roundTripMonths = roundTrip.months === Infinity ? null : roundTrip.months;
  const roundTripConsistent = roundTripMonths !== null && Math.abs(roundTripMonths - targetMonths) <= 1;

  // ---- 2. goal / reserve conflict (same pattern as affordability) ----
  const monthlySurplusAfterExtraMinor = inp.availableMonthlySurplusMinor - requiredExtraMonthlyMinor;
  const wouldErodeReservesMonthly = monthlySurplusAfterExtraMinor < 0;
  const thinSurplus =
    monthlySurplusAfterExtraMinor >= 0 &&
    monthlySurplusAfterExtraMinor < inp.emergencyReserveTargetMinor;
  const reserveAlreadyBelowTarget = inp.eligibleLiquidAssets < inp.emergencyReserveTargetMinor;
  const reserveConflict = wouldErodeReservesMonthly || reserveAlreadyBelowTarget;
  const goalConflict = inp.activeGoalCount > 0 && (wouldErodeReservesMonthly || thinSurplus);
  const conflictDetail =
    goalConflict || reserveConflict
      ? [
          wouldErodeReservesMonthly
            ? `Committing ${rupees(requiredExtraMonthlyMinor)}/mo extra leaves monthly surplus at ${rupees(
                monthlySurplusAfterExtraMinor,
              )}, so savings would be drawn down every month.`
            : thinSurplus
              ? `After the extra payment, monthly surplus would be ${rupees(
                  monthlySurplusAfterExtraMinor,
                )} — below one month of essentials (${rupees(inp.emergencyReserveTargetMinor)}).`
              : "",
          reserveAlreadyBelowTarget
            ? `Eligible liquid reserve (${rupees(
                inp.eligibleLiquidAssets,
              )}) is already below the one-month emergency target (${rupees(inp.emergencyReserveTargetMinor)}).`
            : "",
          inp.activeGoalCount > 0 && goalConflict
            ? `${inp.activeGoalCount} active goal(s) in confirmed timelines rely on that surplus.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  // ---- 3. shortfall routing (structured) ----
  const hasShortfall = requiredExtraMonthlyMinor > inp.availableMonthlySurplusMinor;
  const gapMinorUnits = hasShortfall
    ? Math.round(requiredExtraMonthlyMinor - inp.availableMonthlySurplusMinor)
    : 0;
  const suggestedServices = hasShortfall
    ? [
        {
          key: "incomeResilience",
          label: "Income Resilience",
          reason: "assess how to free up monthly surplus",
        },
        {
          key: "sideIncomeBusinessPlanning",
          label: "Side-Income & Business Planning",
          reason: "explore additional income",
        },
      ]
    : [];
  const routingNote = hasShortfall
    ? `You're short by ${rupees(gapMinorUnits)}/month to hit this target from current surplus. ` +
      suggestedServices.map((s) => `${s.label} can ${s.reason}`).join(", or ") +
      "."
    : "";

  const deterministic = {
    loanLabel: inp.loanLabel,
    rateType: inp.rateType,
    annualRatePercent: bpsToPercent(rateBps),
    currentEmiMinorUnits: inp.emiMinorUnits,
    balanceMinorUnits: inp.balanceMinorUnits,
    targetMonths,
    targetPayoffDate: resolved.targetPayoffDate,
    requiredTotalMonthlyMinorUnits: requiredTotalMonthlyMinor,
    requiredExtraMonthlyMinorUnits: requiredExtraMonthlyMinor,
    roundTrip: { months: roundTripMonths, consistentWithTarget: roundTripConsistent },
    conflict: {
      availableMonthlySurplusMinorUnits: inp.availableMonthlySurplusMinor,
      monthlySurplusAfterExtraMinorUnits: monthlySurplusAfterExtraMinor,
      emergencyReserveTargetMinorUnits: inp.emergencyReserveTargetMinor,
      eligibleLiquidReserveMinorUnits: inp.eligibleLiquidAssets,
      activeGoalCount: inp.activeGoalCount,
      goalConflict,
      reserveConflict,
      conflictDetail,
    },
    shortfall: {
      hasShortfall,
      requiredExtraMonthlyMinorUnits: requiredExtraMonthlyMinor,
      availableMonthlySurplusMinorUnits: inp.availableMonthlySurplusMinor,
      gapMinorUnits,
      suggestedServices,
      routingNote,
    },
  };

  return { ok: true, deterministic };
}

export const simulatePrepaymentTarget = action({
  args: {
    obligationId: v.id("obligations"),
    target: v.union(
      v.object({ kind: v.literal("date"), targetDate: v.number() }),
      v.object({ kind: v.literal("months"), months: v.number() }),
    ),
  },
  returns: v.object({ result: v.any(), cached: v.boolean() }),
  handler: async (ctx, args): Promise<{ result: unknown; cached: boolean }> => {
    const now = Date.now();
    const data = (await ctx.runQuery(internal.loanDebt.gatherPrepaymentData, {
      obligationId: args.obligationId,
    })) as {
      householdId: Id<"households">;
      stateRevision: number;
      obligation: {
        label: string;
        balanceMinorUnits: number;
        emiMinorUnits: number;
        annualRateBasisPoints: number | null;
        rateType: "fixed" | "floating" | null;
        remainingTenureMonths: number | null;
        prepaymentTerms: string | null;
        dueDayOfMonth: number;
        bundledInsuranceCoverageMinorUnits: number | null;
      };
      eligibleLiquidAssets: number;
      essentialMonthly: number;
      activeGoalCount: number;
    };
    const ob = data.obligation;

    // FF's own current numbers — reused, not recalculated here.
    const runway = (await ctx.runQuery(api.runway.calculateRunway, { now })) as {
      monthlyNetGapMinorUnits: number;
      essentialMonthlyExpensesMinorUnits: number;
    };
    const availableMonthlySurplusMinor = -runway.monthlyNetGapMinorUnits; // income − essential − all EMIs
    const emergencyReserveTargetMinor = runway.essentialMonthlyExpensesMinorUnits; // one month of essentials

    const inputHash = stableHash({ obligationId: args.obligationId, target: args.target });
    const cachedRow = (await ctx.runQuery(internal.loanDebt.findCachedLoanAnalysis, {
      analysisType: "prepaymentTarget",
      obligationId: args.obligationId,
      inputHash,
      stateRevision: data.stateRevision,
    })) as { result: unknown; createdAt: number } | null;
    if (cachedRow) {
      return { result: { ...(cachedRow.result as object), _fromCache: true }, cached: true };
    }

    const core = computePrepaymentTargetCore({
      now,
      nextPaymentTs: nextPaymentDate(ob.dueDayOfMonth, now),
      target: args.target,
      loanLabel: ob.label,
      balanceMinorUnits: ob.balanceMinorUnits,
      emiMinorUnits: ob.emiMinorUnits,
      annualRateBasisPoints: ob.annualRateBasisPoints,
      rateType: ob.rateType,
      activeGoalCount: data.activeGoalCount,
      eligibleLiquidAssets: data.eligibleLiquidAssets,
      availableMonthlySurplusMinor,
      emergencyReserveTargetMinor,
      stateRevision: data.stateRevision,
    });

    if (!core.ok) {
      // Terminal reject — not cached (cheap to recompute, and the reason
      // may change as the clock advances).
      return { result: core.result, cached: false };
    }

    // OpenAI gets the finished deterministic object — it narrates, never computes.
    const narration = await narratePrepaymentTarget(core.deterministic);
    const result = {
      state: "COMPUTED" as const,
      deterministic: core.deterministic,
      narration,
      generatedAtStateRevision: data.stateRevision,
    };

    await ctx.runMutation(internal.loanDebt.saveLoanAnalysis, {
      householdId: data.householdId,
      analysisType: "prepaymentTarget",
      obligationId: args.obligationId,
      inputHash,
      inputStateRevision: data.stateRevision,
      result,
    });
    return { result, cached: false };
  },
});

// =====================================================================
// OpenAI narration — explains finished numbers, never produces them
// =====================================================================

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

async function narrateAffordability(
  state: AffordabilityState,
  deterministic: unknown,
  rateContext: RateContext,
): Promise<{ headline: string; plainLanguage: string; tradeoffs: string[]; lenderQuestions: string[]; missingInfoNotes: string[] }> {
  const system = `You put an ALREADY-DECIDED loan affordability result into plain language for a household. You are given: the result state (one of FEASIBLE_WITH_CURRENT_CONSTRAINTS, CONSTRAINT_BREACHED, MONTHLY_DEFICIT, INSUFFICIENT_DATA, NEEDS_HUMAN_REVIEW), a JSON of computed figures, and a separate public benchmark-rate context object.
Return ONLY JSON: { "headline": string, "plainLanguage": string, "tradeoffs": string[], "lenderQuestions": string[], "missingInfoNotes": string[] }.
Hard rules:
- The state is final. Explain what it means; do NOT re-judge affordability or suggest the state should be different.
- Every field ending in "MinorUnits" is a plain rupee amount. Write money as "₹" plus Indian digit grouping (e.g. ₹1,37,440). Never write the words "minor units".
- Never introduce, recompute, or round any number differently from the JSON. Quote figures as given.
- "tradeoffs" = 2-4 short trade-off statements grounded in the figures.
- "lenderQuestions" = 2-4 questions the household should ask the lender.
- "missingInfoNotes" = restate the warnings array plainly; empty array if none.
- If the benchmark context is available, you may mention it as general background context only. Never say or imply it confirms, validates, invalidates, or checks the user's specific lender's rate or the result state above — the state was already decided without this context, and the household is not guaranteed to receive this rate.`;
  const parsed = await chatJson(system, JSON.stringify({ state, deterministic, rateContext }));
  return {
    headline: typeof parsed.headline === "string" ? parsed.headline : `Result: ${state}`,
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
    tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs.filter((x): x is string => typeof x === "string") : [],
    lenderQuestions: Array.isArray(parsed.lenderQuestions)
      ? parsed.lenderQuestions.filter((x): x is string => typeof x === "string")
      : [],
    missingInfoNotes: Array.isArray(parsed.missingInfoNotes)
      ? parsed.missingInfoNotes.filter((x): x is string => typeof x === "string")
      : [],
  };
}

async function narratePrepayment(
  deterministic: unknown,
): Promise<{ headline: string; plainLanguage: string; tradeoffs: string[]; lenderQuestions: string[] }> {
  const system = `You put an ALREADY-COMPUTED loan prepayment simulation into plain language. You are given a JSON of baseline vs revised amortization figures, interest saved, prepayment charge, net saving, and reserve impact.
Return ONLY JSON: { "headline": string, "plainLanguage": string, "tradeoffs": string[], "lenderQuestions": string[] }.
Hard rules:
- Every field ending in "MinorUnits" is a plain rupee amount. Write money as "₹" plus Indian digit grouping (e.g. ₹11,18,489). Never write the words "minor units".
- Never introduce, recompute, or round any number differently from the JSON. Quote figures as given, including net saving even if negative.
- State clearly whether the loan's rate is fixed or floating (from rateType).
- If prepaymentTermsText is present, briefly explain what that clause means for the user.
- If bundledInsuranceCoverageMinorUnits is a number (not null), mention it as one plain factual sentence, e.g. "this loan includes bundled insurance covering ₹X of the balance" — informational only, never advice about whether that's enough. If it is null, say nothing about insurance at all — null means nothing was recorded, not that there is none.
- "tradeoffs" = 2-4 short statements (e.g. liquidity given up vs interest saved).
- "lenderQuestions" = 1-3 questions to confirm with the lender (e.g. exact prepayment charge, whether partial prepayment is allowed).
- Do NOT decide whether the user should prepay; describe the outcome only.`;
  const parsed = await chatJson(system, JSON.stringify({ deterministic }));
  return {
    headline: typeof parsed.headline === "string" ? parsed.headline : "Prepayment simulation",
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
    tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs.filter((x): x is string => typeof x === "string") : [],
    lenderQuestions: Array.isArray(parsed.lenderQuestions)
      ? parsed.lenderQuestions.filter((x): x is string => typeof x === "string")
      : [],
  };
}

async function narratePrepaymentTarget(
  deterministic: unknown,
): Promise<{ headline: string; plainLanguage: string; tradeoffs: string[]; nextSteps: string[] }> {
  const system = `You put an ALREADY-COMPUTED "target payoff" prepayment result into plain language. The JSON gives: the loan, a target payoff date and month count, the required total monthly payment and required EXTRA monthly payment (both already solved), a round-trip check, a conflict object (goalConflict / reserveConflict booleans plus figures), and a shortfall object (hasShortfall, gapMinorUnits, suggestedServices, routingNote).
Return ONLY JSON: { "headline": string, "plainLanguage": string, "tradeoffs": string[], "nextSteps": string[] }.
Hard rules:
- You did NOT calculate anything. Never introduce, recompute, or round any number differently from the JSON. Quote figures exactly.
- Every field ending in "MinorUnits" is a plain rupee amount — write it as "₹" with Indian digit grouping (e.g. ₹31,957). Never write "minor units".
- Do NOT decide whether a conflict exists or what the shortfall is — those booleans and numbers are already set. Just describe them.
- State whether the loan rate is fixed or floating (rateType).
- "tradeoffs" = 2-4 short statements about the extra monthly commitment vs. the earlier payoff.
- "nextSteps" = if shortfall.hasShortfall, restate shortfall.routingNote and name the suggested services; otherwise 1-2 neutral next steps (e.g. confirm the prepayment charge policy with the lender).`;
  const parsed = await chatJson(system, JSON.stringify({ deterministic }));
  return {
    headline: typeof parsed.headline === "string" ? parsed.headline : "Target payoff",
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
    tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs.filter((x): x is string => typeof x === "string") : [],
    nextSteps: Array.isArray(parsed.nextSteps)
      ? parsed.nextSteps.filter((x): x is string => typeof x === "string")
      : [],
  };
}

// =====================================================================
// "Email me a summary of this" — one user-clicked outbound send.
//
// NOT automatic: only fires when the user clicks the button on a result
// they are already looking at. Reuses that result's own narration
// (headline/plainLanguage/tradeoffs) verbatim — this function does not
// call OpenAI and does not recompute anything. Recipient is always the
// signed-in user's own account email, resolved server-side (never a
// client-supplied address). Delivery status is tracked via AgentMail's
// own outboundId, not assumed from the enqueue call succeeding.
// =====================================================================

const vEmailableNarration = v.object({
  headline: v.string(),
  plainLanguage: v.string(),
  tradeoffs: v.array(v.string()),
  lenderQuestions: v.optional(v.array(v.string())),
  nextSteps: v.optional(v.array(v.string())),
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

function composeSummaryEmailText(
  narration: { headline: string; plainLanguage: string; tradeoffs: string[]; lenderQuestions?: string[]; nextSteps?: string[] },
  figures: { label: string; value: string }[],
): string {
  const lines = [narration.headline, "", narration.plainLanguage, ""];
  if (figures.length > 0) {
    lines.push("Key figures:");
    for (const f of figures) lines.push(`  ${f.label}: ${f.value}`);
    lines.push("");
  }
  if (narration.tradeoffs.length > 0) {
    lines.push("Trade-offs:");
    for (const t of narration.tradeoffs) lines.push(`  • ${t}`);
    lines.push("");
  }
  if (narration.lenderQuestions && narration.lenderQuestions.length > 0) {
    lines.push("Questions to ask the lender:");
    for (const q of narration.lenderQuestions) lines.push(`  • ${q}`);
    lines.push("");
  }
  if (narration.nextSteps && narration.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const s of narration.nextSteps) lines.push(`  • ${s}`);
    lines.push("");
  }
  lines.push("— Sent from FinComp's Loan & Debt Resilience, at your request.");
  return lines.join("\n");
}

// Pulls a handful of headline rupee figures out of a deterministic block
// by known field name, purely for the email body — never recomputes.
function pickEmailFigures(deterministic: Record<string, unknown>): { label: string; value: string }[] {
  const wanted: [string, string][] = [
    ["emiMinorUnits", "Calculated EMI"],
    ["totalInterestMinorUnits", "Total interest"],
    ["totalRepaymentMinorUnits", "Total repayment"],
    ["requiredTotalMonthlyMinorUnits", "Total monthly payment needed"],
    ["requiredExtraMonthlyMinorUnits", "Extra beyond current EMI"],
    ["netSavingMinorUnits", "Estimated net saving"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of wanted) {
    const val = deterministic[key];
    if (typeof val === "number") out.push({ label, value: rupees(val) });
  }
  return out;
}

export const emailLoanResultSummary = action({
  args: {
    narration: vEmailableNarration,
    deterministic: v.any(),
  },
  returns: v.object({
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.string(),
    outboundId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const toEmail = (await ctx.runQuery(internal.loanDebt.getCallerEmail, {})) as string | null;
    if (!toEmail) {
      return { status: "failed" as const, detail: "No email address is on file for this account." };
    }
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) {
      return {
        status: "failed" as const,
        detail:
          "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment — this needs an AgentMail inbox ID this app is allowed to send from before it can send mail.",
      };
    }
    const figures = pickEmailFigures((args.deterministic ?? {}) as Record<string, unknown>);
    const text = composeSummaryEmailText(args.narration, figures);
    try {
      // Same upstream RunMutationCtx type mismatch as convex/http.ts (the
      // package predates Convex 1.41's optional third runMutation arg) —
      // cast, not a real incompatibility.
      const outboundId = await agentmailSender.sendMessage(
        ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0],
        inboxId,
        {
          to: toEmail,
          subject: `FinComp — ${args.narration.headline}`,
          text,
        },
      );
      return { status: "sent" as const, detail: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return {
        status: "failed" as const,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// Live delivery status for a send this feature triggered — subscribe from
// the UI instead of assuming the enqueue above means "delivered".
export const emailSendStatus = query({
  args: { outboundId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await agentmailSender.status(ctx, args.outboundId as any);
  },
});
