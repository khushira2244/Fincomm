# Goal & Situation Planning

Plan across years, not just today — and see how your plans interact.

## What it does

A per-timeline planning view: create multiple named timelines (e.g. "Next
2 years"), and within each one log family support commitments, loans,
short-term goals, and free-text situations — each with its own positive
and negative steps. Timeline data lives in its own tables
(`timelineFamilySupport`, `timelineLoans`, etc.), deliberately separate
from Financial Foundation's `expenses`/`obligations`, so planning a
future scenario never leaks into today's live runway.

Confirming a timeline runs a full analysis: an overall verdict, per
-category summaries, and 2–3 "what if" chips grounded in real detected
gaps (e.g. a short-term goal sharing a timeline with a yearly family
obligation, or planned EMI headroom that doesn't fit the current
surplus).

## How the numbers are computed

Every check is deterministic — it reads Financial Foundation's existing
runway query (never recomputes or duplicates it) plus every confirmed
timeline's items, and runs plain arithmetic per category: does family
support fit the current surplus, is expected career income stated, does
planned EMI have headroom. OpenAI is handed the finished diagnostic
object afterward and only narrates it into the verdict, summaries, and
what-if chips — it never decides a number.

"What if" questions (e.g. "What if I lost my job for 6 months?") are
matched by keyword to one of four scenarios (income loss / EMI increase
/ one-time expense / income increase), the arithmetic runs against the
real runway breakdown, and a second OpenAI call narrates the result —
the model never produces the figure itself.

Analyses are cached per exact confirmed-timeline-set + the household's
`stateRevision` at generation time, so re-confirming with nothing changed
returns instantly instead of re-running.

## Key files

- `convex/goalPlanning.ts` — timelines, categories, suggestion generation
- `convex/planAnalysis.ts` — plan analysis + what-if answering
- `src/components/goalPlanning/`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
