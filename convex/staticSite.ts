// Deploy tooling — serves the built Vite frontend directly from this
// deployment's own *.convex.site domain via HTTP Actions + File
// Storage, since Convex has no built-in static-hosting product (a real
// gap confirmed against current docs, not assumed). Every function
// here is internal — never exposed to the app's own users — driven
// only by scripts/deploy-static-site.mjs via `npx convex run`, which
// has admin access outside the normal client auth boundary. Nothing
// here reads or writes any household data.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const recordAsset = internalMutation({
  args: { path: v.string(), storageId: v.id("_storage"), contentType: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("staticAssets").withIndex("by_path", (q) => q.eq("path", args.path)).first();
    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, { storageId: args.storageId, contentType: args.contentType });
    } else {
      await ctx.db.insert("staticAssets", args);
    }
    return null;
  },
});

// Removes any asset row (and its stored blob) whose path ISN'T in the
// given set — run once at the end of a deploy after every current
// build file has been uploaded/recorded, so a file removed between
// builds (e.g. Vite's hashed filenames change every build) doesn't
// linger and get served stale.
export const pruneAssetsNotIn = internalMutation({
  args: { keepPaths: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const keep = new Set(args.keepPaths);
    const all = await ctx.db.query("staticAssets").take(500);
    let removed = 0;
    for (const row of all) {
      if (!keep.has(row.path)) {
        // Tolerate a blob that's already gone (e.g. a stale/bad row) so
        // one bad entry can't block pruning the rest.
        try {
          await ctx.storage.delete(row.storageId);
        } catch {
          // already missing — fall through and still remove the row
        }
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return removed;
  },
});

export const getAssetByPath = internalQuery({
  args: { path: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), contentType: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("staticAssets").withIndex("by_path", (q) => q.eq("path", args.path)).first();
    return row ? { storageId: row.storageId, contentType: row.contentType } : null;
  },
});

export const listAssetPaths = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => (await ctx.db.query("staticAssets").take(500)).map((r) => r.path),
});
