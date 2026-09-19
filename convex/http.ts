import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { agentmail } from "./email";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  // `@agentmail/convex`'s own `RunMutationCtx` type predates Convex
  // 1.41's optional third `transactionLimits` argument on
  // `ctx.runMutation`, so its declared type doesn't structurally match
  // the current ActionCtx even though the runtime call is unaffected
  // (that argument is optional). Cast to work around the upstream type
  // mismatch, not a real incompatibility.
  handler: httpAction(async (ctx, req) => agentmail.handleWebhook(ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0], req)),
});

// Serves the built Vite frontend directly from this deployment's own
// *.convex.site domain — Convex has no built-in static-hosting product
// (confirmed against current docs), so this is a real HTTP Action +
// File Storage implementation of one. Routes with an exact `path`
// (auth's own routes, the AgentMail webhook above) are matched before
// this pathPrefix catch-all, so neither is at risk of being swallowed
// by it. See convex/staticSite.ts and scripts/deploy-static-site.mjs.
http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path === "/") path = "/index.html";

    let asset = await ctx.runQuery(internal.staticSite.getAssetByPath, { path });
    // SPA fallback: this app's own routing lives in localStorage, not
    // the URL bar, but a direct hit on an unknown path (or a stray
    // browser request like /favicon.ico) should still get the app
    // shell rather than a bare 404.
    if (!asset) asset = await ctx.runQuery(internal.staticSite.getAssetByPath, { path: "/index.html" });
    if (!asset) return new Response("Site not deployed yet — run scripts/deploy-static-site.mjs.", { status: 404 });

    const blob = await ctx.storage.get(asset.storageId);
    if (!blob) return new Response("Asset missing from storage.", { status: 404 });
    return new Response(blob, { status: 200, headers: new Headers({ "Content-Type": asset.contentType }) });
  }),
});

export default http;
