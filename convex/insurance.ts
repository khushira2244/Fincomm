// Insurance & Risk Planning raw fact capture. Same shape and pattern as
// convex/assets.ts. Read by this file's own list query, by Document
// Intelligence's extraction-confirm flow, and — as of Service #7 —
// by convex/insuranceRiskPlanning.ts's adequacy check and gap
// detection, both of which are real decision calculations. That means
// every write here now calls bumpStateRevision (it deliberately did
// NOT before Service #7 existed, per access.ts's own rule that
// stateRevision only bumps for changes feeding a decision calculation —
// revisit-comment resolved now that one exists).

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { assertIntegerMinorUnits, bumpStateRevision, requireMembership } from "./access";

const POLICY_TYPE = v.union(
  v.literal("life"),
  v.literal("health"),
  v.literal("motor"),
  v.literal("property"),
  v.literal("personalAccident"),
  v.literal("other"),
);

export const addInsurancePolicy = mutation({
  args: {
    type: POLICY_TYPE,
    coverageAmountMinorUnits: v.number(), // MUST be an integer — enforced below
    premiumMinorUnits: v.number(), // MUST be an integer — enforced below
    premiumFrequency: v.union(v.literal("monthly"), v.literal("annual")),
    currency: v.string(),
    insurerName: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
  },
  returns: v.id("insurancePolicies"),
  handler: async (ctx, args) => {
    assertIntegerMinorUnits(args.coverageAmountMinorUnits, "coverageAmountMinorUnits");
    assertIntegerMinorUnits(args.premiumMinorUnits, "premiumMinorUnits");
    const membership = await requireMembership(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("insurancePolicies", {
      householdId: membership.householdId,
      type: args.type,
      coverageAmountMinorUnits: args.coverageAmountMinorUnits,
      premiumMinorUnits: args.premiumMinorUnits,
      premiumFrequency: args.premiumFrequency,
      currency: args.currency,
      insurerName: args.insurerName,
      policyNumber: args.policyNumber,
      createdAt: now,
      updatedAt: now,
      createdByMemberId: membership._id,
    });
    await bumpStateRevision(ctx, membership.householdId);
    return id;
  },
});

// Edits an existing policy in place — e.g. correcting a type that was
// defaulted during a one-click "Confirm" from an extracted fact (see
// FinancialFoundationScreen's InsuranceSection.confirmDirectly, which
// intentionally defaults to "other" when the real type isn't known
// with confidence). All fields optional; only provided fields change.
export const updateInsurancePolicy = mutation({
  args: {
    policyId: v.id("insurancePolicies"),
    type: v.optional(POLICY_TYPE),
    coverageAmountMinorUnits: v.optional(v.number()),
    premiumMinorUnits: v.optional(v.number()),
    premiumFrequency: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    insurerName: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const policy = await ctx.db.get("insurancePolicies", args.policyId);
    if (policy === null || policy.householdId !== membership.householdId) {
      throw new ConvexError("Insurance policy not found.");
    }
    if (args.coverageAmountMinorUnits !== undefined) {
      assertIntegerMinorUnits(args.coverageAmountMinorUnits, "coverageAmountMinorUnits");
    }
    if (args.premiumMinorUnits !== undefined) {
      assertIntegerMinorUnits(args.premiumMinorUnits, "premiumMinorUnits");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(args)) {
      if (k === "policyId") continue;
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch("insurancePolicies", args.policyId, patch);
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const deleteInsurancePolicy = mutation({
  args: { policyId: v.id("insurancePolicies") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const policy = await ctx.db.get("insurancePolicies", args.policyId);
    if (policy === null || policy.householdId !== membership.householdId) {
      throw new ConvexError("Insurance policy not found.");
    }
    await ctx.db.delete(args.policyId);
    await bumpStateRevision(ctx, membership.householdId);
    return null;
  },
});

export const listInsurancePolicies = query({
  args: {},
  returns: v.array(schema.doc("insurancePolicies")),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db
      .query("insurancePolicies")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(500);
  },
});
