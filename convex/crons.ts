// First cron in this app — Government, Economic & Livelihood
// Intelligence is the first genuinely PUSH service. Fires once daily;
// the handler itself staggers each household's actual monitoring work
// across the sweep window (see sweepAllHouseholds in
// convex/governmentEconomic.ts) rather than firing every scrape at once.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "government economic livelihood intelligence sweep",
  { hourUTC: 3, minuteUTC: 0 },
  internal.governmentEconomic.sweepAllHouseholds,
);

// Income Resilience piggybacks on this same daily-cron pattern, offset
// an hour later so its own Firecrawl/OpenAI load never overlaps with
// the sweep above (each sweep also staggers its own per-household work
// internally — see sweepAllHouseholds in convex/incomeResilience.ts).
crons.daily(
  "income resilience sweep",
  { hourUTC: 4, minuteUTC: 0 },
  internal.incomeResilience.sweepAllHouseholds,
);

export default crons;
