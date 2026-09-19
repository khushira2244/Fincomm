// Side-Income & Business Planning (Service #5). Two paths — job and
// business — sharing the household's real Financial Foundation numbers
// (via runway's own query) and the Loan & Debt reserve-check pattern.
//
// Boundary: every number, every conflict verdict, and every scheme match
// is produced by the deterministic functions in this file or is a raw
// Firecrawl search result. OpenAI only ever narrates a finished
// deterministic object or reasons over real search results already
// fetched — it never invents an income figure, a reserve-conflict
// verdict, or a scheme-eligibility decision. If a Firecrawl source is
// unreachable or nothing usable comes back, that's said honestly, never
// papered over with an invented number (same pattern as Loan & Debt's
// unreachable-source handling).

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);

const rupees = (minor: number) => `₹${Math.round(minor).toLocaleString("en-IN")}`;

const DEEPDIVE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches Loan & Debt's rate-snapshot threshold

const JOB_TOPICS = ["howToStart", "whereToApply", "challenges", "resources", "motivation", "blogs"] as const;
const BUSINESS_TOPICS = [
  "ideaViability",
  "startupCapital",
  "schemeEligibility",
  "localViability",
  "maturityPath",
] as const;
type JobTopic = (typeof JOB_TOPICS)[number];
type BusinessTopic = (typeof BUSINESS_TOPICS)[number];

const EARNINGS_EVIDENCE_RANK: Record<string, number> = {
  none: 0,
  selfReportedFirstPayment: 1,
  repeatedSelfReported: 2,
  confirmedViaDocumentIntelligence: 3,
};

// =====================================================================
// Free-text intent extraction — lets a household just describe what
// they're looking for in their own words instead of filling in every
// structured field by hand. EXTRACTION ONLY, same boundary as Document
// Intelligence / Government Economic Intelligence's livelihood
// profiles: pulls out what the text actually says, never invents a
// number or guesses a plausible-sounding default. The frontend only
// ever uses an extracted value to fill in a field the household left
// blank — it never overwrites something they already typed themselves.
// =====================================================================

// Signed-in gate only — this doesn't read or write any household data
// (pure text-in/JSON-out), but still shouldn't be callable by a signed
// -out client. Actions can't call requireMembership directly (no
// ctx.db), so this mutation does the check instead — same pattern as
// every other service's "ensureAccess"-style gate.
export const ensureIntentExtractionAccess = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireMembership(ctx);
    return null;
  },
});

export const extractJobIntent = action({
  args: { freeText: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(api.sideIncome.ensureIntentExtractionAccess, {});
    const system = `You extract structured fields from a household member's free-text description of what part-time/side-income work they're looking for. This is EXTRACTION ONLY — pull out what the text actually says, never infer or invent a fact the text doesn't support. Return ONLY JSON: { "typeOfWork": string | null, "hoursPerWeek": number | null, "availabilityWindow": string | null, "targetAmountMinorUnits": number | null, "workLocationPreference": "online" | "offline" | "either" | null, "location": string | null }. "typeOfWork" is a short label (e.g. "Online tutoring", "Freelance writing"). "hoursPerWeek" is a plausible weekly-hours NUMBER only if one is actually stated or a clear range/day-count is given — never invent one from vague phrasing. "availabilityWindow" is one of "Weekday evenings", "Weekday mornings", "Weekends", "Flexible / anytime" only if genuinely implied, else null. "targetAmountMinorUnits" is a monthly rupee figure (whole rupees, not paise) ONLY if the text states one. "workLocationPreference" is "online" if they want remote-only, "offline" if they explicitly want local/in-person only, "either" if they say they're open to both, else null. "location" is a city/area name ONLY if actually named. Use null for anything the text genuinely doesn't say.`;
    const parsed = await chatJson(system, JSON.stringify({ freeText: args.freeText }));
    return {
      typeOfWork: typeof parsed.typeOfWork === "string" && parsed.typeOfWork.trim() ? parsed.typeOfWork.trim() : null,
      hoursPerWeek: typeof parsed.hoursPerWeek === "number" ? Math.round(parsed.hoursPerWeek) : null,
      availabilityWindow: typeof parsed.availabilityWindow === "string" && parsed.availabilityWindow.trim() ? parsed.availabilityWindow.trim() : null,
      targetAmountMinorUnits: typeof parsed.targetAmountMinorUnits === "number" ? Math.round(parsed.targetAmountMinorUnits) : null,
      workLocationPreference: parsed.workLocationPreference === "online" || parsed.workLocationPreference === "offline" || parsed.workLocationPreference === "either" ? parsed.workLocationPreference : null,
      location: typeof parsed.location === "string" && parsed.location.trim() ? parsed.location.trim() : null,
    };
  },
});

export const extractBusinessIntent = action({
  args: { freeText: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(api.sideIncome.ensureIntentExtractionAccess, {});
    const system = `You extract structured fields from a household's free-text description of a small business idea they're considering. This is EXTRACTION ONLY — pull out what the text actually says, never infer or invent a fact the text doesn't support. Return ONLY JSON: { "ideaDescription": string | null, "startupCapitalMinorUnits": number | null, "effortHoursPerWeek": number | null, "rampUpMonths": number | null }. "ideaDescription" is a short, clean restatement of the idea (e.g. "home-based tiffin service") — grounded only in what's actually described. The other three are whole-number figures ONLY if the text actually states or clearly implies one — never invent a plausible-sounding default. Use null for anything the text genuinely doesn't say.`;
    const parsed = await chatJson(system, JSON.stringify({ freeText: args.freeText }));
    return {
      ideaDescription: typeof parsed.ideaDescription === "string" && parsed.ideaDescription.trim() ? parsed.ideaDescription.trim() : null,
      startupCapitalMinorUnits: typeof parsed.startupCapitalMinorUnits === "number" ? Math.round(parsed.startupCapitalMinorUnits) : null,
      effortHoursPerWeek: typeof parsed.effortHoursPerWeek === "number" ? Math.round(parsed.effortHoursPerWeek) : null,
      rampUpMonths: typeof parsed.rampUpMonths === "number" ? Math.round(parsed.rampUpMonths) : null,
    };
  },
});

