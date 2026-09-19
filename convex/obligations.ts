import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";

export const addObligation = mutation({
  args: {
    label: v.string(),
    balanceMinorUnits: v.number(), // MUST be an integer — enforced below
    emiMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    interestRateBasisPoints: v.number(),
    dueDayOfMonth: v.number(),
    penaltyPolicy: v.optional(v.string()),
    maturityDate: v.optional(v.number()),
  },
  returns: v.id("obligations"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.balanceMinorUnits, "balanceMinorUnits");
    assertIntegerMinorUnits(args.emiMinorUnits, "emiMinorUnits");
    const membership = await requireMembership(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("obligations", {
      householdId: membership.householdId,
      label: args.label,
      balanceMinorUnits: args.balanceMinorUnits,
      emiMinorUnits: args.emiMinorUnits,
      currency: args.currency,
      interestRateBasisPoints: args.interestRateBasisPoints,
      dueDayOfMonth: args.dueDayOfMonth,
      penaltyPolicy: args.penaltyPolicy,
      maturityDate: args.maturityDate,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

// Basic-field edit (label/balance/EMI) — same "correct a mistake" need
// as every other Financial Foundation table. Loan & Debt's own
// updateLoanDetails (in convex/loanDebt.ts) still owns the extended
// fields (rate, tenure, rate type, etc.) — this doesn't duplicate or
// touch those.
export const updateObligation = mutation({
  args: {
    obligationId: v.id("obligations"),
    label: v.string(),
    balanceMinorUnits: v.number(), // MUST be an integer — enforced below
    emiMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.balanceMinorUnits, "balanceMinorUnits");
    assertIntegerMinorUnits(args.emiMinorUnits, "emiMinorUnits");
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("obligations", args.obligationId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Obligation not found.");
    }
    await ctx.db.patch(args.obligationId, {
      label: args.label,
      balanceMinorUnits: args.balanceMinorUnits,
      emiMinorUnits: args.emiMinorUnits,
      currency: args.currency,
      updatedAt: Date.now(),
    });
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const deleteObligation = mutation({
  args: { obligationId: v.id("obligations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("obligations", args.obligationId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Obligation not found.");
    }
    await ctx.db.delete(args.obligationId);
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const listObligations = query({
  args: {},
  returns: v.array(schema.doc("obligations")),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("obligations")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(500);
  },
});
