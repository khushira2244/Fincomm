// New, additive-only query for the FinComp UI (header avatar initial,
// sidebar profile name). Does not modify any existing function.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getCurrentUser = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string(), email: v.optional(v.string()) })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      return null;
    }
    return { name: user.name, email: user.email };
  },
});