// =====================================================================
// Entries — CRUD with kind-specific validation at the mutation level,
// not just schema optionality.
// =====================================================================

export const createSideIncomeEntry = mutation({
  args: {
    kind: v.union(v.literal("job"), v.literal("business")),
    timelineId: v.optional(v.id("timelines")),
    source: v.optional(v.union(v.literal("userDeclared"), v.literal("routedFromLoanDebt"))),
    routedGapMinorUnits: v.optional(v.number()),
    // job fields
    typeOfWork: v.optional(v.string()),
    hoursPerWeek: v.optional(v.number()),
    availabilityWindow: v.optional(v.string()),
    rateKnown: v.optional(v.boolean()),
    rateMinorUnitsPerHour: v.optional(v.number()),
    targetAmountMinorUnits: v.optional(v.number()),
    calcMode: v.optional(v.union(v.literal("timeFirst"), v.literal("incomeFirst"))),
    workLocationPreference: v.optional(v.union(v.literal("online"), v.literal("offline"), v.literal("either"))),
    location: v.optional(v.string()),
    // business fields
    ideaDescription: v.optional(v.string()),
    startupCapitalMinorUnits: v.optional(v.number()),
    effortHoursPerWeek: v.optional(v.number()),
    rampUpMonths: v.optional(v.number()),
  },
  returns: v.id("sideIncomeEntries"),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    assertNoCrossKindFields(args.kind, args);
    if (args.rateMinorUnitsPerHour !== undefined) assertIntegerMinorUnits(args.rateMinorUnitsPerHour, "rateMinorUnitsPerHour");
    if (args.targetAmountMinorUnits !== undefined) assertIntegerMinorUnits(args.targetAmountMinorUnits, "targetAmountMinorUnits");
    if (args.startupCapitalMinorUnits !== undefined) assertIntegerMinorUnits(args.startupCapitalMinorUnits, "startupCapitalMinorUnits");
    if (args.routedGapMinorUnits !== undefined) assertIntegerMinorUnits(args.routedGapMinorUnits, "routedGapMinorUnits");
    const now = Date.now();
    return await ctx.db.insert("sideIncomeEntries", {
      householdId: membership.householdId,
      timelineId: args.timelineId,
      kind: args.kind,
      source: args.source ?? "userDeclared",
      routedGapMinorUnits: args.routedGapMinorUnits,
      status: "exploring",
      earningsEvidence: "none",
      typeOfWork: args.typeOfWork,
      hoursPerWeek: args.hoursPerWeek,
      availabilityWindow: args.availabilityWindow,
      rateKnown: args.rateKnown,
      rateMinorUnitsPerHour: args.rateMinorUnitsPerHour,
      targetAmountMinorUnits: args.targetAmountMinorUnits,
      calcMode: args.calcMode,
      workLocationPreference: args.workLocationPreference,
      location: args.location,
      ideaDescription: args.ideaDescription,
      startupCapitalMinorUnits: args.startupCapitalMinorUnits,
      effortHoursPerWeek: args.effortHoursPerWeek,
      rampUpMonths: args.rampUpMonths,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Rejects a business-only field on a job entry or vice versa — cross
// -kind pollution is blocked here, not just left to optionality.
function assertNoCrossKindFields(kind: "job" | "business", args: Record<string, unknown>): void {
  const jobOnly = ["typeOfWork", "hoursPerWeek", "availabilityWindow", "rateKnown", "rateMinorUnitsPerHour", "targetAmountMinorUnits", "calcMode", "workLocationPreference", "location"];
  const businessOnly = ["ideaDescription", "startupCapitalMinorUnits", "effortHoursPerWeek", "rampUpMonths"];
  const forbidden = kind === "job" ? businessOnly : jobOnly;
  for (const key of forbidden) {
    if (args[key] !== undefined) {
      throw new ConvexError(`"${key}" is a ${kind === "job" ? "business" : "job"}-only field and cannot be set on a "${kind}" entry.`);
    }
  }
}

export const updateSideIncomeEntry = mutation({
  args: {
    entryId: v.id("sideIncomeEntries"),
    status: v.optional(v.union(v.literal("exploring"), v.literal("selected"), v.literal("active"), v.literal("graduated"))),
    earningsEvidence: v.optional(
      v.union(
        v.literal("none"),
        v.literal("selfReportedFirstPayment"),
        v.literal("repeatedSelfReported"),
        v.literal("confirmedViaDocumentIntelligence"),
      ),
    ),
    typeOfWork: v.optional(v.string()),
    hoursPerWeek: v.optional(v.number()),
    availabilityWindow: v.optional(v.string()),
    rateKnown: v.optional(v.boolean()),
    rateMinorUnitsPerHour: v.optional(v.number()),
    targetAmountMinorUnits: v.optional(v.number()),
    calcMode: v.optional(v.union(v.literal("timeFirst"), v.literal("incomeFirst"))),
    workLocationPreference: v.optional(v.union(v.literal("online"), v.literal("offline"), v.literal("either"))),
    location: v.optional(v.string()),
    ideaDescription: v.optional(v.string()),
    startupCapitalMinorUnits: v.optional(v.number()),
    effortHoursPerWeek: v.optional(v.number()),
    rampUpMonths: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) {
      throw new ConvexError("Side-income entry not found.");
    }
    const { entryId, ...patch } = args;
    assertNoCrossKindFields(entry.kind, patch);
    if (patch.rateMinorUnitsPerHour !== undefined) assertIntegerMinorUnits(patch.rateMinorUnitsPerHour, "rateMinorUnitsPerHour");
    if (patch.targetAmountMinorUnits !== undefined) assertIntegerMinorUnits(patch.targetAmountMinorUnits, "targetAmountMinorUnits");
    if (patch.startupCapitalMinorUnits !== undefined) assertIntegerMinorUnits(patch.startupCapitalMinorUnits, "startupCapitalMinorUnits");
    await ctx.db.patch(args.entryId, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

export const listSideIncomeEntries = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("sideIncomeEntries")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
  },
});

export const getSideIncomeEntry = query({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) return null;
    return entry;
  },
});

// =====================================================================
// Job path — time-first / income-first reverse calculation.
// Monthly income = hoursPerWeek × rate × (52 weeks / 12 months). Pure
// math, both directions reuse the exact same formula — no AI involved.
// =====================================================================

export function computeJobMonthlyIncomeMinor(hoursPerWeek: number, rateMinorUnitsPerHour: number): number {
  return Math.round(hoursPerWeek * rateMinorUnitsPerHour * (52 / 12));
}

// Kept to 4 decimal places (not 2) so the round-trip check below stays
// accurate to well under ₹1 — rounding hours to 2dp for display is the
// UI's job, not this function's; doing it here was compounding into a
// several-rupee round-trip drift.
export function computeJobHoursPerWeekNeeded(targetMonthlyIncomeMinorUnits: number, rateMinorUnitsPerHour: number): number {
  return Math.round(((targetMonthlyIncomeMinorUnits / rateMinorUnitsPerHour) * (12 / 52)) * 10000) / 10000;
}

function assertJobEntryReady(entry: Record<string, unknown>): void {
  if (entry.kind !== "job") {
    throw new ConvexError(`This is a job-path calculation, but entry ${String(entry._id)} is kind "${String(entry.kind)}".`);
  }
  if (entry.hoursPerWeek === undefined || entry.hoursPerWeek === null) {
    throw new ConvexError('This job entry is missing "hoursPerWeek", which this calculation requires.');
  }
}

// Rate-known path: pure deterministic reverse calculation, no Firecrawl,
// no OpenAI. Verifies round-trip consistency itself (income → hours →
// income) so the caller can confirm both directions agree.
export const calculateJobIncome = query({
  args: {
    entryId: v.id("sideIncomeEntries"),
    mode: v.union(v.literal("timeFirst"), v.literal("incomeFirst")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) {
      throw new ConvexError("Side-income entry not found.");
    }
    assertJobEntryReady(entry);
    if (!entry.rateKnown || entry.rateMinorUnitsPerHour === undefined) {
      return {
        state: "RATE_UNKNOWN",
        reason: 'This entry\'s hourly rate isn\'t known yet — use "estimateJobIncomeRange" for a rough, clearly-labelled range instead.',
      };
    }
    const rate = entry.rateMinorUnitsPerHour;
    const hoursPerWeek = entry.hoursPerWeek as number;
    if (args.mode === "timeFirst") {
      const monthlyIncomeMinorUnits = computeJobMonthlyIncomeMinor(hoursPerWeek, rate);
      const roundTripHours = computeJobHoursPerWeekNeeded(monthlyIncomeMinorUnits, rate);
      return {
        state: "COMPUTED",
        mode: "timeFirst",
        hoursPerWeek,
        rateMinorUnitsPerHour: rate,
        monthlyIncomeMinorUnits,
        roundTrip: { hoursPerWeek: roundTripHours, consistent: Math.abs(roundTripHours - hoursPerWeek) < 0.1 },
      };
    }
    const target = entry.targetAmountMinorUnits;
    if (target === undefined) {
      return {
        state: "MISSING_TARGET",
        reason: 'incomeFirst mode requires "targetAmountMinorUnits" to be set on the entry first.',
      };
    }
    const hoursNeeded = computeJobHoursPerWeekNeeded(target, rate);
    const roundTripIncome = computeJobMonthlyIncomeMinor(hoursNeeded, rate);
    return {
      state: "COMPUTED",
      mode: "incomeFirst",
      targetMonthlyIncomeMinorUnits: target,
      rateMinorUnitsPerHour: rate,
      hoursPerWeekNeeded: hoursNeeded,
      roundTrip: { monthlyIncomeMinorUnits: roundTripIncome, consistent: Math.abs(roundTripIncome - target) <= 1 },
    };
  },
});

// Rate-unknown path: one Firecrawl search + one OpenAI reasoning pass to
// produce a rough range. Always isRoughEstimate: true. If the search
// fails or returns nothing usable, this says so — never invents a number.
// FRONTEND-REBUILD NOTE (2026-09-13): originally returned exactly one
// estimate per call. The new Screen 1 mockup shows several distinct
// opportunity cards generated from one "Find Ideas" click, so this now
// asks the same single Firecrawl search for 2-3 DISTINCT candidates in
// one OpenAI pass instead of one. Same AI boundary as before — every
// candidate must be grounded in the real snippets, isRoughEstimate is
// always true, and an empty/insufficient search still returns state
// SOURCE_UNAVAILABLE / INSUFFICIENT_SIGNAL rather than inventing one.
// The per-candidate "reasoning" ( -> "why this fits") is NOT persisted
// to the sideIncomeOpportunities row (no schema change) — it's returned
// to the caller for immediate display only.
export const estimateJobIncomeRange = action({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const entry = (await ctx.runQuery(internal.sideIncome.requireOwnedEntryInternal, { entryId: args.entryId })) as Record<string, unknown> | null;
    if (entry === null) throw new ConvexError("Side-income entry not found.");
    assertJobEntryReady(entry);
    // Location scoping — never guessed. A household open to offline/local
    // work gets a genuinely location-scoped search (when they've given a
    // location); "online" stays India-wide since location is irrelevant
    // for remote work; "offline"/"either" with no location given is
    // honestly left India-wide rather than inventing a city.
    const locationPref = entry.workLocationPreference as "online" | "offline" | "either" | undefined;
    const location = typeof entry.location === "string" ? entry.location.trim() : "";
    const locationScope = locationPref !== "online" && location !== "" ? location : "India";
    const queryText = `typical hourly or monthly pay range for ${entry.typeOfWork ?? "part-time online or local"} work in ${locationScope} ${new Date().getFullYear()}`;
    let searchSummary = "";
    let sourceSnapshotId: Id<"sourceSnapshots"> | null = null;
    try {
      const results = await firecrawl.search(ctx, queryText, { limit: 5, sources: ["web"] });
      const items = (results.web ?? []).slice(0, 5);
      if (items.length === 0) {
        return { state: "SOURCE_UNAVAILABLE", reason: "The search returned no results — no rough estimate can be generated right now." };
      }
      searchSummary = items
        .map((it) => `${("title" in it && it.title) || ""}: ${("description" in it && it.description) || ""}`)
        .join("\n")
        .slice(0, 3500);
      sourceSnapshotId = await ctx.runMutation(internal.sideIncome.saveSearchSnapshot, {
        queryText,
        contentSummary: searchSummary,
      });
    } catch (err) {
      return {
        state: "SOURCE_UNAVAILABLE",
        reason: `The search couldn't be completed (${err instanceof Error ? err.message : String(err)}) — no rough estimate can be generated right now.`,
      };
    }
    const locationInstruction =
      locationPref === "online"
        ? "The household wants ONLINE/remote work only — every opportunity's \"mode\" must be \"online\"."
        : locationPref === "offline"
          ? `The household wants OFFLINE/local work only${location ? ` in ${location}` : ""} — every opportunity's "mode" must be "offline", grounded in what the snippets actually say is available there.`
          : locationPref === "either" && location
            ? `The household is open to either online or local work${location ? ` (local means ${location})` : ""} — set each opportunity's "mode" to whichever the snippets actually support.`
            : "The household hasn't stated an online/offline preference — set each opportunity's \"mode\" to whichever the snippets actually support.";
    const system = `You read real web search snippets about pay for part-time/side work and propose 2-3 DISTINCT, realistic opportunities for someone with ${entry.hoursPerWeek} hours/week available${entry.typeOfWork ? ` interested in "${entry.typeOfWork}"` : " who hasn't named a specific kind of work"}. ${locationInstruction} Return ONLY JSON: { "opportunities": [ { "title": string, "mode": "online" | "offline", "estimateLowMinorUnits": number, "estimateHighMinorUnits": number, "reasoning": string } ], "note": string }. Every opportunity's title, mode, and rupee range must be grounded in what the snippets actually say — never invent a category, location, or figure the snippets don't support. Both estimate numbers are whole rupees, monthly, for the stated hours/week. "reasoning" is a one-sentence "why this fits" grounded in the snippets. If the snippets don't support any real opportunity matching the stated preference, return an empty "opportunities" array and explain why in "note" rather than guessing.`;
    const parsed = await chatJson(system, JSON.stringify({ typeOfWork: entry.typeOfWork, hoursPerWeek: entry.hoursPerWeek, workLocationPreference: locationPref ?? null, location: location || null, searchSnippets: searchSummary }));
    const rawOpportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
    const candidates = rawOpportunities
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map((o) => ({
        title: typeof o.title === "string" && o.title.trim() !== "" ? o.title : `${entry.typeOfWork ?? "Side income"} — rough estimate`,
        mode: o.mode === "offline" ? ("offline" as const) : ("online" as const),
        estimateLowMinorUnits: typeof o.estimateLowMinorUnits === "number" ? Math.round(o.estimateLowMinorUnits) : 0,
        estimateHighMinorUnits: typeof o.estimateHighMinorUnits === "number" ? Math.round(o.estimateHighMinorUnits) : 0,
        reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
      }))
      .filter((o) => o.estimateLowMinorUnits > 0 || o.estimateHighMinorUnits > 0)
      .slice(0, 3);
    if (candidates.length === 0) {
      return {
        state: "INSUFFICIENT_SIGNAL",
        reason: typeof parsed.note === "string" && parsed.note ? parsed.note : "The search results didn't give enough signal to propose an opportunity.",
      };
    }
    const opportunities = [];
    for (const cand of candidates) {
      const opportunityId = await ctx.runMutation(internal.sideIncome.insertOpportunity, {
        householdId: entry.householdId as Id<"households">,
        sideIncomeEntryId: args.entryId,
        title: cand.title,
        mode: cand.mode,
        fitHoursPerWeek: entry.hoursPerWeek as number,
        estimateLowMinorUnits: cand.estimateLowMinorUnits,
        estimateHighMinorUnits: cand.estimateHighMinorUnits,
        isRoughEstimate: true,
        sourceSnapshotId: sourceSnapshotId ?? undefined,
      });
      opportunities.push({ ...cand, opportunityId });
    }
    return { state: "COMPUTED", isRoughEstimate: true, opportunities };
  },
});

// SECURITY FIX (2026-09-13): every action below that operates on a
// sideIncomeEntryId now goes through THIS instead of the old
// getEntryInternal, which fetched the entry with no ownership check at
// all — a signed-in caller from household A could pass any entryId and
// have it fetched, exposing household B's job/business content (and,
// via checkBusinessReserve, comparing A's own reserves against B's
// startup capital). Actions don't have ctx.db, so this is an
// internalQuery invoked via ctx.runQuery — same pattern as
// gatherPrepaymentData in convex/loanDebt.ts, reusing the exact
// requireMembership helper from convex/access.ts that every other
// Financial Foundation / Loan & Debt query already uses.
export const requireOwnedEntryInternal = internalQuery({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) {
      throw new ConvexError("Side-income entry not found.");
    }
    return entry;
  },
});

