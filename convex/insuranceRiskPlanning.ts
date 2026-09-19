// Insurance, Protection & Financial Rights (Service #7). Four pieces:
// category education, an adequacy check (life-cover gap + health-cover
// assessment), portability guidance, and cross-service gap detection.
//
// STRICTEST BOUNDARY, same seriousness as Investment: this service
// explains categories and names gaps — it NEVER recommends a specific
// insurer, product, or premium quote. "You appear underinsured by X" is
// a deterministic, data-backed observation; "buy policy Y from insurer
// Z" is never something this service says. OpenAI only narrates an
// ALREADY-DECIDED verdict/gap-list/step-list — it never invents the
// coverage-need formula's result, decides whether a gap exists, or
// names a product.
//
// SECURITY: every action/query that touches a household's own data
// calls requireMembership (or an internalQuery that does) FIRST — same
// discipline as every service since the Side-Income gap was found.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);
// Send-only handle — same parallel-copy-per-file pattern as every other
// service (Loan & Debt, Side-Income, Investment).
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
// Category education — shared, non-product-specific, NOT household-
// scoped. Still requires being signed in (no free-for-all unauth
// Firecrawl calls), matching Investment's asset-category pattern
// exactly.
// =====================================================================

const INSURANCE_CATEGORIES = ["life", "health", "motor", "property", "personalAccident", "other"] as const;
const INSURANCE_CATEGORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — content changes rarely

const GENERIC_FALLBACK_DESCRIPTIONS: Record<(typeof INSURANCE_CATEGORIES)[number], string> = {
  life: "Life insurance pays a set amount to your nominees if you pass away during the policy term, generally meant to replace lost income and help clear debts left behind.",
  health: "Health insurance covers eligible medical treatment costs, generally up to a set annual limit (the sum insured), for the policyholder and any dependents included on the policy.",
  motor: "Motor insurance covers damage to, or liability arising from, a vehicle you own — third-party cover is legally required in India, while own-damage cover is optional.",
  property: "Property insurance covers damage to or loss of a home or other property from events like fire, theft, or natural disasters, up to the policy's stated sum insured.",
  personalAccident: "Personal accident insurance pays out a set amount for injury, disability, or death resulting from an accident — separate from, and not a substitute for, health insurance's treatment-cost cover.",
  other: "Other insurance types (e.g. business liability, travel, or specialty covers) protect against a specific named risk, with terms and payout conditions set by the policy document itself.",
};

export const ensureInsuranceCategoryReferences = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — this data isn't household-scoped
    return null;
  },
});

export const listInsuranceCategoryReferences = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireMembership(ctx);
    return await ctx.db.query("insuranceCategoryReferences").collect();
  },
});

export const getInsuranceCategoryReferenceInternal = internalQuery({
  args: { category: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("insuranceCategoryReferences")
      .withIndex("by_category", (q) => q.eq("category", args.category as never))
      .collect();
    const fresh = rows.filter((r) => Date.now() - r.fetchedAt < INSURANCE_CATEGORY_MAX_AGE_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return fresh ?? null;
  },
});

export const saveInsuranceCategoryReference = internalMutation({
  args: { category: v.string(), description: v.string(), sourceSnapshotId: v.optional(v.id("sourceSnapshots")) },
  returns: v.id("insuranceCategoryReferences"),
  handler: async (ctx, args) =>
    await ctx.db.insert("insuranceCategoryReferences", {
      category: args.category as never,
      description: args.description,
      sourceSnapshotId: args.sourceSnapshotId,
      fetchedAt: Date.now(),
    }),
});

export const saveInsuranceCategorySourceSnapshot = internalMutation({
  args: { url: v.string(), label: v.string(), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => {
    let source = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    const sourceId = source
      ? source._id
      : await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: "insurance-education" });
    return await ctx.db.insert("sourceSnapshots", { sourceRegistryId: sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 2000) });
  },
});

