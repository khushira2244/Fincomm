// Shared helpers for Group 1 / Service 1 (Financial Foundation).
// Not a query/mutation/action itself, so it exposes no public API surface —
// just plumbing reused by the finance mutations and the runway query.

import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Every finance mutation/query in this service acts on behalf of the
// signed-in user's own household. There is exactly one membership per user
// in this MVP (created by households.ensureHousehold), so resolving "the
// caller's household" is a lookup on that membership — never a client-
// supplied householdId, so a caller can't point a write at someone else's
// household.
export async function requireMembership(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"memberships">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not signed in.");
  }
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (membership === null) {
    throw new ConvexError(
      "No household found for this user yet. Call households.ensureHousehold first.",
    );
  }
  return membership;
}

// Required enforcement rule from the schema's closing comment:
// Number.isInteger(amountMinorUnits) must be checked on every write to a
// money field, since Convex's v.number() is a float64 and can't itself
// guarantee an integer value.
export function assertIntegerMinorUnits(value: number, fieldName: string): void {
  if (!Number.isInteger(value)) {
    throw new ConvexError(
      `${fieldName} must be an integer number of minor currency units (e.g. paise), got ${value}.`,
    );
  }
}

// Required enforcement rule from the schema's closing comment:
// households.stateRevision increments ONLY for decision-affecting changes
// (income/expense/obligation/asset writes here) — never for UI prefs,
// notification-read status, or similar. Every finance mutation below calls
// this exactly once, after its own write succeeds.
export async function bumpStateRevision(
  ctx: MutationCtx,
  householdId: Id<"households">,
): Promise<void> {
  const household = await ctx.db.get("households", householdId);
  if (household === null) {
    throw new ConvexError("Household not found.");
  }
  await ctx.db.patch("households", householdId, {
    stateRevision: household.stateRevision + 1,
    updatedAt: Date.now(),
  });
}
