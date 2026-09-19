import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";

export const addAsset = mutation({
  args: {
    label: v.string(),
    valueMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    liquidity: v.union(
      v.literal("liquid"),
      v.literal("semiLiquid"),
      v.literal("illiquid"),
    ),
    earmarkedForGoalId: v.optional(v.id("goals")),
    saleCostEstimateMinorUnits: v.optional(v.number()), // MUST be an integer when present — enforced below
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.valueMinorUnits, "valueMinorUnits");
    if (args.saleCostEstimateMinorUnits !== undefined) {
      assertIntegerMinorUnits(args.saleCostEstimateMinorUnits, "saleCostEstimateMinorUnits");
    }
    const membership = await requireMembership(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("assets", {
      householdId: membership.householdId,
      label: args.label,
      valueMinorUnits: args.valueMinorUnits,
      currency: args.currency,
      liquidity: args.liquidity,
      earmarkedForGoalId: args.earmarkedForGoalId,
      saleCostEstimateMinorUnits: args.saleCostEstimateMinorUnits,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

export const updateAsset = mutation({
  args: {
    assetId: v.id("assets"),
    label: v.string(),
    valueMinorUnits: v.number(), // MUST be an integer — enforced below
    currency: v.string(),
    liquidity: v.union(
      v.literal("liquid"),
      v.literal("semiLiquid"),
      v.literal("illiquid"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.valueMinorUnits, "valueMinorUnits");
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("assets", args.assetId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Asset not found.");
    }
    await ctx.db.patch(args.assetId, {
      label: args.label,
      valueMinorUnits: args.valueMinorUnits,
      currency: args.currency,
      liquidity: args.liquidity,
      updatedAt: Date.now(),
    });
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const deleteAsset = mutation({
  args: { assetId: v.id("assets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const existing = await ctx.db.get("assets", args.assetId);
    if (existing === null || existing.householdId !== membership.householdId) {
      throw new ConvexError("Asset not found.");
    }
    await ctx.db.delete(args.assetId);
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const listAssets = query({
  args: {},
  returns: v.array(schema.doc("assets")),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("assets")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(500);
  },
});
