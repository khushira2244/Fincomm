# Hackathon log

- **Project:** Household Economic Resilience Platform
- **Event:** Convex All Gas Hackathon
- **What it does:** Tracks a household's income, expenses, obligations, and
  assets, and calculates how many months of runway its liquid savings cover.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://utmost-puffin-491.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex
- **Convex features:** schema, tables, indexes, query, mutation, action,
  internalMutation, internalAction, HTTP actions, scheduled functions,
  file storage
- **Auth:** Convex Auth
- **AI models:** gpt-4o (via direct OpenAI API calls in a Convex action)
- **Started:** 2026-09-04T20:11:09Z
- **Last updated:** 2026-09-06T06:14:29Z

## Log

### 2026-09-05
Scaffolded the app from the `react-vite-convexauth` Convex template, giving
it Convex Auth (email/password) and a starter schema/query/mutation/action
(`convex/schema.ts`, `convex/myFunctions.ts`, `convex/auth.ts`). Registered
the AgentMail and Firecrawl Convex components in `convex/convex.config.ts`,
with Firecrawl's API key and webhook secret wired through typed component
env vars. No product-specific schema or business logic yet — environment
setup only.

### 2026-09-05
Replaced the starter schema with the reviewed v3 design: 28 domain tables
covering identity, finance, goals, evidence, memory, reasoning, coordination,
and reliability, plus every index from the design (`convex/schema.ts`).
Restored `authTables` from `@convex-dev/auth/server` alongside the new
`users` table so Convex Auth's internal tables keep working. Removed the
scaffold's placeholder `convex/myFunctions.ts`, which referenced a `numbers`
table the new schema doesn't have. Pushed clean to the dev deployment with
`npx convex dev --once` — zero TypeScript or schema validation errors, all
tables confirmed present via `npx convex data`. No mutations, queries, or
domain-specific tables (Loan, Tax, Insurance, etc.) added yet — schema only.

### 2026-09-06
Built the Financial Foundation service: mutations to record income sources,
expenses, obligations, and assets (`convex/incomeSources.ts`,
`convex/expenses.ts`, `convex/obligations.ts`, `convex/assets.ts`), each
rejecting a non-integer `*MinorUnits` write via `Number.isInteger` and
incrementing `households.stateRevision` exactly once per successful write
(`convex/access.ts`). Added a deterministic runway query — liquid savings
÷ (essential expenses + EMI − dependable income), reporting "reserves are
not being depleted" instead of dividing by a zero/negative gap
(`convex/runway.ts`) — and a minimal dark-background dashboard wired to it
with `useQuery` (`src/App.tsx`). Added a household bootstrap
(`convex/households.ts`) and a Password-provider profile callback so
sign-up satisfies the schema's required `users` fields (`convex/auth.ts`).
Tested end to end against the fixture: essential expenses 45,000, EMI
15,000, savings 240,000 gave exactly 4 months with no income and exactly
6 months with 20,000 dependable monthly income, both matching expected
values, with the dashboard updating live as data changed.

### 2026-09-06
Fixed an unhandled sign-in error: attempting `signIn` against an email with
no account surfaced `@convex-dev/auth`'s raw internal error code
(`InvalidAccountId`) straight to the user. Added `describeSignInError` in
`src/App.tsx` to map that and the other known Password-provider result
codes (wrong password, rate limiting, duplicate sign-up) to plain-language
messages. Verified in the running app: signing in with a nonexistent email
now shows "No account found with this email. Try signing up instead."
instead of a stack trace.

### 2026-09-06
Rebuilt the frontend as "FinComp" from three finalized mockups, replacing
the unstyled dashboard: a persistent header, a collapsible sidebar listing
all 10 planned services (only Financial Foundation is real; the other 9
are dimmed with a "Soon" tag), a split-screen auth layout that stacks on
narrow screens, and a restyled Financial Foundation page with the runway
card, all 4 entry sections, and a visual-only "upload a photo/PDF instead"
affordance per section (no extraction logic wired) (`src/components/`,
`src/theme.ts`). Added one small additive query, `users.getCurrentUser`,
to source the sidebar/header's name and avatar initial — no existing
mutation, query, schema, or the runway calculation was changed. Verified
in the running app: sign-in/sign-up, household bootstrap, adding an
expense and seeing it reflected in the runway card, and the auth screen's
vertical stacking at a 375px viewport all work against the real backend.

