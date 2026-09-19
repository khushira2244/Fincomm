# Side-Income & Business Planning

Explore a job or business idea that realistically fits your time and money.

## What it does

Two paths sharing the household's real Financial Foundation numbers:

- **Job track** — describe your available time, target income, and the
  kind of work you want (free text, extracted into structured fields —
  hours/week, target amount, when, remote-vs-local) and get grounded
  opportunity estimates.
- **Business track** — describe an idea (free text) and get a startup
  -capital-vs-reserve check against your real liquid savings.

Selecting opportunities produces a combined plan (time and income
conflicts checked independently), deep dives per opportunity (6 job
topics, 5 business topics), scheme-eligibility search, and a "request a
real person" consult log.

## How the numbers are computed

Job math is pure arithmetic, reversible both directions
(hours ↔ target monthly income at a known/estimated hourly rate) —
verified to be consistent to the rupee after fixing an early rounding
bug (2-decimal intermediate rounding was cutting consistency to ~₹6/mo;
fixed by carrying 4-decimal precision and only rounding for display).
Business capital is checked against the exact same eligible-liquid
-reserve-minus-earmarked calculation Loan & Debt's Affordability uses.

When an hourly rate isn't known, one Firecrawl web search + one OpenAI
reasoning pass produces a clearly-labelled rough range (`isRoughEstimate`
flagged) — scoped to a real stated location when given (never guesses a
city), and to "India" broadly when the preference is remote/unstated.

## Free-text extraction

"Type of work" and "Idea description" are open textareas, not rigid
single-line inputs. Two extraction-only actions
(`extractJobIntent`, `extractBusinessIntent`) pull structured fields
(hours, target amount, capital, ramp-up) out of what you actually wrote
— filling only the fields you left blank, never overwriting something
you typed yourself. A clean short label (e.g. "home candle-making
business") is what gets stored and displayed; the full raw paragraph is
what's sent to the search.

## Key files

- `convex/sideIncome.ts` — job/business math, extraction, deep dives
- `convex/humanConsult.ts` — the shared "want a real person's opinion" log
- `src/components/sideIncome/SideIncomeScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
