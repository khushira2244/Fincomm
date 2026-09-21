# Financial Foundation

See your real numbers — income, expenses, loans, and how long your reserves would last.

## What it does

The base layer every other service reads from: income sources, expenses,
obligations (loans/EMIs), assets, and insurance policies, plus a live
**runway** figure — how many months your liquid savings would cover your
essential outgoings. Every row can be added, edited, or deleted (a
two-click "Really delete?" confirm, no modal), and every write bumps the
household's `stateRevision` so every other service's cached results know
to recompute.

## How the numbers are computed

Runway is deterministic:

```
runway (months) = liquid savings ÷ (essential expenses + EMI − dependable income)
```

Weekly and annual cadences are normalized to a monthly equivalent
(×52/12, ÷12) before summing; irregular income and one-off expenses are
excluded, since neither has a steady monthly figure. If the gap is zero
or negative, the app reports "holding steady — income covers what goes
out" instead of dividing by zero.

Obligation entry deliberately asks for two plain-language numbers —
**total amount still owed** and **what you pay monthly** — rather than
banking terms like "outstanding balance" / "EMI", so no financial
literacy is assumed. Detailed loan terms (rate, tenure, fees) live in
[Loan & Debt Resilience](./loan-debt-resilience.md) instead of here.

## Document Intelligence

Every section also accepts a forwarded email or an uploaded photo/PDF.
OpenAI extracts category-typed facts (income/expense/obligation/asset/
insurance) into a **pending** state — nothing is written to the real
tables until the household reviews and confirms it. The extraction
prompt is careful about units: fields are named `amountInRupees`, not
`amountMinorUnits`, specifically because the generic finance-API
convention (rupees × 100) once caused a real 100× overextraction bug.

## Key files

- `convex/incomeSources.ts`, `convex/expenses.ts`, `convex/obligations.ts`,
  `convex/assets.ts`, `convex/insurance.ts` — CRUD per category
- `convex/runway.ts` — the runway calculation
- `convex/documentIntelligence.ts`, `convex/extractedFacts.ts` — extraction pipeline
- `convex/email.ts`, `convex/http.ts` — AgentMail inbound webhook
- `src/components/FinancialFoundationScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
