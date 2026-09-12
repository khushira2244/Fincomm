// Goal & Situation Planning (Service #2). Timeline-scoped planning data.
// Nothing here touches Financial Foundation's tables, reads, or the
// runway calculation — timeline family-support and loans live in their
// own tables (timelineFamilySupport / timelineLoans).

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

async function requireTimeline(
  ctx: QueryCtx | MutationCtx,
  timelineId: Doc<"timelines">["_id"],
): Promise<{ membership: Doc<"memberships">; timeline: Doc<"timelines"> }> {
  const membership = await requireMembership(ctx);
  const timeline = await ctx.db.get("timelines", timelineId);
  if (timeline === null || timeline.householdId !== membership.householdId) {
    throw new ConvexError("Timeline not found.");
  }
  return { membership, timeline };
}

function assertWholeYears(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ConvexError("forHowManyYears must be a whole number of years (1 or more).");
  }
}

// ---------------------------------------------------------------------
// Timeline CRUD
// ---------------------------------------------------------------------

export const createTimeline = mutation({
  args: {},
  returns: v.object({ timelineId: v.id("timelines") }),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const existing = await ctx.db
      .query("timelines")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    const n = existing.length + 1;
    const timelineId = await ctx.db.insert("timelines", {
      householdId: membership.householdId,
      label: `Timeline ${n}`,
      yearsLabel: "",
      order: n,
      createdAt: Date.now(),
      confirmed: false,
    });
    return { timelineId };
  },
});

export const setTimelineConfirmed = mutation({
  args: { timelineId: v.id("timelines"), confirmed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    await ctx.db.patch("timelines", timeline._id, { confirmed: args.confirmed });
    return null;
  },
});

export const updateTimelineYears = mutation({
  args: { timelineId: v.id("timelines"), yearsLabel: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTimeline(ctx, args.timelineId);
    await ctx.db.patch("timelines", args.timelineId, { yearsLabel: args.yearsLabel });
    return null;
  },
});

export const getTimeline = query({
  args: { timelineId: v.id("timelines") },
  returns: v.union(v.null(), schema.doc("timelines")),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const timeline = await ctx.db.get("timelines", args.timelineId);
    if (timeline === null || timeline.householdId !== membership.householdId) {
      return null;
    }
    return timeline;
  },
});

