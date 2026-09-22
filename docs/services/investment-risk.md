# Investment & Risk Planning

Understand what you can afford to set aside — never what to buy.

## What it does

The strictest AI boundary of any service: it shows capacity and ranges,
never a recommendation or a promised return. Three pieces — **Investment
Readiness** (how much surplus you genuinely have to invest), **Goal
-Based Scenarios** (what a monthly contribution could become over time),
and general asset-category education (not product-specific).

A single ask box routes free-text questions ("How much can I safely
invest right now?", "I have ₹10,000/month leftover — what could that
become?", "What should I invest in to save on taxes?") to the right
underlying check via keyword matching, and returns a fully resolved
result from one call.

## How the numbers are computed

- **Readiness**: reuses Loan & Debt's exact eligible-liquid-reserve
  -excluding-earmarked calculation (one cross-file call, not
  reimplemented), tiered `INSUFFICIENT_DATA` / `LIMITED_CAPACITY` /
  `MODERATE_CAPACITY` / `STRONG_CAPACITY`, downgraded a tier when an
  active goal is competing for a still-thin surplus, and downgraded a
  further tier when [Insurance](./insurance-protection.md) has detected a
  significant life-cover shortfall (a live cross-service read, not a
  hardcoded assumption).
- **Scenarios**: pure compound-growth arithmetic over an assumed rate
  range grounded in a real Firecrawl search (or a clearly-labelled
  placeholder if nothing usable turns up) — verified by hand against the
  standard compounding formula to the rupee.
- **Tax-bracket estimator** (`convex/taxBracket.ts`): scrapes the real
  Income Tax Department site and parses its actual slab table
  deterministically (never a fixed column index, never AI in the parse)
  — reused directly by [Tax Planning](./tax-planning.md), not duplicated.

Deterministic explanation text ("how this was calculated", "what would
change this answer", "what this doesn't tell you") is template-built
from the same diagnostic object that decides the tier, so it can never
contradict the number it explains.

## Outside India

Genuinely SEBI-specific and not being rebuilt per country. If a
household's selected country (`convex/jurisdiction.ts`) isn't India,
the readiness check pushes one honest caveat into its existing
narration naming SEBI and the household's actual region — the
deterministic readiness tier and figures are untouched either way.

## Key files

- `convex/investment.ts` — readiness, scenarios, the ask router
- `convex/taxBracket.ts` — shared tax-slab scraping/parsing
- `src/components/investment/InvestmentScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