export const insertOpportunity = internalMutation({
  args: {
    householdId: v.id("households"),
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
    title: v.string(),
    mode: v.union(v.literal("online"), v.literal("offline")),
    fitHoursPerWeek: v.number(),
    estimateLowMinorUnits: v.number(),
    estimateHighMinorUnits: v.number(),
    isRoughEstimate: v.boolean(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
  },
  returns: v.id("sideIncomeOpportunities"),
  handler: async (ctx, args) => {
    const household = await ctx.db.get("households", args.householdId);
    return await ctx.db.insert("sideIncomeOpportunities", {
      ...args,
      inputStateRevision: household?.stateRevision ?? 0,
      createdAt: Date.now(),
    });
  },
});

// FRONTEND-REBUILD ADDITION (2026-09-13): plain read of already-created
// rows via the existing by_entry index — no calculation, same pattern as
// listSideIncomeEntries. Needed so Screen 1 can show opportunities
// generated on a previous visit instead of only right after generating.
export const listOpportunitiesForEntry = query({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) return [];
    return await ctx.db.query("sideIncomeOpportunities").withIndex("by_entry", (q) => q.eq("sideIncomeEntryId", args.entryId)).collect();
  },
});

export const getOpportunity = query({
  args: { opportunityId: v.id("sideIncomeOpportunities") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const opp = await ctx.db.get("sideIncomeOpportunities", args.opportunityId);
    if (opp === null || opp.householdId !== membership.householdId) return null;
    return opp;
  },
});

