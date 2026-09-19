# Government, Economic & Livelihood Intelligence

We watch for real changes that could affect your job, business, or plans.

## What it does

Structurally different from every other service: **push, not pull**. A
daily cron sweeps every household with a livelihood profile (job
occupation/sector/state, or an active side-income business), checks for
real changes since the last sweep, and — for a significant one — emails
the household proactively, unprompted.

## How it decides what matters

Each household's profile is checked against real sources via Firecrawl:
a benchmark interest-rate move, sector-risk news coverage, and matching
government/MSME schemes. Severity is a documented, deterministic
threshold per finding type — e.g. an interest-rate move ≥25 basis points
is `significant`, smaller moves are `notable` — never an AI judgment
call. A scheme "match" is a plain case-insensitive substring check
against the real search result's own title/description, not an AI
decision either.

OpenAI's only role is extraction-only, upstream of any of this: pulling
occupation/sector/state (job) or business type/approximate income
(business) out of the free-text profile description you write — the
same boundary as Financial Foundation's document extraction.

A per-household 24-hour cap prevents alert spam: at most one proactive
email per day, with any additional significant findings held for the
next eligible digest rather than dropped.

## Key files

- `convex/governmentEconomic.ts` — profiles, findings, severity, proactive send
- `convex/crons.ts` — the daily sweep (staggered per household)
- `src/components/governmentEconomic/GovernmentEconomicScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
