import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.string(),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
    // AgentMail's own send-path (performSend, inside the component) needs
    // this declared and passed through explicitly — components are
    // isolated from the app's process.env by default. See the local patch
    // note in node_modules/@agentmail/convex/dist/component/convex.config.js.
    AGENTMAIL_API_KEY: v.optional(v.string()),
  },
});

app.use(agentmail, {
  env: {
    AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY,
  },
});

app.use(firecrawl, {
  // Mounts the webhook route at <your-site>/firecrawl/webhook.
  httpPrefix: "/firecrawl/",
  env: {
    FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
    FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
  },
});

export default app;