export const getOpportunityInternal = internalQuery({
  args: { opportunityId: v.id("sideIncomeOpportunities") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get("sideIncomeOpportunities", args.opportunityId),
});

// =====================================================================
// Business path — startup capital reserve-conflict check. Exact same
// pattern as Loan & Debt Affordability's reserve check: eligible liquid
// assets = liquid, not earmarked for a goal.
// =====================================================================

function assertBusinessEntryReady(entry: Record<string, unknown>): void {
  if (entry.kind !== "business") {
    throw new ConvexError(`This is a business-path calculation, but entry ${String(entry._id)} is kind "${String(entry.kind)}".`);
  }
  if (!entry.ideaDescription || entry.startupCapitalMinorUnits === undefined) {
    throw new ConvexError('This business entry is missing "ideaDescription" or "startupCapitalMinorUnits", which this calculation requires.');
  }
}

export const gatherReserveData = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const [assets, expenses] = await Promise.all([
      ctx.db.query("assets").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
      ctx.db.query("expenses").withIndex("by_household", (q) => q.eq("householdId", householdId)).collect(),
    ]);
    const eligibleLiquidAssets = assets
      .filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId === undefined)
      .reduce((s, a) => s + a.valueMinorUnits, 0);
    const essentialMonthlyExpenses = expenses
      .filter((e) => e.classification === "essential" && e.recurrence === "monthly")
      .reduce((s, e) => s + e.amountMinorUnits, 0);
    return { householdId, eligibleLiquidAssets, essentialMonthlyExpenses };
  },
});

