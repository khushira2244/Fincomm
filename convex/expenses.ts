import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";

export const addExpense = mutation({
  args: {
    label: v.string(),
    amountMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    classification: v.union(v.literal("essential"), v.literal("flexible")),
    recurrence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("annual"),
      v.literal("oneOff"),
    ),
    paymentDate: v.optional(v.number()),
  },
  returns: v.id("expenses"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.amountMinorUnits, "amountMinorUnits");
    const membership = await requireMembership(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("expenses", {
      householdId: membership.householdId,
      label: args.label,
      amountMinorUnits: args.amountMinorUnits,
      currency: args.currency,
      classification: args.classification,
      recurrence: args.recurrence,
      paymentDate: args.paymentDate,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

export const listExpenses = query({
  args: {},
  returns: v.array(schema.doc("expenses")),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("expenses")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(500);
  },
});