// One real scrape of a general insurance-education source (IRDAI's own
// public consumer-education portal), one deterministic-extraction-via-
// grounded-AI pass per category. Falls back to the clearly-labeled
// generic description set if the source is unreachable or the category
// isn't well covered there — same honesty pattern as Investment's asset
// category grid (usedGenericFallback flag).
export const refreshInsuranceCategoryReference = action({
  args: { category: v.union(...INSURANCE_CATEGORIES.map((c) => v.literal(c))) },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(api.insuranceRiskPlanning.ensureInsuranceCategoryReferences, {}); // signed-in gate
    const cached = await ctx.runQuery(internal.insuranceRiskPlanning.getInsuranceCategoryReferenceInternal, { category: args.category });
    if (cached) return { ...cached, _fromCache: true };

    // National Centre for Financial Education (NCFE) — a body jointly
    // promoted by RBI/SEBI/IRDAI/PFRDA — its page on IRDAI's financial
    // literacy initiatives. Verified reachable during this build
    // (2026-09-17). Note: several real IRDAI-domain URLs were tried
    // first (policyholder.gov.in — DNS failure, irdai.gov.in's own
    // pages — Liferay portal with no plain consumer-education text) and
    // rejected as unusable before settling on this one; this page
    // itself is meta-content about IRDAI's literacy programs rather
    // than category definitions, so most categories are expected to
    // honestly fall back here — same outcome Investment's own SEBI
    // source produced for most asset categories.
    const SOURCE_URL = "https://ncfe.org.in/stakeholders-initiatives/irdai/";
    const SOURCE_LABEL = "NCFE — IRDAI Financial Literacy Initiatives (ncfe.org.in)";
    let description: string | null = null;
    let sourceSnapshotId: Id<"sourceSnapshots"> | null = null;
    try {
      const doc = await firecrawl.scrape(ctx, SOURCE_URL, { formats: ["markdown"] });
      const md = ((doc.markdown ?? "") as string).slice(0, 6000);
      if (md.trim() === "") throw new Error("empty scrape");
      sourceSnapshotId = (await ctx.runMutation(internal.insuranceRiskPlanning.saveInsuranceCategorySourceSnapshot, {
        url: SOURCE_URL,
        label: SOURCE_LABEL,
        contentSummary: md,
      })) as Id<"sourceSnapshots">;
      const system = `You write ONE general, non-product-specific, educational description (2-3 sentences) of the insurance category "${args.category}", grounded ONLY in the real reference text given if it actually covers this category. Return ONLY JSON: { "description": string, "grounded": boolean }. Set "grounded": false and leave "description" empty if the reference text doesn't actually cover this category — do not invent a description and claim it's sourced. Never recommend a specific insurer or product.`;
      const parsed = await chatJson(system, JSON.stringify({ category: args.category, referenceText: md }));
      if (parsed.grounded === true && typeof parsed.description === "string" && parsed.description.trim() !== "") {
        description = parsed.description;
      }
    } catch {
      // fall through to the generic fallback below
    }
    const usedFallback = description === null;
    const finalDescription = description ?? GENERIC_FALLBACK_DESCRIPTIONS[args.category];
    const id = await ctx.runMutation(internal.insuranceRiskPlanning.saveInsuranceCategoryReference, {
      category: args.category,
      description: finalDescription,
      sourceSnapshotId: usedFallback ? undefined : sourceSnapshotId ?? undefined,
    });
    return {
      referenceId: id,
      category: args.category,
      description: finalDescription,
      usedGenericFallback: usedFallback,
      sourceLabel: usedFallback ? "Generic description (no source page covered this category well)" : SOURCE_LABEL,
    };
  },
});

// =====================================================================
// Adequacy check — deterministic life-cover-need formula + health-
// cover threshold, reading real cross-service data. OpenAI narrates the
// already-computed gap/state only.
// =====================================================================

// Standard, hand-verifiable formula, deliberately kept to two terms so
// it stays defensible: outstanding debt (which cover would need to
// clear) + a fixed number of years of dependable annual income (to
// replace lost income for that long). This is a commonly-cited rule of
// thumb, not a personalized recommendation — stated as such in every
// narration. Dependents count is captured on the row for context and
// gap detection, but deliberately NOT a multiplier here — two clean
// terms are easier to hand-verify than a more "accurate" formula would
// be to defend.
const LIFE_INCOME_REPLACEMENT_YEARS = 10;

// Commonly-cited minimum per-person floater health cover in India,
// scaled by household size (self + dependentsCount). "MinorUnits" here
// is a plain rupee integer, matching this codebase's established
// convention (not paise) — see the Loan & Debt threshold bug this same
// mistake caused in the prep pass, now fixed and documented so it isn't
// repeated here.
const HEALTH_COVER_MINIMUM_PER_PERSON_MINOR_UNITS = 500_000;

type HealthCoverageAssessment = "NONE" | "LIKELY_INSUFFICIENT" | "LIKELY_ADEQUATE" | "INSUFFICIENT_DATA";

