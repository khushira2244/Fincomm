// AgentMail wiring for Document Intelligence. The AgentMail client is
// instantiated here (not inline in http.ts) so the SAME instance carries
// both the webhook-signature verification and the onMessageReceived
// callback — per the component's docs, both need to come from one
// client for the callback to actually fire on an inbound message.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

export const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onMessageReceived,
});

// MVP scope: there is no per-household inbox mapping in the (approved,
// unmodified) schema — households doesn't carry an inboxId field — so
// every inbound message is routed to the single household currently in
// the system. Multi-household inbox routing would need a schema field;
// out of scope here, flagged rather than worked around.
export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const household = await ctx.db.query("households").first();
    if (household === null) {
      return null;
    }
    const message = args.message as {
      subject?: string;
      text?: string;
      message_id?: string;
    };
    await ctx.scheduler.runAfter(0, internal.documentIntelligence.extractFromEmail, {
      householdId: household._id,
      subject: message.subject ?? "",
      text: message.text ?? "",
      externalRef: message.message_id ?? args.eventId,
    });
    return null;
  },
});
