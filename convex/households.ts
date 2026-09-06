// Minimal household bootstrap. Not part of the Financial Foundation service
// itself, but the finance mutations/queries need a household + membership to
// scope their writes to, so this is unavoidable plumbing: get-or-create the
// one household a signed-in user belongs to in this MVP.

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import schema from "./schema";

export const getMine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      household: schema.doc("households"),
      membershipId: v.id("memberships"),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (membership === null) {
      return null;
    }
    const household = await ctx.db.get("households", membership.householdId);
    if (household === null) {
      return null;
    }
    return { household, membershipId: membership._id };
  },
});

export const ensureHousehold = mutation({
  args: {},
  returns: v.object({
    householdId: v.id("households"),
    membershipId: v.id("memberships"),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Must be signed in to create a household.");
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing !== null) {
      return { householdId: existing.householdId, membershipId: existing._id };
    }

    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      name: "My Household",
      createdBy: userId,
      isDemoData: false,
      // Starts at 0. Only the finance mutations in this service increment
      // it from here, and only for decision-affecting changes.
      stateRevision: 0,
      updatedAt: now,
    });
    const membershipId = await ctx.db.insert("memberships", {
      householdId,
      userId,
      role: "owner",
      visibilityScope: "full",
    });
    return { householdId, membershipId };
  },
});