export const gatherAdequacyData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const household = await ctx.db.get("households", householdId);

    const [policies, obligations, incomeSources, timelines, familySupport] = await Promise.all([
      ctx.db.query("insurancePolicies").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("incomeSources").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("timelines").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("timelineFamilySupport").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
    ]);

    const totalLifeCoverageMinorUnits = policies.filter((p) => p.type === "life").reduce((s, p) => s + p.coverageAmountMinorUnits, 0);
    const totalHealthCoverageMinorUnits = policies.filter((p) => p.type === "health").reduce((s, p) => s + p.coverageAmountMinorUnits, 0);
    const outstandingLoanBalanceMinorUnits = obligations.reduce((s, o) => s + o.balanceMinorUnits, 0);
    const bundledLifeCoverageMinorUnits = obligations.reduce((s, o) => s + (o.bundledInsuranceCoverageMinorUnits ?? 0), 0);

    const now = Date.now();
    const monthlyEquiv = (amount: number, cadence: string): number => {
      if (cadence === "monthly") return amount;
      if (cadence === "weekly") return Math.round((amount * 52) / 12);
      if (cadence === "annual") return Math.round(amount / 12);
      return 0;
    };
    const dependableIncome = incomeSources.filter(
      (i) => i.reliability === "dependable" && i.activeFrom <= now && (i.activeTo === undefined || i.activeTo > now),
    );
    const dependableMonthlyIncome = dependableIncome.reduce((s, i) => s + monthlyEquiv(i.amountMinorUnits, i.cadence), 0);
    const dependableEarnerCount = new Set(dependableIncome.map((i) => i.ownerMemberId)).size;

    // Proxy for "dependents" — see the schema comment on
    // insuranceAdequacyChecks.dependentsCount: count of family-support
    // line items across CONFIRMED timelines only (same
    // confirmed-timeline-only convention Loan & Debt and Investment
    // already use for decision-relevant Goal & Situation Planning data).
    const confirmedTimelineIds = new Set(timelines.filter((t) => t.confirmed === true).map((t) => t._id));
    const dependentsCount = familySupport.filter((f) => confirmedTimelineIds.has(f.timelineId)).length;

    return {
      householdId,
      stateRevision: household?.stateRevision ?? 0,
      totalLifeCoverageMinorUnits,
      totalHealthCoverageMinorUnits,
      dependentsCount,
      outstandingLoanBalanceMinorUnits,
      bundledLifeCoverageMinorUnits,
      dependableMonthlyIncome,
      dependableEarnerCount,
    };
  },
});

// Pure, deterministic — every field here is arithmetic or a threshold
// comparison. Nothing here is AI.
function diagnoseAdequacy(inp: {
  totalLifeCoverageMinorUnits: number;
  totalHealthCoverageMinorUnits: number;
  dependentsCount: number;
  outstandingLoanBalanceMinorUnits: number;
  bundledLifeCoverageMinorUnits: number;
  dependableMonthlyIncome: number;
}): {
  estimatedLifeCoverNeededMinorUnits: number;
  lifeCoverageGapMinorUnits: number;
  healthCoverageAssessment: HealthCoverageAssessment;
  healthCoverMinimumMinorUnits: number;
} {
  const dependableAnnualIncome = inp.dependableMonthlyIncome * 12;
  const estimatedLifeCoverNeededMinorUnits = inp.outstandingLoanBalanceMinorUnits + LIFE_INCOME_REPLACEMENT_YEARS * dependableAnnualIncome;
  const totalEffectiveLifeCover = inp.totalLifeCoverageMinorUnits + inp.bundledLifeCoverageMinorUnits;
  const lifeCoverageGapMinorUnits = estimatedLifeCoverNeededMinorUnits - totalEffectiveLifeCover;

  const healthCoverMinimumMinorUnits = HEALTH_COVER_MINIMUM_PER_PERSON_MINOR_UNITS * (1 + inp.dependentsCount);
  let healthCoverageAssessment: HealthCoverageAssessment;
  if (inp.dependableMonthlyIncome <= 0) {
    healthCoverageAssessment = "INSUFFICIENT_DATA";
  } else if (inp.totalHealthCoverageMinorUnits <= 0) {
    healthCoverageAssessment = "NONE";
  } else if (inp.totalHealthCoverageMinorUnits < healthCoverMinimumMinorUnits) {
    healthCoverageAssessment = "LIKELY_INSUFFICIENT";
  } else {
    healthCoverageAssessment = "LIKELY_ADEQUATE";
  }

  return { estimatedLifeCoverNeededMinorUnits, lifeCoverageGapMinorUnits, healthCoverageAssessment, healthCoverMinimumMinorUnits };
}