### 2026-09-06
Fixed a flickering runway card: refreshing `now` every 5s made Convex
treat `calculateRunway` as a new query, which briefly returned `undefined`
while it reloaded — long enough to flash "calculating..." and hide the
stat row, reading as the card collapsing and re-expanding on a loop.
`RunwayCard` in `src/components/FinancialFoundationScreen.tsx` now holds
the last known result in state and only replaces it once new data
arrives, so the card never drops back to a loading state after its first
render. Verified by sampling the card's height and displayed text twice a
second for 13+ seconds (two full ticks): both stayed perfectly constant.

### 2026-09-06
Closed a real calculation gap: the Income sources and Expenses forms
never exposed a cadence/recurrence selector, even though the schema
already supports weekly/annual/irregular income and weekly/annual/one-off
expenses. Added the missing dropdowns (`src/components/
FinancialFoundationScreen.tsx`) and fixed `convex/runway.ts`, which had
been silently excluding every non-monthly cadence from the runway math
entirely rather than converting it — weekly and annual amounts are now
normalized to a monthly-equivalent (×52/12, ÷12) before summing;
irregular income and one-off expenses stay excluded, since neither has a
steady monthly figure. Verified against the real backend: a ₹1,000/week
dependable income source correctly contributed ₹4,333/mo, and a
₹12,000/year essential expense correctly contributed ₹1,000/mo, both
picked up by the live runway calculation. Also centered the Financial
Foundation page's content within the sidebar layout.

### 2026-09-06
Built Document Intelligence: an OpenAI (gpt-4o) extraction pipeline behind
both the AgentMail inbox and the sections' upload links, writing only to
`documents`/`extractedFacts` — never directly into the real tables.
Mounted the AgentMail webhook in `convex/http.ts` via `handleWebhook`,
wired `onMessageReceived` to schedule an action rather than call OpenAI
inline (`convex/email.ts`; mutations have a 1s timeout). Wired the
previously visual-only upload links to real Convex file storage and an
extraction action supporting both images and PDFs (`convex/
documentIntelligence.ts`). Added pending-confirmation cards (dashed
border, Edit/Confirm) to all 4 Financial Foundation sections, sourced
from a new `extractedFacts.listPendingByCategory` query; Confirm reuses
the existing add mutations and then marks the fact `userConfirmed` with
`targetEntityId` linked to the new record — no new write path into the
real tables (`convex/extractedFacts.ts`).

Tested against real generated fixtures, not mocks: a hand-built PDF loan
notice correctly extracted as an obligation (label "Personal Loan", EMI
₹6,200, balance ₹1,50,000 in a separate field) and confirmed into the
real obligations table; a canvas-drawn salary image and a simulated
inbound email (run through the same `onMessageReceived` mutation a real
AgentMail webhook delivery would trigger) were both correctly categorized
and written as pending facts, confirmed, and reflected in the runway
recalculation. Found and fixed a real bug in the process: naming the
extraction schema field `amountMinorUnits` led the model to apply the
standard finance-API meaning of that term (rupees × 100, Stripe-style)
rather than this app's own rupees-as-base-unit convention, producing a
100× overextraction (₹45,000 read back as ₹45,00,000) — confirmed by the
exact arithmetic match, fixed by renaming the model-facing field to
`amountInRupees` with an explicit no-conversion instruction, and verified
correct on a repeat of the same test image.

Known, flagged limitation: there is no per-household inbox mapping in the
(unmodified) schema, so all inbound AgentMail messages route to whichever
household was created first in the deployment — fine for this single-
household testing stage, not multi-tenant-correct. Real end-to-end
AgentMail webhook delivery (HTTP signature verification via
`AGENTMAIL_WEBHOOK_SECRET`) was not exercised — that secret is issued
when registering the webhook URL in AgentMail's own dashboard, which
needs the account holder, not this session.