export const listTimelines = query({
  args: {},
  returns: v.array(
    v.object({
      timeline: schema.doc("timelines"),
      itemCount: v.number(),
      suggestionCount: v.number(),
      confirmed: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;

    const timelines = (
      await ctx.db
        .query("timelines")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    const [familySupport, familyObligations, loans, goals, situations, dismissals] =
      await loadHouseholdPlanningData(ctx, householdId);

    const result = [];
    for (const timeline of timelines) {
      const itemCount =
        familySupport.filter((x) => x.timelineId === timeline._id).length +
        familyObligations.filter((x) => x.timelineId === timeline._id).length +
        loans.filter((x) => x.timelineId === timeline._id).length +
        goals.filter((x) => x.timelineId === timeline._id).length +
        situations.filter((x) => x.timelineId === timeline._id).length;

      const suggestions = computeSuggestions({
        timeline,
        allTimelines: timelines,
        familySupport,
        goals,
        situations,
        dismissals,
      });
      result.push({
        timeline,
        itemCount,
        suggestionCount: suggestions.length,
        confirmed: timeline.confirmed === true,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------
// Per-timeline items — one aggregate list for the detail screen
// ---------------------------------------------------------------------

export const listTimelineItems = query({
  args: { timelineId: v.id("timelines") },
  returns: v.object({
    familySupport: v.array(schema.doc("timelineFamilySupport")),
    familyObligations: v.array(schema.doc("familyObligations")),
    emergencyNotes: v.array(schema.doc("situations")),
    loans: v.array(schema.doc("timelineLoans")),
    careerGoals: v.array(schema.doc("goals")),
    shortTermGoals: v.array(schema.doc("goals")),
    health: v.array(schema.doc("situations")),
    location: v.array(schema.doc("situations")),
    sideIncome: v.array(schema.doc("situations")),
    misc: v.array(schema.doc("situations")),
  }),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const householdId = timeline.householdId;
    const tid = timeline._id;

    const [familySupport, familyObligations, loans, goals, situations] =
      await loadHouseholdPlanningData(ctx, householdId);

    const sits = situations.filter((s) => s.timelineId === tid);
    const gls = goals.filter((g) => g.timelineId === tid);

    return {
      familySupport: familySupport.filter((x) => x.timelineId === tid),
      familyObligations: familyObligations.filter((x) => x.timelineId === tid),
      emergencyNotes: sits.filter((s) => s.situationCategory === "familyEmergency"),
      loans: loans.filter((x) => x.timelineId === tid),
      careerGoals: gls.filter((g) => g.horizon === "longTerm"),
      shortTermGoals: gls.filter((g) => g.horizon === "shortTerm"),
      health: sits.filter((s) => s.situationCategory === "health"),
      location: sits.filter((s) => s.situationCategory === "location"),
      sideIncome: sits.filter((s) => s.situationCategory === "sideIncome"),
      misc: sits.filter((s) => s.situationCategory === "misc"),
    };
  },
});

// ---------------------------------------------------------------------
// Add mutations
// ---------------------------------------------------------------------

export const addFamilySupport = mutation({
  args: {
    timelineId: v.id("timelines"),
    label: v.string(),
    monthlyCostMinorUnits: v.number(),
  },
  returns: v.id("timelineFamilySupport"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.monthlyCostMinorUnits, "monthlyCostMinorUnits");
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("timelineFamilySupport", {
      householdId: timeline.householdId,
      timelineId: timeline._id,
      label: args.label,
      monthlyCostMinorUnits: args.monthlyCostMinorUnits,
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const addFamilyObligation = mutation({
  args: {
    timelineId: v.id("timelines"),
    label: v.string(),
    costPerYearMinorUnits: v.number(),
    forHowManyYears: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.id("familyObligations"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.costPerYearMinorUnits, "costPerYearMinorUnits");
    assertWholeYears(args.forHowManyYears);
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("familyObligations", {
      householdId: timeline.householdId,
      timelineId: timeline._id,
      label: args.label,
      costPerYearMinorUnits: args.costPerYearMinorUnits,
      forHowManyYears: args.forHowManyYears,
      reason: args.reason,
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const addEmergencyNote = mutation({
  args: { timelineId: v.id("timelines"), description: v.string() },
  returns: v.id("situations"),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("situations", {
      householdId: timeline.householdId,
      kind: "hypothetical",
      description: args.description,
      effectiveDate: Date.now(),
      affectedMemberIds: [],
      confidence: "low",
      timelineId: timeline._id,
      situationCategory: "familyEmergency",
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const addTimelineLoan = mutation({
  args: {
    timelineId: v.id("timelines"),
    label: v.string(),
    outstandingBalanceMinorUnits: v.number(),
    emiMinorUnits: v.number(),
  },
  returns: v.id("timelineLoans"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.outstandingBalanceMinorUnits, "outstandingBalanceMinorUnits");
    assertIntegerMinorUnits(args.emiMinorUnits, "emiMinorUnits");
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("timelineLoans", {
      householdId: timeline.householdId,
      timelineId: timeline._id,
      label: args.label,
      outstandingBalanceMinorUnits: args.outstandingBalanceMinorUnits,
      emiMinorUnits: args.emiMinorUnits,
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const addCareerGoal = mutation({
  args: {
    timelineId: v.id("timelines"),
    description: v.string(),
    expectedIncomeMinorUnits: v.optional(v.number()),
  },
  returns: v.id("goals"),
  handler: async (ctx, args) => {
    if (args.expectedIncomeMinorUnits !== undefined) {
      assertIntegerMinorUnits(args.expectedIncomeMinorUnits, "expectedIncomeMinorUnits");
    }
    const { membership, timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("goals", {
      householdId: timeline.householdId,
      ownerMemberIds: [membership._id],
      description: args.description,
      targetAmountMinorUnits: args.expectedIncomeMinorUnits,
      priority: 0,
      status: "active",
      timelineId: timeline._id,
      horizon: "longTerm",
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const addShortTermGoal = mutation({
  args: {
    timelineId: v.id("timelines"),
    description: v.string(),
    positiveSteps: v.optional(v.array(v.string())),
    negativeSteps: v.optional(v.array(v.string())),
  },
  returns: v.id("goals"),
  handler: async (ctx, args) => {
    const { membership, timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("goals", {
      householdId: timeline.householdId,
      ownerMemberIds: [membership._id],
      description: args.description,
      priority: 0,
      status: "active",
      timelineId: timeline._id,
      horizon: "shortTerm",
      positiveSteps: args.positiveSteps,
      negativeSteps: args.negativeSteps,
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

export const updateGoalSteps = mutation({
  args: {
    goalId: v.id("goals"),
    positiveSteps: v.array(v.string()),
    negativeSteps: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const goal = await ctx.db.get("goals", args.goalId);
    if (goal === null || goal.householdId !== membership.householdId) {
      throw new ConvexError("Goal not found.");
    }
    await ctx.db.patch("goals", args.goalId, {
      positiveSteps: args.positiveSteps,
      negativeSteps: args.negativeSteps,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const addSituationNote = mutation({
  args: {
    timelineId: v.id("timelines"),
    situationCategory: v.union(
      v.literal("health"),
      v.literal("location"),
      v.literal("sideIncome"),
      v.literal("misc"),
    ),
    description: v.string(),
  },
  returns: v.id("situations"),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const id = await ctx.db.insert("situations", {
      householdId: timeline.householdId,
      kind: "planned",
      description: args.description,
      effectiveDate: Date.now(),
      affectedMemberIds: [],
      confidence: "medium",
      timelineId: timeline._id,
      situationCategory: args.situationCategory,
    });
    await bumpStateRevision(ctx, timeline.householdId);
    return id;
  },
});

// ---------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------

const suggestionValidator = v.object({
  key: v.string(),
  kind: v.union(v.literal("carryForwardFamilySupport"), v.literal("resurfacedItem")),
  category: v.string(),
  title: v.string(),
  body: v.string(),
  sourceFamilySupport: v.optional(
    v.object({ label: v.string(), monthlyCostMinorUnits: v.number() }),
  ),
  resurfacedItemType: v.optional(v.union(v.literal("goal"), v.literal("situation"))),
  resurfacedItemId: v.optional(v.string()),
});

export const getSuggestions = query({
  args: { timelineId: v.id("timelines") },
  returns: v.array(suggestionValidator),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const householdId = timeline.householdId;

    const timelines = (
      await ctx.db
        .query("timelines")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    const [familySupport, , , goals, situations, dismissals] = await loadHouseholdPlanningData(
      ctx,
      householdId,
    );

    return computeSuggestions({
      timeline,
      allTimelines: timelines,
      familySupport,
      goals,
      situations,
      dismissals,
    });
  },
});

export const dismissSuggestion = mutation({
  args: { timelineId: v.id("timelines"), suggestionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    const already = await ctx.db
      .query("suggestionDismissals")
      .withIndex("by_household_timeline_key", (q) =>
        q
          .eq("householdId", timeline.householdId)
          .eq("timelineId", timeline._id)
          .eq("suggestionKey", args.suggestionKey),
      )
      .first();
    if (already !== null) {
      return null;
    }
    await ctx.db.insert("suggestionDismissals", {
      householdId: timeline.householdId,
      timelineId: timeline._id,
      suggestionKey: args.suggestionKey,
      dismissedAt: Date.now(),
    });
    return null;
  },
});

// Accept an "earlier-mention" item onto this timeline by attaching its
// timelineId (rather than creating a duplicate). The loose item stops
// resurfacing on other timelines once it's no longer loose.
export const acceptResurfacedItem = mutation({
  args: {
    timelineId: v.id("timelines"),
    itemType: v.union(v.literal("goal"), v.literal("situation")),
    itemId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { timeline } = await requireTimeline(ctx, args.timelineId);
    if (args.itemType === "goal") {
      const goal = await ctx.db.get("goals", args.itemId as Doc<"goals">["_id"]);
      if (goal === null || goal.householdId !== timeline.householdId) {
        throw new ConvexError("Goal not found.");
      }
      await ctx.db.patch("goals", goal._id, { timelineId: timeline._id });
    } else {
      const situation = await ctx.db.get("situations", args.itemId as Doc<"situations">["_id"]);
      if (situation === null || situation.householdId !== timeline.householdId) {
        throw new ConvexError("Situation not found.");
      }
      await ctx.db.patch("situations", situation._id, { timelineId: timeline._id });
    }
    await bumpStateRevision(ctx, timeline.householdId);
    return null;
  },
});

// ---------------------------------------------------------------------
// Suggestion computation (pure, on read — never stored)
// ---------------------------------------------------------------------

type Suggestion = {
  key: string;
  kind: "carryForwardFamilySupport" | "resurfacedItem";
  category: string;
  title: string;
  body: string;
  sourceFamilySupport?: { label: string; monthlyCostMinorUnits: number };
  resurfacedItemType?: "goal" | "situation";
  resurfacedItemId?: string;
};

async function loadHouseholdPlanningData(ctx: QueryCtx, householdId: Doc<"households">["_id"]) {
  return Promise.all([
    ctx.db
      .query("timelineFamilySupport")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("familyObligations")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("timelineLoans")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("goals")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("situations")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
    ctx.db
      .query("suggestionDismissals")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect(),
  ] as const);
}

function computeSuggestions(input: {
  timeline: Doc<"timelines">;
  allTimelines: Doc<"timelines">[];
  familySupport: Doc<"timelineFamilySupport">[];
  goals: Doc<"goals">[];
  situations: Doc<"situations">[];
  dismissals: Doc<"suggestionDismissals">[];
}): Suggestion[] {
  const { timeline, allTimelines, familySupport, goals, situations, dismissals } = input;
  const out: Suggestion[] = [];

  // 1. Cross-timeline carry-forward: family support from any earlier
  //    timeline that this timeline doesn't already have (by label).
  const thisSupportLabels = new Set(
    familySupport
      .filter((s) => s.timelineId === timeline._id)
      .map((s) => s.label.trim().toLowerCase()),
  );
  const earlierTimelineIds = new Set(
    allTimelines.filter((t) => t.order < timeline.order).map((t) => t._id),
  );
  const timelineById = new Map(allTimelines.map((t) => [t._id, t]));
  for (const entry of familySupport) {
    if (!earlierTimelineIds.has(entry.timelineId)) continue;
    if (thisSupportLabels.has(entry.label.trim().toLowerCase())) continue;
    const from = timelineById.get(entry.timelineId);
    out.push({
      key: `carryForwardFamilySupport:${entry._id}`,
      kind: "carryForwardFamilySupport",
      category: "family",
      title: `Family: Continue "${entry.label}"?`,
      body: `You added this in ${from?.label ?? "an earlier timeline"} (₹${entry.monthlyCostMinorUnits.toLocaleString(
        "en-IN",
      )}/mo) — carry it into ${timeline.label}, or has it changed?`,
      sourceFamilySupport: { label: entry.label, monthlyCostMinorUnits: entry.monthlyCostMinorUnits },
    });
  }

  // 2. Earlier-mention resurfacing: loose (no timelineId) career/short-
  //    term goals and side-income situations, surfaced on the furthest-
  //    out timeline only (simple heuristic; see build notes).
  const isFurthestTimeline = allTimelines.every((t) => t.order <= timeline.order);
  if (isFurthestTimeline) {
    for (const g of goals) {
      if (g.timelineId !== undefined) continue;
      if (g.horizon !== "longTerm" && g.horizon !== "shortTerm") continue;
      out.push({
        key: `resurface:goal:${g._id}`,
        kind: "resurfacedItem",
        category: g.horizon === "longTerm" ? "career" : "shortTermGoal",
        title: `${g.horizon === "longTerm" ? "Career" : "Goal"}: ${g.description}`,
        body: `You mentioned this earlier — ${timeline.label}${
          timeline.yearsLabel ? ` (${timeline.yearsLabel})` : ""
        } looks realistic based on your projected savings by then.`,
        resurfacedItemType: "goal",
        resurfacedItemId: g._id,
      });
    }
    for (const s of situations) {
      if (s.timelineId !== undefined) continue;
      if (s.situationCategory !== "sideIncome") continue;
      out.push({
        key: `resurface:situation:${s._id}`,
        kind: "resurfacedItem",
        category: "sideIncome",
        title: `Side income: ${s.description}`,
        body: `You mentioned this idea earlier — ${timeline.label} looks realistic based on your projected savings by then.`,
        resurfacedItemType: "situation",
        resurfacedItemId: s._id,
      });
    }
  }

  const dismissedKeys = new Set(
    dismissals.filter((d) => d.timelineId === timeline._id).map((d) => d.suggestionKey),
  );
  return out.filter((s) => !dismissedKeys.has(s.key));
}
