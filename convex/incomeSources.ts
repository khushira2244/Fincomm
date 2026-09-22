import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";
import { internal } from "./_generated/api";

export const addIncomeSource = mutation({
  args: {
    label: v.string(),
    amountMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    cadence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("annual"),
      v.literal("irregular"),
    ),
    reliability: v.union(
      v.literal("dependable"),
      v.literal("uncertain"),
      v.literal("hypothetical"),
    ),
    activeFrom: v.number(),
    activeTo: v.optional(v.number()),
  },
  returns: v.id("incomeSources"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.amountMinorUnits, "amountMinorUnits");
    const membership = await requireMembership(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("incomeSources", {
      householdId: membership.householdId,
      ownerMemberId: membership._id,
      label: args.label,
      amountMinorUnits: args.amountMinorUnits,
      currency: args.currency,
      cadence: args.cadence,
      reliability: args.reliability,
      activeFrom: args.activeFrom,
      activeTo: args.activeTo,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

export const updateIncomeSource = mutation({
  args: {
    incomeSourceId: v.id("incomeSources"),
    label: v.string(),
    amountMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    cadence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("annual"),
      v.literal("irregular"),
    ),
    reliability: v.union(
      v.literal("dependable"),
      v.literal("uncertain"),
      v.literal("hypothetical"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.amountMinorUnits, "amountMinorUnits");
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("incomeSources", args.incomeSourceId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Income source not found.");
    }
    const beforeAmountMinorUnits = existing.amountMinorUnits;
    await ctx.db.patch(args.incomeSourceId, {
      label: args.label,
      amountMinorUnits: args.amountMinorUnits,
      currency: args.currency,
      cadence: args.cadence,
      reliability: args.reliability,
      updatedAt: Date.now(),
    });
    await bumpStateRevision(ctx, membership.householdId);

    // Async follow-up — schedules the impact-summary email, never
    // blocks this mutation. Mutations can't call actions directly (a
    // scheduled call is the same pattern convex/email.ts already
    // established for AgentMail's own inbound path). Only worth running
    // when the amount actually changed — a label/cadence-only edit with
    // the same amount has no downstream financial impact to summarize.
    if (beforeAmountMinorUnits !== args.amountMinorUnits) {
      await ctx.scheduler.runAfter(0, internal.incomeResilience.sendImpactSummaryInternal, {
        householdId: membership.householdId,
        incomeSourceId: args.incomeSourceId,
        incomeLabel: args.label,
        beforeAmountMinorUnits,
        afterAmountMinorUnits: args.amountMinorUnits,
      });
    }
    return null;
  },
});

export const deleteIncomeSource = mutation({
  args: { incomeSourceId: v.id("incomeSources") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("incomeSources", args.incomeSourceId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Income source not found.");
    }
    await ctx.db.delete(args.incomeSourceId);
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const listIncomeSources = query({
  args: {},
  returns: v.array(schema.doc("incomeSources")),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("incomeSources")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(500);
  },
});