export const findCachedAdequacyCheck = internalQuery({
  args: { householdId: v.id("households"), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("insuranceAdequacyChecks").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

// Cross-file read for Investment & Risk Planning's insuranceAdequacyModifier
// hook (see convex/investment.ts). Re-derives membership itself — never
// trusts a passed-in householdId — same pattern as every other internal
// query reached cross-file in this app (e.g. loanDebt.gatherAffordabilityData).
// Returns the MOST RECENT adequacy check regardless of stateRevision
// (unlike the cache lookups above): Investment wants "the latest real
// verdict we have", not "one that exactly matches Investment's own
// current state" — those two services' data can go stale independently.
export const getLatestAdequacyCheckForCaller = internalQuery({
  args: {},
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const rows = await ctx.db
      .query("insuranceAdequacyChecks")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const saveAdequacyCheck = internalMutation({
  args: {
    householdId: v.id("households"),
    totalLifeCoverageMinorUnits: v.number(),
    totalHealthCoverageMinorUnits: v.number(),
    dependentsCount: v.number(),
    outstandingLoanBalanceMinorUnits: v.number(),
    bundledLifeCoverageMinorUnits: v.number(),
    dependableMonthlyIncome: v.number(),
    estimatedLifeCoverNeededMinorUnits: v.number(),
    lifeCoverageGapMinorUnits: v.number(),
    healthCoverageAssessment: v.union(
      v.literal("NONE"),
      v.literal("LIKELY_INSUFFICIENT"),
      v.literal("LIKELY_ADEQUATE"),
      v.literal("INSUFFICIENT_DATA"),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
  },
  returns: v.id("insuranceAdequacyChecks"),
  handler: async (ctx, args) => await ctx.db.insert("insuranceAdequacyChecks", { ...args, createdAt: Date.now() }),
});

export const checkInsuranceAdequacy = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.insuranceRiskPlanning.gatherAdequacyData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      totalLifeCoverageMinorUnits: number;
      totalHealthCoverageMinorUnits: number;
      dependentsCount: number;
      outstandingLoanBalanceMinorUnits: number;
      bundledLifeCoverageMinorUnits: number;
      dependableMonthlyIncome: number;
      dependableEarnerCount: number;
    };
    const diag = diagnoseAdequacy(data);
    const deterministic = {
      totalLifeCoverageMinorUnits: data.totalLifeCoverageMinorUnits,
      totalHealthCoverageMinorUnits: data.totalHealthCoverageMinorUnits,
      dependentsCount: data.dependentsCount,
      outstandingLoanBalanceMinorUnits: data.outstandingLoanBalanceMinorUnits,
      bundledLifeCoverageMinorUnits: data.bundledLifeCoverageMinorUnits,
      dependableMonthlyIncome: data.dependableMonthlyIncome,
      estimatedLifeCoverNeededMinorUnits: diag.estimatedLifeCoverNeededMinorUnits,
      lifeCoverageGapMinorUnits: diag.lifeCoverageGapMinorUnits,
      healthCoverageAssessment: diag.healthCoverageAssessment,
    };
    // Transient extras — not persisted to the strictly-typed schema, same
    // "additive UI need, no schema renegotiation" pattern Investment used
    // for its own calculation breakdown.
    const extras = {
      lifeIncomeReplacementYears: LIFE_INCOME_REPLACEMENT_YEARS,
      healthCoverMinimumMinorUnits: diag.healthCoverMinimumMinorUnits,
      dependableAnnualIncomeMinorUnits: data.dependableMonthlyIncome * 12,
    };

    const cached = await ctx.runQuery(internal.insuranceRiskPlanning.findCachedAdequacyCheck, {
      householdId: data.householdId,
      stateRevision: data.stateRevision,
    });
    if (cached) {
      const c = cached as { _id: Id<"insuranceAdequacyChecks">; narration: { headline: string; plainLanguage: string; caveats: string[] } };
      return { checkId: c._id, ...deterministic, narration: c.narration, ...extras, _fromCache: true };
    }

    const system = `You put an ALREADY-COMPUTED insurance adequacy result into plain language for an Indian household. You are given: total life coverage on file, total health coverage on file, a dependents count, outstanding loan balance, bundled loan-linked life coverage, dependable monthly income, an already-computed estimated life cover need, an already-computed life coverage gap (positive = underinsured, negative or zero = surplus), and an already-decided health coverage assessment state (one of NONE, LIKELY_INSUFFICIENT, LIKELY_ADEQUATE, INSUFFICIENT_DATA). Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- Every number given is FINAL. Never recompute, re-round, or contradict any figure. Never re-judge the health assessment state or suggest it should be different.
- NEVER recommend a specific insurer, product, or premium amount. NEVER say "buy policy X" or name an insurer. This only describes whether current cover appears sufficient against a stated formula — never what to purchase.
- Stay purely descriptive, never advisory. Report the gap as a fact ("the estimated gap is ₹X"), never as a suggestion ("you should consider increasing it by ₹X", "you should get X", "you need to..."). Do not tell the household what action to take — only state what the numbers show.
- Every field ending in "MinorUnits" is a plain rupee amount — write "₹" with Indian digit grouping. Never write "minor units".
- If dependableMonthlyIncome is 0, say plainly that no dependable income is recorded, which limits how meaningful the income-replacement portion of the estimate is.
- "caveats" = 2-3 short statements (e.g. this uses a standard rule of thumb, not personalized advice; it doesn't know your family's actual expenses or existing savings; coverage needs change as debts and income change).`;
    const parsed = await chatJson(system, JSON.stringify(deterministic));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : `Life cover gap: ${rupees(diag.lifeCoverageGapMinorUnits)}`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.insuranceRiskPlanning.saveAdequacyCheck, {
      householdId: data.householdId,
      ...deterministic,
      narration,
      inputStateRevision: data.stateRevision,
    });
    return { checkId: id, ...deterministic, narration, ...extras, _fromCache: false };
  },
});

export const listInsuranceAdequacyChecks = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("insuranceAdequacyChecks").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});

