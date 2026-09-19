# Loan & Debt Resilience

Know if a loan actually fits, and how to pay it off faster.

## What it does

Three tools built on one shared engine: a **Debt Overview** of every
recorded loan, a **New Loan Affordability** check before you take one on,
and a **Prepayment Simulator** with two modes — "pay ₹X extra, see the
result" (forward) and "be debt-free by date D, how much extra per month"
(reverse/target).

## How the numbers are computed

All math — standard-amortization EMI, a month-by-month reducing-balance
schedule, affordability aggregation, and every result state — is plain
TypeScript in `convex/loanDebt.ts`. OpenAI only narrates a finished
result; it never sees raw arithmetic.

- **EMI**: the standard reducing-balance formula, verified against a
  textbook fixture (₹1,00,000 @ 12% p.a. / 12 mo = ₹8,884.88 exactly).
- **Affordability**: down payment + fees counted once as "upfront",
  monthly-remaining checked against existing EMI commitments, reserve
  checked against eligible liquid assets minus anything already
  earmarked. States are explicit
  (e.g. `CONSTRAINT_BREACHED`), never inferred from vibes.
- **Prepayment (forward)**: a lump sum re-amortizes the real schedule;
  a lump sum larger than the balance is rejected, never silently
  clamped.
- **Prepayment (target/reverse)**: the same EMI formula solved backward
  for the payment that clears the loan by a given month count, with
  feasibility guards (a past date, or a target sooner than one payment
  away, is rejected with the earliest achievable date instead). The
  required extra payment is checked against Financial Foundation's real
  surplus — a shortfall is routed as a structured object naming the
  relevant service (e.g. Income Resilience), not just a raw number.

**Bundled insurance**: a loan can record insurance cover bundled into it
(`bundledInsuranceCoverageMinorUnits`); Debt Overview surfaces this
directly ("Bundled insurance covers ₹X of the balance") and warns when a
loan of ₹5,00,000+ has none recorded.

## Real sourced context

One allowlisted Firecrawl scrape of RBI's own homepage (Policy Repo
Rate) is shown as clearly-labelled *context* next to a quoted rate — it
never feeds the calculation or the result state, and is cached ~1 day.

## Key files

- `convex/loanDebt.ts` — all EMI/affordability/prepayment math
- `src/components/loanDebt/LoanDebtScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
