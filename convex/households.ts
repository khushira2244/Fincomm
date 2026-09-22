// Minimal household bootstrap. Not part of the Financial Foundation service
// itself, but the finance mutations/queries need a household + membership to
// scope their writes to, so this is unavoidable plumbing: get-or-create the
// one household a signed-in user belongs to in this MVP.

import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import schema from "./schema";
import { requireMembership } from "./access";

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
  args: {
    // Collected once at account setup (see EmptyState's country picker
    // in App.tsx) — the household's country never changes silently
    // after this. Optional purely because existing callers/tests may
    // not pass it yet; defaults to "IN" like every other reader of
    // households.country does (see jurisdiction.ts's resolveCountry).
    country: v.optional(v.union(v.literal("IN"), v.literal("US"), v.literal("EU"), v.literal("OTHER"))),
  },
  returns: v.object({
    householdId: v.id("households"),
    membershipId: v.id("memberships"),
  }),
  handler: async (ctx, args) => {
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
      country: args.country ?? "IN",
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

// Lets a household correct its country later (e.g. it moved, or picked
// the wrong one at setup) — not increment-worthy for stateRevision on
// its own (it doesn't change any recorded financial fact), but callers
// that cache jurisdiction-scoped results (e.g. Loan & Debt's rate
// context cache) should treat a country change as invalidating them.
export const updateHouseholdCountry = mutation({
  args: { country: v.union(v.literal("IN"), v.literal("US"), v.literal("EU"), v.literal("OTHER")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    await ctx.db.patch(membership.householdId, { country: args.country, updatedAt: Date.now() });
    return null;
  },
});