// =====================================================================
// Portability guidance — sourced regulatory process info, NOT
// household-scoped. Accuracy matters more here than almost anywhere
// else in the app: if the source can't be reliably scraped/parsed, say
// so honestly rather than guessing at the process.
// =====================================================================

const PORTABILITY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — regulatory process pages change very rarely

export const ensurePortabilityGuides = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireMembership(ctx); // signed-in gate only — not household-scoped
    return null;
  },
});

export const getPortabilityGuideInternal = internalQuery({
  args: { insuranceType: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("insurancePortabilityGuides").withIndex("by_type", (q) => q.eq("insuranceType", args.insuranceType)).collect();
    const fresh = rows.filter((r) => Date.now() - r.fetchedAt < PORTABILITY_MAX_AGE_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return fresh ?? null;
  },
});

export const savePortabilityGuide = internalMutation({
  args: {
    insuranceType: v.string(),
    steps: v.array(v.object({ title: v.string(), detail: v.string() })),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
  },
  returns: v.id("insurancePortabilityGuides"),
  handler: async (ctx, args) =>
    await ctx.db.insert("insurancePortabilityGuides", {
      insuranceType: args.insuranceType,
      steps: args.steps,
      sourceSnapshotId: args.sourceSnapshotId,
      fetchedAt: Date.now(),
    }),
});

export const savePortabilitySourceSnapshot = internalMutation({
  args: { url: v.string(), label: v.string(), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => {
    let source = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    const sourceId = source
      ? source._id
      : await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: "official-regulator" });
    return await ctx.db.insert("sourceSnapshots", { sourceRegistryId: sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 3000) });
  },
});

// One real scrape of IRDAI's official health-insurance-portability
// page, parsed into clear steps by a grounded AI pass (never invented —
// "grounded: false" if the page doesn't actually lay out a step
// sequence). If the source is unreachable, this returns an honest
// SOURCE_UNAVAILABLE state rather than guessing at the process —
// deliberately NOT using a generic fallback here, unlike category
// education, because a wrong regulatory process is actively harmful,
// not just less helpful.
export const refreshPortabilityGuide = action({
  args: { insuranceType: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(api.insuranceRiskPlanning.ensurePortabilityGuides, {}); // signed-in gate
    const cached = await ctx.runQuery(internal.insuranceRiskPlanning.getPortabilityGuideInternal, { insuranceType: args.insuranceType });
    if (cached) return { state: "COMPUTED" as const, ...cached, _fromCache: true };

    // IRDAI's actual "Insurance Regulatory and Development Authority of
    // India (Health Insurance) Regulations, 2016" (consolidated with
    // amendments), hosted by Invest India (a Government of India national
    // investment-promotion agency) — Schedule-I of this regulation is the
    // real, official, numbered portability procedure. Verified reachable
    // and containing the actual Schedule-I text during this build
    // (2026-09-17): several other candidate IRDAI-domain URLs were tried
    // first (policyholder.gov.in — DNS failure; irdai.gov.in's own portal
    // — no plain-text procedure page; a general Master Circular that only
    // mentions "portability" in passing, never spelling out the steps)
    // and rejected before finding this one.
    const SOURCE_URL =
      "https://static.investindia.gov.in/s3fs-public/2022-02/CONSOLIDATED%20HEALTH%20INSURANCE%20REGULATIONS%202016%20WITH%20AMENDMENTS.pdf";
    const SOURCE_LABEL = "IRDAI (Health Insurance) Regulations, 2016 — Schedule-I, Portability (via investindia.gov.in)";
    try {
      const doc = await firecrawl.scrape(ctx, SOURCE_URL, { formats: ["markdown"] });
      const full = (doc.markdown ?? "") as string;
      // Schedule-I ("Portability of Health Insurance Policies...") sits
      // deep in this ~80,000-character consolidated regulation document,
      // not near the start — locate it by its actual heading text rather
      // than assuming content is near the front, same discipline as
      // Loan & Debt's non-fixed-column table parsing.
      const headingIdx = full.indexOf("Portability of Health Insurance Policies");
      const md = headingIdx >= 0 ? full.slice(headingIdx, headingIdx + 6000) : full.slice(0, 8000);
      if (md.trim() === "") {
        return { state: "SOURCE_UNAVAILABLE" as const, reason: "The official portability source document returned no readable content this time." };
      }
      const sourceSnapshotId = (await ctx.runMutation(internal.insuranceRiskPlanning.savePortabilitySourceSnapshot, {
        url: SOURCE_URL,
        label: SOURCE_LABEL,
        contentSummary: md,
      })) as Id<"sourceSnapshots">;
      const system = `You read real reference text about the official health insurance portability process in India (moving your policy to a new insurer without losing accumulated benefits) and extract it into a clear ordered list of steps. Return ONLY JSON: { "steps": [{ "title": string, "detail": string }], "grounded": boolean }. Set "grounded": false and "steps": [] if the reference text does not actually lay out a step-by-step process — do not invent steps or guess at the regulatory process. Ground every step ONLY in what the reference text actually says; never add a step the text doesn't support. 3-8 steps if grounded.`;
      const parsed = await chatJson(system, JSON.stringify({ referenceText: md }));
      const grounded = parsed.grounded === true && Array.isArray(parsed.steps) && parsed.steps.length > 0;
      if (!grounded) {
        return {
          state: "SOURCE_UNAVAILABLE" as const,
          reason: "The official source page was reached, but its content couldn't be reliably parsed into a step-by-step process — showing a guessed process would risk being wrong about a regulatory procedure, so this is left honestly unavailable instead.",
        };
      }
      const steps = (parsed.steps as unknown[])
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .map((s) => ({
          title: typeof s.title === "string" ? s.title : "Step",
          detail: typeof s.detail === "string" ? s.detail : "",
        }));
      const id = await ctx.runMutation(internal.insuranceRiskPlanning.savePortabilityGuide, {
        insuranceType: args.insuranceType,
        steps,
        sourceSnapshotId,
      });
      return { state: "COMPUTED" as const, guideId: id, insuranceType: args.insuranceType, steps, sourceSnapshotId, sourceLabel: SOURCE_LABEL, sourceUrl: SOURCE_URL, _fromCache: false };
    } catch (err) {
      return { state: "SOURCE_UNAVAILABLE" as const, reason: `The official portability source page couldn't be reached (${err instanceof Error ? err.message : String(err)}).` };
    }
  },
});

