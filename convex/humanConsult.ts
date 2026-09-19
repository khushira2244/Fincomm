// Human consult — interest only, never "booking". No scheduling states.
// Generic across every service (Side-Income, Investment & Risk Planning,
// and any future service): callers identify what they're asking about
// with sourceService + sourceEntityId (a plain string — the id of
// whichever record in whichever service's own tables is relevant), not a
// hardcoded foreign key. See the schema comment on humanConsultRequests
// for why ownership of that referenced entity isn't re-verified here.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMembership } from "./access";

export const requestHumanConsult = mutation({
  args: { sourceService: v.string(), sourceEntityId: v.string(), topic: v.string() },
  returns: v.id("humanConsultRequests"),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.insert("humanConsultRequests", {
      householdId: membership.householdId,
      sourceService: args.sourceService,
      sourceEntityId: args.sourceEntityId,
      topic: args.topic,
      status: "interest_logged",
      requestedAt: Date.now(),
    });
  },
});

export const listHumanConsultRequests = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("humanConsultRequests").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});