export const checkBusinessReserve = action({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const entry = (await ctx.runQuery(internal.sideIncome.requireOwnedEntryInternal, { entryId: args.entryId })) as Record<string, unknown> | null;
    if (entry === null) throw new ConvexError("Side-income entry not found.");
    assertBusinessEntryReady(entry);
    const data = (await ctx.runQuery(internal.sideIncome.gatherReserveData, {})) as {
      householdId: Id<"households">;
      eligibleLiquidAssets: number;
      essentialMonthlyExpenses: number;
    };
    const startupCapital = entry.startupCapitalMinorUnits as number;
    const reserveAfterMinorUnits = data.eligibleLiquidAssets - startupCapital;
    const breachesReserve = reserveAfterMinorUnits < 0;
    const thinReserve = reserveAfterMinorUnits >= 0 && reserveAfterMinorUnits < data.essentialMonthlyExpenses;
    const hasConflict = breachesReserve || thinReserve;
    const conflictDetail = hasConflict
      ? breachesReserve
        ? `Startup capital of ${rupees(startupCapital)} exceeds eligible liquid reserve of ${rupees(data.eligibleLiquidAssets)} — reserve would go to ${rupees(reserveAfterMinorUnits)}.`
        : `After committing ${rupees(startupCapital)}, the remaining reserve (${rupees(reserveAfterMinorUnits)}) is below one month of essential expenses (${rupees(data.essentialMonthlyExpenses)}).`
      : "";
    return {
      startupCapitalMinorUnits: startupCapital,
      eligibleLiquidAssetsMinorUnits: data.eligibleLiquidAssets,
      essentialMonthlyExpensesMinorUnits: data.essentialMonthlyExpenses,
      reserveAfterMinorUnits,
      hasConflict,
      conflictDetail,
    };
  },
});

// =====================================================================
// Combined plan — 2+ opportunities selected together. Time-conflict and
// income-shortfall are two independent checks, same discipline as
// Loan & Debt's conflict-vs-shortfall split.
// =====================================================================

export const buildCombinedPlan = mutation({
  args: {
    opportunityIds: v.array(v.id("sideIncomeOpportunities")),
    availableHoursPerWeek: v.number(),
    targetIncomeMinorUnits: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    if (args.opportunityIds.length < 2) {
      throw new ConvexError("A combined plan needs at least 2 selected opportunities.");
    }
    const opportunities = await Promise.all(args.opportunityIds.map((id) => ctx.db.get("sideIncomeOpportunities", id)));
    for (const o of opportunities) {
      if (o === null || o.householdId !== membership.householdId) {
        throw new ConvexError("One or more selected opportunities were not found.");
      }
    }
    const valid = opportunities as NonNullable<(typeof opportunities)[number]>[];
    const totalHoursPerWeek = valid.reduce((s, o) => s + o.fitHoursPerWeek, 0);
    const totalIncomeLowMinorUnits = valid.reduce((s, o) => s + o.estimateLowMinorUnits, 0);
    const totalIncomeHighMinorUnits = valid.reduce((s, o) => s + o.estimateHighMinorUnits, 0);
    const hasTimeConflict = totalHoursPerWeek > args.availableHoursPerWeek;
    const hasShortfallVsTarget =
      args.targetIncomeMinorUnits !== undefined && totalIncomeHighMinorUnits < args.targetIncomeMinorUnits;
    const id = await ctx.db.insert("sideIncomeCombinedPlans", {
      householdId: membership.householdId,
      opportunityIds: args.opportunityIds,
      totalHoursPerWeek,
      totalIncomeLowMinorUnits,
      totalIncomeHighMinorUnits,
      hasTimeConflict,
      hasShortfallVsTarget,
      createdAt: Date.now(),
    });
    return {
      combinedPlanId: id,
      totalHoursPerWeek,
      availableHoursPerWeek: args.availableHoursPerWeek,
      totalIncomeLowMinorUnits,
      totalIncomeHighMinorUnits,
      targetIncomeMinorUnits: args.targetIncomeMinorUnits ?? null,
      hasTimeConflict,
      hasShortfallVsTarget,
    };
  },
});

// =====================================================================
// Deep dives — one Firecrawl search + one OpenAI reasoning pass per
// topic, cached per household + entry + topic + inputStateRevision +
// source freshness. Two households asking the same topic about
// different entries must never share a cache hit.
// =====================================================================