// =====================================================================
// Gap detection — pure deterministic cross-referencing. No AI decides
// whether a gap exists, only whether to narrate it.
// =====================================================================

export const gatherGapData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const household = await ctx.db.get("households", householdId);

    const [policies, obligations, incomeSources, sideIncomeEntries] = await Promise.all([
      ctx.db.query("insurancePolicies").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("incomeSources").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("sideIncomeEntries").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
    ]);

    const outstandingLoanBalanceMinorUnits = obligations.reduce((s, o) => s + o.balanceMinorUnits, 0);
    const totalLifeCoverageMinorUnits = policies.filter((p) => p.type === "life").reduce((s, p) => s + p.coverageAmountMinorUnits, 0);
    const bundledLifeCoverageMinorUnits = obligations.reduce((s, o) => s + (o.bundledInsuranceCoverageMinorUnits ?? 0), 0);
    const totalHealthCoverageMinorUnits = policies.filter((p) => p.type === "health").reduce((s, p) => s + p.coverageAmountMinorUnits, 0);
    const totalOtherCoverageCount = policies.filter((p) => p.type === "other").length;

    const now = Date.now();
    const monthlyEquiv = (amount: number, cadence: string): number => {
      if (cadence === "monthly") return amount;
      if (cadence === "weekly") return Math.round((amount * 52) / 12);
      if (cadence === "annual") return Math.round(amount / 12);
      return 0;
    };
    const dependableIncome = incomeSources.filter(
      (i) => i.reliability === "dependable" && i.activeFrom <= now && (i.activeTo === undefined || i.activeTo > now),
    );
    const dependableEarnerCount = new Set(dependableIncome.map((i) => i.ownerMemberId)).size;
    const dependableMonthlyIncome = dependableIncome.reduce((s, i) => s + monthlyEquiv(i.amountMinorUnits, i.cadence), 0);

    const hasActiveBusiness = sideIncomeEntries.some((e) => e.kind === "business" && e.status === "active");

    return {
      householdId,
      stateRevision: household?.stateRevision ?? 0,
      outstandingLoanBalanceMinorUnits,
      totalLifeCoverageMinorUnits,
      bundledLifeCoverageMinorUnits,
      totalHealthCoverageMinorUnits,
      totalOtherCoverageCount,
      dependableEarnerCount,
      dependableMonthlyIncome,
      hasActiveBusiness,
    };
  },
});

type Gap = { gapType: string; description: string; severity: "notable" | "significant" };

