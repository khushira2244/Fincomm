# FinComp

**One place to see what a decision really means for your household.**

## What it is

<img width="956" height="470" alt="image" src="https://github.com/user-attachments/assets/b8df27da-4606-461c-ba5a-7142c4a710b6" />


FinComp is a goal- and situation-aware financial platform for Indian
households, connecting income, debt, goals, investments, insurance, tax,
and real economic signals in one place instead of scattering them across
apps. It's built for the Convex All Gas Hackathon.

## Live demo

**[https://quixotic-dalmatian-305.convex.site](https://quixotic-dalmatian-305.convex.site)**

## The 9 services

- **Financial Foundation** — See your real numbers: income, expenses,
  loans, and how long your reserves would last.
- **Goal & Situation Planning** — Plan across years, not just today, and
  see how your plans interact.
- **Loan & Debt Resilience** — Know if a loan actually fits, and how to
  pay it off faster.
- **Side-Income & Business Planning** — Explore a job or business idea
  that realistically fits your time and money.
- **Investment & Risk Planning** — Understand what you can afford to set
  aside — never what to buy.
- **Insurance, Protection & Financial Rights** — Know what you're covered
  for, and where you might be exposed.
- **Tax Planning** — See your deductions and compare regimes — no filing,
  just clarity.
- **Government, Economic & Livelihood Intelligence** — We watch for real
  changes that could affect your job, business, or plans.
- **Income Resilience** — The full picture: how exposed your household
  really is, and what to do about it.

## Tech stack

- **[Convex](https://convex.dev)** — backend, real-time data, and auth
  (via Convex Auth).
- **OpenAI** — narration and extraction only, never calculation: turning
  finished, deterministic results into plain language, and pulling
  structured facts out of free text/documents.
- **[Firecrawl](https://firecrawl.dev)** — real sourced data: RBI
  benchmark rates, IRDAI insurance guidelines, Income Tax Department
  slabs, and MSME/government schemes, scraped and cached, never
  fabricated.
- **AgentMail** — inbound document extraction via email (forward a bill
  or statement, it gets parsed into a pending fact for you to confirm),
  plus proactive outbound alerts and on-demand summaries.

## Core design principle

**Every calculation is deterministic. AI only narrates, extracts, and
explains — it never invents a number, a rate, or financial advice.**
Every service's actual math (EMI, runway, affordability, tax slabs,
compounding, coverage gaps) is plain TypeScript, computed the same way
every time from the household's own data and, where relevant, a real
scraped source. The AI layer is handed the finished result and turns it
into plain language, or pulls structured fields out of unstructured text
(a document, an email, a free-text description) — it is never the thing
deciding what the numbers are.

## Architecture flow

```
React (Vite) frontend
      │  Convex client (real-time queries/mutations over WebSocket)
      ▼
Convex backend
      │
      ├─ queries / mutations ──────► deterministic per-service logic
      │                              (EMI, runway, affordability, tax
      │                               slabs, coverage gaps, ...) — plain
      │                               TypeScript, no AI in the math
      │
      ├─ actions ──────────────────► OpenAI (gpt-4o)
      │                              narrates a finished result, or
      │                              extracts structured fields from
      │                              free text/documents — never
      │                              computes a figure itself
      │
      ├─ actions ──────────────────► Firecrawl
      │                              scrapes a real, allowlisted source
      │                              (RBI, IRDAI, Income Tax Dept, ...),
      │                              cached in sourceRegistry/
      │                              sourceSnapshots, parsed
      │                              deterministically (regex/table
      │                              parsing, not AI)
      │
      └─ HTTP actions ─────────────► AgentMail webhook (inbound email →
                                      document extraction → pending
                                      fact) and outbound sends (alerts,
                                      on-demand summaries)

Convex File Storage + an HTTP Action catch-all route also serve the
built frontend directly from this deployment's own *.convex.site
domain (see convex/staticSite.ts, convex/http.ts, and
scripts/deploy-static-site.mjs) — Convex has no built-in static-hosting
product, so this is a small custom implementation of one.
```

## Running locally

```
npm install
npx convex dev
npm run dev
```

## Full build log

The complete, evidence-based development history — every service, every
verification pass, every bug found and fixed, in chronological order —
lives in [hackathon.md](./hackathon.md).

## License

MIT — see [LICENSE.txt](./LICENSE.txt).