// FRONTEND-REBUILD NOTE (2026-09-13): now accepts the optional
// opportunityId the schema always had room for ("sideIncomeEntryId (or
// opportunityId)" in the original proposal) but nothing used yet. Screen
// 2's combined-plan tabs need each SELECTED OPPORTUNITY's own deep-dive
// content, not the parent entry's — two opportunities from the same
// "Find Ideas" call must not collapse onto one shared cached result. The
// index still narrows by household+entry+topic; the opportunityId match
// is an extra in-memory filter, same style as the existing
// stateRevision/freshness filters below.
export const findCachedDeepDive = internalQuery({
  args: {
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    opportunityId: v.optional(v.id("sideIncomeOpportunities")),
    topic: v.string(),
    now: v.number(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sideIncomeDeepDives")
      .withIndex("by_household_entry_topic", (q) =>
        q.eq("householdId", args.householdId).eq("sideIncomeEntryId", args.sideIncomeEntryId).eq("topic", args.topic as never),
      )
      .collect();
    const household = await ctx.db.get("households", args.householdId);
    const currentRevision = household?.stateRevision ?? 0;
    const fresh = rows
      .filter(
        (r) =>
          r.inputStateRevision === currentRevision &&
          args.now - r.sourceSnapshotFreshAt < DEEPDIVE_MAX_AGE_MS &&
          (r.opportunityId ?? null) === (args.opportunityId ?? null),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return fresh ?? null;
  },
});

export const saveDeepDive = internalMutation({
  args: {
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    opportunityId: v.optional(v.id("sideIncomeOpportunities")),
    topic: v.string(),
    result: v.any(),
    sourceSnapshotIds: v.array(v.id("sourceSnapshots")),
  },
  returns: v.id("sideIncomeDeepDives"),
  handler: async (ctx, args) => {
    const household = await ctx.db.get("households", args.householdId);
    return await ctx.db.insert("sideIncomeDeepDives", {
      householdId: args.householdId,
      sideIncomeEntryId: args.sideIncomeEntryId,
      opportunityId: args.opportunityId,
      topic: args.topic as never,
      result: args.result,
      sourceSnapshotIds: args.sourceSnapshotIds,
      inputStateRevision: household?.stateRevision ?? 0,
      sourceSnapshotFreshAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const saveSearchSnapshot = internalMutation({
  args: { queryText: v.string(), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => {
    const url = `firecrawl-search:${args.queryText}`;
    let source = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", url)).first();
    let sourceId: Id<"sourceRegistry">;
    if (source) {
      sourceId = source._id;
    } else {
      sourceId = await ctx.db.insert("sourceRegistry", {
        url,
        label: `Web search: ${args.queryText}`,
        isAllowlisted: true,
        authorityLevel: "web-search-aggregate",
      });
    }
    return await ctx.db.insert("sourceSnapshots", {
      sourceRegistryId: sourceId,
      fetchedAt: Date.now(),
      contentSummary: args.contentSummary.slice(0, 3000),
    });
  },
});

function topicsForKind(kind: "job" | "business"): readonly string[] {
  return kind === "job" ? JOB_TOPICS : BUSINESS_TOPICS;
}

const TOPIC_QUERY_HINT: Record<JobTopic | BusinessTopic, string> = {
  howToStart: "how to get started",
  whereToApply: "where to find opportunities or apply",
  challenges: "common challenges and pitfalls",
  resources: "free learning resources and tools",
  motivation: "success stories and motivation",
  blogs: "blogs and communities",
  ideaViability: "is this a viable business idea in India, market demand",
  startupCapital: "typical startup capital needed",
  schemeEligibility: "government schemes and subsidies",
  localViability: "local market viability in India",
  maturityPath: "typical timeline to profitability and growth path",
};

export const generateDeepDive = action({
  args: {
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    opportunityId: v.optional(v.id("sideIncomeOpportunities")),
    topic: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const entry = (await ctx.runQuery(internal.sideIncome.requireOwnedEntryInternal, { entryId: args.sideIncomeEntryId })) as Record<string, unknown> | null;
    if (entry === null) throw new ConvexError("Side-income entry not found.");
    const allowedTopics = topicsForKind(entry.kind as "job" | "business");
    if (!allowedTopics.includes(args.topic)) {
      throw new ConvexError(`Topic "${args.topic}" is not valid for a "${entry.kind}" entry. Valid topics: ${allowedTopics.join(", ")}.`);
    }
    const householdId = entry.householdId as Id<"households">;
    const now = Date.now();
    const cached = await ctx.runQuery(internal.sideIncome.findCachedDeepDive, {
      householdId,
      sideIncomeEntryId: args.sideIncomeEntryId,
      opportunityId: args.opportunityId,
      topic: args.topic,
      now,
    });
    // Flatten to the SAME shape a fresh compute returns ({state, topic,
    // summary, sections}) — `cached` is the raw stored row, whose actual
    // generated content lives one level down at `cached.result`. Bug
    // found during frontend verification: without this, a cache hit
    // silently rendered no content at all on Screen 4.
    if (cached) return { ...(cached as { result: Record<string, unknown> }).result, _fromCache: true };

    // When scoped to one selected opportunity (Screen 2's per-opportunity
    // tabs), the search subject is that opportunity's own title, not the
    // parent entry's — two opportunities from one "Find Ideas" call must
    // get genuinely distinct content, not a shared entry-level result.
    let subject: string = entry.kind === "job" ? (entry.typeOfWork as string | undefined) ?? "part-time work" : (entry.ideaDescription as string | undefined) ?? "small business idea";
    if (args.opportunityId) {
      const opp = (await ctx.runQuery(internal.sideIncome.getOpportunityInternal, { opportunityId: args.opportunityId })) as {
        title?: string;
        sideIncomeEntryId?: Id<"sideIncomeEntries">;
      } | null;
      // Defense in depth: the entry itself was already ownership-checked
      // above, but nothing yet confirms this opportunityId actually
      // belongs to THAT entry — without this, a caller could own entry A
      // and pass an opportunityId from someone else's entry B to pull
      // B's opportunity title into the search subject.
      if (opp !== null && opp.sideIncomeEntryId !== args.sideIncomeEntryId) {
        throw new ConvexError("That opportunity does not belong to this entry.");
      }
      if (opp?.title) subject = opp.title.replace(/\s*—\s*rough estimate\s*$/i, "");
    }
    // Same location-scoping discipline as estimateJobIncomeRange — only
    // narrows the search when the household actually gave a location and
    // isn't online-only; never guessed.
    const deepDiveLocationPref = entry.kind === "job" ? (entry.workLocationPreference as "online" | "offline" | "either" | undefined) : undefined;
    const deepDiveLocation = entry.kind === "job" && typeof entry.location === "string" ? entry.location.trim() : "";
    const deepDiveLocationScope = deepDiveLocationPref !== "online" && deepDiveLocation !== "" ? deepDiveLocation : "India";
    const queryText = `${subject} — ${TOPIC_QUERY_HINT[args.topic as JobTopic | BusinessTopic]} ${deepDiveLocationScope}`;
    let searchSummary = "";
    let sourceSnapshotId: Id<"sourceSnapshots"> | null = null;
    try {
      // FRONTEND-REBUILD NOTE (2026-09-13): limit raised 4 → 6 so there's
      // more real material to ground the now-deeper output in (see the
      // richer prompt below) — same single search per topic, same
      // caching, nothing else about the fetch changed.
      const results = await firecrawl.search(ctx, queryText, { limit: 6, sources: ["web"] });
      const items = (results.web ?? []).slice(0, 6);
      if (items.length === 0) {
        return { state: "SOURCE_UNAVAILABLE", topic: args.topic, reason: "The search returned no results for this topic." };
      }
      searchSummary = items
        .map((it) => `${("title" in it && it.title) || ""}: ${("description" in it && it.description) || ""} (${("url" in it && it.url) || ""})`)
        .join("\n")
        .slice(0, 4500);
      sourceSnapshotId = await ctx.runMutation(internal.sideIncome.saveSearchSnapshot, { queryText, contentSummary: searchSummary });
    } catch (err) {
      return {
        state: "SOURCE_UNAVAILABLE",
        topic: args.topic,
        reason: `The search couldn't be completed (${err instanceof Error ? err.message : String(err)}).`,
      };
    }

    // FRONTEND-REBUILD NOTE (2026-09-13): richer prompt per the Screen 4
    // mockup — asks for several titled sections with real detail each,
    // instead of a flat bullet list. Same sourcing discipline as before:
    // every section must be grounded in the snippets, never invented;
    // thinner search results simply produce fewer/shorter sections
    // rather than padded generic advice.
    const system = `You reason over REAL web search snippets to write a substantive, practical briefing on one narrow topic for a household exploring ${entry.kind === "job" ? "part-time/side job" : "small business"} income. The topic is "${args.topic}". Return ONLY JSON: { "summary": string, "sections": [{ "heading": string, "detail": string }] }. Produce 3-5 sections, each with a short specific heading (e.g. a concrete first step, a named risk, a specific resource type — not generic headers like "Overview") and 2-4 sentences of real, specific detail per section. Ground every section in the snippets given — if the snippets only support one or two sections, return only that many rather than padding with generic advice presented as fact. Never state a specific rupee figure, platform name, or scheme name unless it appears in the snippets.`;
    const parsed = await chatJson(system, JSON.stringify({ subject, topic: args.topic, searchSnippets: searchSummary }));
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
    const sections = rawSections
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => ({
        heading: typeof s.heading === "string" ? s.heading : "",
        detail: typeof s.detail === "string" ? s.detail : "",
      }))
      .filter((s) => s.heading !== "" && s.detail !== "");
    const result = {
      state: "COMPUTED",
      topic: args.topic,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      sections,
    };
    await ctx.runMutation(internal.sideIncome.saveDeepDive, {
      householdId,
      sideIncomeEntryId: args.sideIncomeEntryId,
      opportunityId: args.opportunityId,
      topic: args.topic,
      result,
      sourceSnapshotIds: sourceSnapshotId ? [sourceSnapshotId] : [],
    });
    return result;
  },
});

// =====================================================================
// Ask-flow — two fixed multiple-choice questions → tailored plan text.
// =====================================================================

const ASK_Q1_CHOICES = ["lowRiskSteady", "higherRiskHigherUpside"] as const;
const ASK_Q2_CHOICES = ["under5Hours", "5to15Hours", "15PlusHours"] as const;

export const submitAskSession = action({
  args: {
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    question1Answer: v.string(),
    question2Answer: v.string(),
    depthLevel: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    if (!ASK_Q1_CHOICES.includes(args.question1Answer as never)) {
      throw new ConvexError(`question1Answer must be one of: ${ASK_Q1_CHOICES.join(", ")}.`);
    }
    if (!ASK_Q2_CHOICES.includes(args.question2Answer as never)) {
      throw new ConvexError(`question2Answer must be one of: ${ASK_Q2_CHOICES.join(", ")}.`);
    }
    if (!Number.isInteger(args.depthLevel) || args.depthLevel < 1 || args.depthLevel > 6) {
      throw new ConvexError("depthLevel must be an integer from 1 to 6.");
    }
    const entry = (await ctx.runQuery(internal.sideIncome.requireOwnedEntryInternal, { entryId: args.sideIncomeEntryId })) as Record<string, unknown> | null;
    if (entry === null) throw new ConvexError("Side-income entry not found.");

    const system = `You write a short, tailored next-steps plan for a household's ${entry.kind === "job" ? "part-time/side job" : "small business"} exploration, based on their own deterministic entry details and two multiple-choice answers about risk appetite and available time. Return ONLY JSON: { "planText": string }. Do not invent income figures, timelines, or guarantees — describe an approach and next steps, not promised outcomes.`;
    const context = {
      kind: entry.kind,
      typeOfWork: entry.typeOfWork,
      ideaDescription: entry.ideaDescription,
      hoursPerWeek: entry.hoursPerWeek ?? entry.effortHoursPerWeek,
      riskAppetite: args.question1Answer,
      availableTime: args.question2Answer,
    };
    const parsed = await chatJson(system, JSON.stringify(context));
    const planText = typeof parsed.planText === "string" ? parsed.planText : "";
    const id = await ctx.runMutation(internal.sideIncome.saveAskSession, {
      householdId: entry.householdId as Id<"households">,
      sideIncomeEntryId: args.sideIncomeEntryId,
      question1Answer: args.question1Answer,
      question2Answer: args.question2Answer,
      generatedPlanText: planText,
      depthLevel: args.depthLevel,
    });
    return { askSessionId: id, generatedPlanText: planText };
  },
});

export const saveAskSession = internalMutation({
  args: {
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    question1Answer: v.string(),
    question2Answer: v.string(),
    generatedPlanText: v.string(),
    depthLevel: v.number(),
  },
  returns: v.id("sideIncomeAskSessions"),
  handler: async (ctx, args) => await ctx.db.insert("sideIncomeAskSessions", { ...args, createdAt: Date.now() }),
});

// =====================================================================
// Scheme eligibility (business only, opt-in). gender/state/incomeSlab
// are used for ONE search/matching call and never written anywhere.
// =====================================================================

export const checkSchemeEligibility = action({
  args: {
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    gender: v.string(),
    state: v.string(),
    incomeSlab: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const entry = (await ctx.runQuery(internal.sideIncome.requireOwnedEntryInternal, { entryId: args.sideIncomeEntryId })) as Record<string, unknown> | null;
    if (entry === null) throw new ConvexError("Side-income entry not found.");
    assertBusinessEntryReady(entry);
    const queryText = `government scheme subsidy loan for ${entry.ideaDescription} small business ${args.gender} ${args.state} India ${args.incomeSlab} income`;
    let items: Array<{ title?: string; url?: string; description?: string }> = [];
    try {
      const results = await firecrawl.search(ctx, queryText, { limit: 5, sources: ["web"] });
      items = (results.web ?? []) as never;
    } catch (err) {
      return {
        state: "SOURCE_UNAVAILABLE",
        reason: `The search couldn't be completed (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
    if (items.length === 0) {
      return { state: "SOURCE_UNAVAILABLE", reason: "The search returned no results — no schemes could be matched right now." };
    }
    const snippets = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""} (${it.url ?? ""})`).join("\n").slice(0, 3000);
    const system = `You read real web search results about government schemes and extract candidate scheme names that MIGHT apply. Return ONLY JSON: { "schemes": [{ "name": string, "sourceUrl": string, "note": string }] }. Never claim confirmed eligibility — every "note" must be cautious (e.g. "possibly eligible — verify these conditions with the scheme's own page"). Only include schemes that actually appear in the search results; do not invent scheme names. sourceUrl must be a URL from the results.`;
    const parsed = await chatJson(system, JSON.stringify({ ideaDescription: entry.ideaDescription, searchSnippets: snippets }));
    const now = Date.now();
    const schemesRaw = Array.isArray(parsed.schemes) ? parsed.schemes : [];
    const matchedSchemes = schemesRaw
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .slice(0, 8)
      .map((s) => ({
        name: typeof s.name === "string" ? s.name : "Unnamed scheme",
        sourceUrl: typeof s.sourceUrl === "string" ? s.sourceUrl : "",
        retrievedAt: now,
        note: typeof s.note === "string" ? s.note : "Possibly eligible — verify these conditions.",
      }));
    await ctx.runMutation(internal.sideIncome.saveSchemeCheck, {
      householdId: entry.householdId as Id<"households">,
      sideIncomeEntryId: args.sideIncomeEntryId,
      matchedSchemes,
    });
    return { state: "COMPUTED", matchedSchemes };
  },
});

export const saveSchemeCheck = internalMutation({
  args: {
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    matchedSchemes: v.array(v.object({ name: v.string(), sourceUrl: v.string(), retrievedAt: v.number(), note: v.string() })),
  },
  returns: v.id("schemeEligibilityChecks"),
  handler: async (ctx, args) => await ctx.db.insert("schemeEligibilityChecks", { ...args, checkedAt: Date.now() }),
});

export const listSchemeChecks = query({
  args: { entryId: v.id("sideIncomeEntries") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) return [];
    return await ctx.db.query("schemeEligibilityChecks").withIndex("by_entry", (q) => q.eq("sideIncomeEntryId", args.entryId)).collect();
  },
});

// Human consult ("Want a real person's opinion?") now lives in
// convex/humanConsult.ts as a generic mutation shared across every
// service — see that file. Side-Income calls it with
// sourceService: "sideIncome", sourceEntityId: <the entry id>.

// =====================================================================
// Graduation — into a real Financial Foundation incomeSources row.
// Requires earningsEvidence >= repeatedSelfReported. Reuses FF's own
// addIncomeSource mutation rather than duplicating the insert logic.
// =====================================================================

export const graduateToIncomeSource = mutation({
  args: {
    entryId: v.id("sideIncomeEntries"),
    label: v.string(),
    amountMinorUnits: v.number(),
    cadence: v.union(v.literal("monthly"), v.literal("weekly"), v.literal("annual"), v.literal("irregular")),
  },
  returns: v.id("incomeSources"),
  handler: async (ctx, args): Promise<Id<"incomeSources">> => {
    const membership = await requireMembership(ctx);
    const entry = await ctx.db.get("sideIncomeEntries", args.entryId);
    if (entry === null || entry.householdId !== membership.householdId) {
      throw new ConvexError("Side-income entry not found.");
    }
    if (EARNINGS_EVIDENCE_RANK[entry.earningsEvidence] < EARNINGS_EVIDENCE_RANK.repeatedSelfReported) {
      throw new ConvexError(
        `This entry's earnings evidence is "${entry.earningsEvidence}" — graduating into Financial Foundation requires at least "repeatedSelfReported" (real money received more than once), never just because status is "active".`,
      );
    }
    assertIntegerMinorUnits(args.amountMinorUnits, "amountMinorUnits");
    const incomeSourceId: Id<"incomeSources"> = await ctx.runMutation(api.incomeSources.addIncomeSource, {
      label: args.label,
      amountMinorUnits: args.amountMinorUnits,
      currency: "INR",
      cadence: args.cadence,
      reliability: "uncertain", // side income starts uncertain even once graduated — the household can upgrade it later
      activeFrom: Date.now(),
    });
    await ctx.db.patch(args.entryId, { status: "graduated", updatedAt: Date.now() });
    await bumpStateRevision(ctx, membership.householdId);
    return incomeSourceId;
  },
});

// =====================================================================
// OpenAI narration helper — same pattern as Loan & Debt's chatJson.
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