// Pure deterministic checks — see the module comment: no AI decides
// whether a gap exists here, only whether to narrate it (in
// checkInsuranceGaps below).
function detectGaps(inp: {
  outstandingLoanBalanceMinorUnits: number;
  totalLifeCoverageMinorUnits: number;
  bundledLifeCoverageMinorUnits: number;
  totalHealthCoverageMinorUnits: number;
  totalOtherCoverageCount: number;
  dependableEarnerCount: number;
  dependableMonthlyIncome: number;
  hasActiveBusiness: boolean;
}): Gap[] {
  const gaps: Gap[] = [];

  // (a) Outstanding debt with insufficient or no life cover to clear it.
  const effectiveLifeCover = inp.totalLifeCoverageMinorUnits + inp.bundledLifeCoverageMinorUnits;
  if (inp.outstandingLoanBalanceMinorUnits > 0) {
    if (effectiveLifeCover <= 0) {
      gaps.push({
        gapType: "noLifeCoverWithDebt",
        description: `You have ${rupees(inp.outstandingLoanBalanceMinorUnits)} in outstanding loan balance and no life insurance or bundled loan cover recorded to clear it.`,
        severity: "significant",
      });
    } else if (effectiveLifeCover < inp.outstandingLoanBalanceMinorUnits) {
      gaps.push({
        gapType: "noLifeCoverWithDebt",
        description: `Your recorded life cover (${rupees(effectiveLifeCover)}, including any bundled loan cover) is less than your outstanding loan balance (${rupees(inp.outstandingLoanBalanceMinorUnits)}).`,
        severity: "notable",
      });
    }
  }

  // (b) Income concentrated in exactly one dependable earner, with no or
  // low health cover.
  if (inp.dependableEarnerCount === 1) {
    if (inp.totalHealthCoverageMinorUnits <= 0) {
      gaps.push({
        gapType: "noHealthCoverSoleEarner",
        description: "Your dependable income comes from a single earner, and no health insurance is recorded for the household.",
        severity: "significant",
      });
    } else if (inp.totalHealthCoverageMinorUnits < HEALTH_COVER_MINIMUM_PER_PERSON_MINOR_UNITS) {
      gaps.push({
        gapType: "noHealthCoverSoleEarner",
        description: `Your dependable income comes from a single earner, and recorded health cover (${rupees(inp.totalHealthCoverageMinorUnits)}) is below a commonly-cited per-person minimum (${rupees(HEALTH_COVER_MINIMUM_PER_PERSON_MINOR_UNITS)}).`,
        severity: "notable",
      });
    }
  }

  // (c) An active business idea with no policy recorded in this app's
  // closest available category for business/liability-type cover.
  // Honest limitation, stated plainly: this app doesn't yet have a
  // dedicated business-liability category, so this checks for any
  // "Other" type policy as the closest available proxy — not a claim
  // that liability itself was or wasn't considered.
  if (inp.hasActiveBusiness && inp.totalOtherCoverageCount === 0) {
    gaps.push({
      gapType: "businessWithoutLiabilityConsidered",
      description: "You have an active business idea in Side-Income & Business Planning, but no insurance policy of a type that could cover business-related liability is recorded (this app doesn't yet have a dedicated business-liability category — this checks for any \"Other\" type policy as the closest proxy).",
      severity: "notable",
    });
  }

  return gaps;
}

export const findCachedGapDetection = internalQuery({
  args: { householdId: v.id("households"), stateRevision: v.number() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("insuranceGapDetections").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.inputStateRevision === args.stateRevision).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  },
});

export const saveGapDetection = internalMutation({
  args: {
    householdId: v.id("households"),
    gaps: v.array(
      v.object({
        gapType: v.string(),
        description: v.string(),
        severity: v.union(v.literal("notable"), v.literal("significant")),
      }),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
  },
  returns: v.id("insuranceGapDetections"),
  handler: async (ctx, args) => await ctx.db.insert("insuranceGapDetections", { ...args, createdAt: Date.now() }),
});

export const checkInsuranceGaps = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const data = (await ctx.runQuery(internal.insuranceRiskPlanning.gatherGapData, {})) as {
      householdId: Id<"households">;
      stateRevision: number;
      outstandingLoanBalanceMinorUnits: number;
      totalLifeCoverageMinorUnits: number;
      bundledLifeCoverageMinorUnits: number;
      totalHealthCoverageMinorUnits: number;
      totalOtherCoverageCount: number;
      dependableEarnerCount: number;
      dependableMonthlyIncome: number;
      hasActiveBusiness: boolean;
    };
    const gaps = detectGaps(data);

    const cached = await ctx.runQuery(internal.insuranceRiskPlanning.findCachedGapDetection, {
      householdId: data.householdId,
      stateRevision: data.stateRevision,
    });
    if (cached) {
      const c = cached as { _id: Id<"insuranceGapDetections">; narration: { headline: string; plainLanguage: string; caveats: string[] } };
      return { detectionId: c._id, gaps, narration: c.narration, _fromCache: true };
    }

    const system = `You put an ALREADY-DETECTED list of insurance/protection gaps into plain language for an Indian household. You are given an array of gaps, each with a gapType, a plain description, and a severity ("notable" or "significant"). If the array is empty, no gaps were found. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }.
Hard rules:
- The gap list is FINAL — do not add, remove, or re-judge any gap, and do not invent a new gap that isn't in the list.
- NEVER recommend a specific insurer, product, or premium amount, and never say "buy policy X".
- Stay purely descriptive, never advisory. Describe each gap as a fact about the household's current data, never as a suggestion ("you should get...", "you should consider..."). Do not tell the household what action to take.
- If the list is empty, the headline and plainLanguage should say plainly that no gaps were found by this check, while making clear this only checked the specific patterns this service looks for (not a full audit).
- Every field ending in "MinorUnits" mentioned in a gap description is already formatted with ₹ — do not add new figures.
- "caveats" = 2-3 short statements (e.g. this only checks a specific, limited set of patterns; it isn't a substitute for a full insurance review; it doesn't know about cover you have outside this app).`;
    const parsed = await chatJson(system, JSON.stringify({ gaps }));
    const narration = {
      headline: typeof parsed.headline === "string" ? parsed.headline : gaps.length === 0 ? "No gaps found by this check" : `${gaps.length} potential gap${gaps.length === 1 ? "" : "s"} found`,
      plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : "",
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === "string") : [],
    };
    const id = await ctx.runMutation(internal.insuranceRiskPlanning.saveGapDetection, {
      householdId: data.householdId,
      gaps,
      narration,
      inputStateRevision: data.stateRevision,
    });
    return { detectionId: id, gaps, narration, _fromCache: false };
  },
});

