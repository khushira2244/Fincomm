# Income Resilience

The full picture — how exposed your household really is, and what to do about it.

## What it does

A cross-service **synthesis**, not a new domain: reads live from
Financial Foundation, Loan & Debt, Insurance, Side-Income, and
Government/Economic Intelligence — modifying none of them — to score an
overall resilience tier: `resilient` / `worthALook` / `atRisk`.

## How the numbers are computed

Eight deterministic dimensions each score a weak/strong signal: income
concentration in a single source, a structural monthly deficit, runway
months against a real sourced benchmark, EMI-to-income ratio, presence
of life/personal-accident insurance, a semi-liquid reserve beyond the
emergency runway, backup income in progress, and any recent real
`significant` finding from [Government/Economic
Intelligence](./government-economic-intelligence.md). OpenAI narrates
the already-decided tier only — it never re-judges it or recommends a
specific product.

The "how many months of expenses should you keep" benchmark is itself
real, not a hardcoded "6 months" rule from training data: a Firecrawl
search finds a real source, and a deterministic regex (never AI) parses
a months figure out of it, cached 60 days.

A snapshot is written only when the household's tier genuinely changes
— the interactive check itself is fully reactive and recomputed fresh
every time, no manual save button. A proactive AgentMail alert fires
specifically on a genuine transition **into** the worst tier (`atRisk`)
— never on a repeat check or an improvement.

## The living note

A free-text note per household (overwritten on save, not an
accumulating log) lets you say what structured data can't capture — job
worry, a health issue, a dependent. AI extracts a single concern
category only (job security / health-or-dependent / major life event /
business concern / none) and the narration may honestly reference it —
it never touches the deterministic tier or the eight weak-dimension
scores.

## Key files

- `convex/incomeResilience.ts` — the eight dimensions, tiering, the note
- `convex/crons.ts` — the daily sweep (offset an hour from Government/Economic's own)
- `src/components/incomeResilience/IncomeResilienceScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
