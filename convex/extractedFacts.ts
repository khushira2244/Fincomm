import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";
import { requireMembership } from "./access";

const CATEGORY = v.union(
  v.literal("incomeSources"),
  v.literal("expenses"),
  v.literal("obligations"),
  v.literal("assets"),
  v.literal("insurancePolicies"),
);

// No index combines householdId + targetEntityType + verificationStatus,
// so this reads by_household (bounded) and filters the rest in memory —
// fine for one household's extracted facts, not a general large-scale
// aggregate.
export const listPendingByCategory = query({
  args: { category: CATEGORY },
  returns: v.array(schema.doc("extractedFacts").extend({ sourceType: v.string() })),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const facts = await ctx.db
      .query("extractedFacts")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .take(200);
    const pending = facts.filter(
      (f) => f.targetEntityType === args.category && f.verificationStatus === "extracted",
    );
    return await Promise.all(
      pending.map(async (fact) => {
        const document = await ctx.db.get("documents", fact.documentId);
        return { ...fact, sourceType: document?.sourceType ?? "document" };
      }),
    );
  },
});

// Marks a candidate as accepted once the user has confirmed it into a
// real table via one of the existing add mutations. Does not write to
// incomeSources/expenses/obligations/assets itself — that already
// happened by the time this is called.
export const confirmExtractedFact = mutation({
  args: { factId: v.id("extractedFacts"), targetEntityId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const fact = await ctx.db.get("extractedFacts", args.factId);
    if (fact === null || fact.householdId !== membership.householdId) {
      throw new ConvexError("Extracted fact not found.");
    }
    await ctx.db.patch("extractedFacts", args.factId, {
      verificationStatus: "userConfirmed",
      targetEntityId: args.targetEntityId,
    });
    return null;
  },
});