export const listInsuranceGapDetections = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("insuranceGapDetections").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});

// =====================================================================
// Single "ask box" entry point — deterministic keyword routing, same
// pattern as Investment's askInvestmentQuestion.
// =====================================================================

const ADEQUACY_KEYWORDS = ["enough", "adequate", "underinsured", "under-insured", "sufficient"];
const PORTABILITY_KEYWORDS = ["switch", "port", "transfer", "change insurer", "change my insurer", "new insurer"];
const GAP_KEYWORDS = ["missing", "gap", "exposed", "expose", "risk", "overlook"];

export const askInsuranceQuestion = action({
  args: { question: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const q = args.question.toLowerCase();

    if (PORTABILITY_KEYWORDS.some((k) => q.includes(k))) {
      const result = await ctx.runAction(api.insuranceRiskPlanning.refreshPortabilityGuide, { insuranceType: "health" });
      return { route: "portabilityGuide", question: args.question, result };
    }

    if (GAP_KEYWORDS.some((k) => q.includes(k))) {
      const result = await ctx.runAction(api.insuranceRiskPlanning.checkInsuranceGaps, {});
      return { route: "gapDetection", question: args.question, result };
    }

    if (ADEQUACY_KEYWORDS.some((k) => q.includes(k))) {
      const result = await ctx.runAction(api.insuranceRiskPlanning.checkInsuranceAdequacy, {});
      return { route: "adequacyCheck", question: args.question, result };
    }

    // Default fallback — adequacy is this service's headline calculation,
    // same role readiness plays for Investment's own default fallback.
    const result = await ctx.runAction(api.insuranceRiskPlanning.checkInsuranceAdequacy, {});
    return { route: "adequacyCheck", question: args.question, result };
  },
});

// =====================================================================
// "Email me a summary" — exact same pattern as Investment/Loan & Debt.
// Works for either the adequacy check or the gap detection result:
// reuses that result's own narration verbatim; recipient resolved
// server-side; delivery status via AgentMail's own outboundId.
// =====================================================================

const vInsuranceNarration = v.object({
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

function composeInsuranceEmailText(narration: { headline: string; plainLanguage: string; caveats: string[] }, figures: { label: string; value: string }[]): string {
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
  lines.push("This is educational information, not personalized financial or insurance advice.");
  lines.push("— Sent from FinComp's Insurance, Protection & Financial Rights, at your request.");
  return lines.join("\n");
}

function pickInsuranceFigures(deterministic: Record<string, unknown>): { label: string; value: string }[] {
  const wanted: [string, string][] = [
    ["totalLifeCoverageMinorUnits", "Total life coverage"],
    ["estimatedLifeCoverNeededMinorUnits", "Estimated life cover needed"],
    ["lifeCoverageGapMinorUnits", "Life coverage gap"],
    ["totalHealthCoverageMinorUnits", "Total health coverage"],
    ["outstandingLoanBalanceMinorUnits", "Outstanding loan balance"],
  ];
  const out: { label: string; value: string }[] = [];
  for (const [key, label] of wanted) {
    const val = deterministic[key];
    if (typeof val === "number") out.push({ label, value: rupees(val) });
  }
  return out;
}

export const emailInsuranceSummary = action({
  args: { narration: vInsuranceNarration, deterministic: v.any() },
  returns: v.object({ status: v.union(v.literal("sent"), v.literal("failed")), detail: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const toEmail = (await ctx.runQuery(internal.insuranceRiskPlanning.getCallerEmail, {})) as string | null;
    if (!toEmail) return { status: "failed" as const, detail: "No email address is on file for this account." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) {
      return { status: "failed" as const, detail: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    }
    const figures = pickInsuranceFigures((args.deterministic ?? {}) as Record<string, unknown>);
    const text = composeInsuranceEmailText(args.narration, figures);
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
