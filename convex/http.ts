import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
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

export default http;
