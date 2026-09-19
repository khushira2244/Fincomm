# Tax Planning

See your deductions and compare regimes — no filing, just clarity.

## What it does

A household tax profile (income, TDS, HRA, home-loan interest, 80C/80D
-eligible amounts), a deterministic Old-Regime deduction summary, an
old-vs-new regime comparison, and deduction-gap detection ("have I used
all my deductions?"). Explicitly never a filing tool.

## How the numbers are computed

Every deduction cap and slab used comes from a **real, live Firecrawl
scrape** of the official Income Tax Department site — none hardcoded,
even though the values are well-known:

- Sections 80C (₹1,50,000 combined limit), 80D (₹25,000 self/family),
  24(b) (₹2,00,000 self-occupied home loan interest), and the Old Regime
  slab table.
- Standard deduction (₹50,000, both regimes) and the Section 87A rebate
  thresholds for both regimes.

A full progressive-tax computation runs the Old Regime slabs against
taxable income; the New Regime reuses [Investment & Risk
Planning](./investment-risk.md)'s existing `taxBracket.ts` slab lookup
rather than duplicating it. Gap detection checks three deterministic
conditions: no profile set, unclaimed 80D room, unclaimed 80C room.

Every narration prompt has an explicit rule never to state a specific
date, year, deadline, or cutoff — added after an early version invented
an ungrounded filing-deadline date that appeared nowhere in its input
data.

## Key files

- `convex/taxPlanning.ts` — profile, deduction summary, regime comparison, gap detection
- `convex/taxBracket.ts` — shared New Regime slab scraping (see [Investment & Risk](./investment-risk.md))
- `src/components/tax/TaxPlanningScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
