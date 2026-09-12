# Hackathon log

- **Project:** Household Economic Resilience Platform
- **Event:** Convex All Gas Hackathon
- **What it does:** Tracks a household's income, expenses, obligations, and
  assets, and calculates how many months of runway its liquid savings cover.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** https://utmost-puffin-491.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex (Firecrawl
  now used: one allowlisted benchmark-rate scrape in Loan & Debt Resilience)
- **Convex features:** schema, tables, indexes, query, mutation, action,
  internalMutation, internalAction, internalQuery, HTTP actions, scheduled
  functions, file storage
- **Auth:** Convex Auth
- **AI models:** gpt-4o (via direct OpenAI API calls in Convex actions)
- **Started:** 2026-09-04T20:11:09Z
- **Last updated:** 2026-09-10T08:41:59Z

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

### 2026-09-10
Built Goal & Situation Planning (Service #2), a per-timeline planning
view. Schema additions (all additive, existing tables/reads untouched):
new tables `timelines`, `timelineFamilySupport`, `timelineLoans`,
`familyObligations`, `suggestionDismissals`; optional `timelineId` +
`positiveSteps`/`negativeSteps`/`horizon` on `goals` and
`timelineId`/`situationCategory` on `situations`. Timeline family-support
and loans deliberately live in their own tables, not the Financial
Foundation `expenses`/`obligations` tables, so timeline planning never
leaks into the current runway. Backend (`convex/goalPlanning.ts`):
`createTimeline` (auto "Timeline N"), `updateTimelineYears`, per-category
add/list functions, `updateGoalSteps`, and read-time suggestion
generation — cross-timeline family-support carry-forward ("Same amount /
Different amount / Ends here") plus an earlier-mention resurfacing
heuristic — filtered against `suggestionDismissals`. Frontend
(`src/components/goalPlanning/`): timeline overview with item and
suggestion-count badges, and a detail screen with amber suggestion cards
and eight collapsible category sections, both wrapped in the existing
FinComp sidebar shell; sidebar now activates Financial Foundation +
Goal & Situation Planning, the other eight stay dimmed.

Verified in the running app: created two timelines, added family
support / a loan / a short-term goal with newline-split positive and
negative steps (stored as string arrays), set free-text year labels,
and confirmed a carry-forward suggestion appeared on the later timeline
and its badge showed on the overview. Draft auto-save: every form input
writes to localStorage debounced ~500ms keyed
household+timeline+category+field; typed-but-unsubmitted values survived
a full page reload, and were cleared once the entry's Add button was
pressed. Skipped, as agreed: extending Document Intelligence to extract
goal/situation-shaped content — so the resurfacing suggestion is built
but has no input source yet.

### 2026-09-10
Added plan analysis to Goal & Situation Planning. Schema: `timelines`
gains `confirmed` (optional bool, false at creation); new `planAnalyses`
table caching results keyed on the exact confirmed-timeline set +
`inputStateRevision` (the household stateRevision at generation time).
A "Confirm & see my analysis" card at the bottom of the timeline detail
page flips `confirmed` true, runs `generateAnalysis`, and navigates to a
new "Your plan, at a glance" screen (wrapped in the same sidebar shell).
`generateAnalysis` (`convex/planAnalysis.ts`) reads Financial
Foundation's runway via its existing query — never modified or
duplicated — plus every confirmed timeline's items, runs deterministic
per-category checks (does family support fit the current surplus, does a
short-term goal share a timeline with a yearly family obligation, is
expected career income stated, planned-EMI headroom), then one OpenAI
(gpt-4o) call narrates those numbers into the overall verdict, per-
category summaries/details, and 2-3 what-if chips grounded in detected
gaps. Categories with no data anywhere in the included timelines are
omitted, not shown as empty cards. `answerWhatIf` detects the scenario
by keyword (income loss / EMI increase / one-time expense / income
increase), does the arithmetic on the runway breakdown, and a second
OpenAI call narrates it — the model never produces a figure.

Verified against the real backend: confirming a timeline generated a
live analysis in ~11s (Overall verdict, Family / Short-term goal / Loans
cards with Career + Side income correctly skipped, generated chips);
re-confirming with nothing changed returned the cached result in ~1s
(no OpenAI call); adding an item to a confirmed timeline flipped the
screen to "Your data has changed" with a working Re-analyse button; and
"What if I lost my job for 6 months?" returned exactly 4.7 months of
cover and a ₹79,200 shortfall (₹3,00,000 ÷ (₹43,200 gap + ₹20,000 lost
income); 6 × ₹63,200 − ₹3,00,000), narrated without altering a number.
Financial Foundation's own runway (6.9 months) was unaffected throughout.

### 2026-09-10
Built Loan & Debt Resilience, Session 1 (Debt Overview, New Loan
Affordability, Prepayment Simulator) as the third active sidebar
service. Schema: 10 optional fields added to `obligations`
(`annualRateBasisPoints` as a new authoritative rate, `rateType`,
`remainingTenureMonths`, `feesMinorUnits`, `prepaymentTerms`, etc.), a
new `loanAnalyses` table that keeps every version (never pruned, unlike
`planAnalyses`), and one field on `sourceSnapshots` for a parsed
benchmark rate. All maths — standard-amortization EMI, a month-by-month
reducing-balance schedule, affordability aggregation, and the five
explicit result states — is computed in `convex/loanDebt.ts`; gpt-4o
only narrates a finished result and never sees raw arithmetic. Firecrawl
is now used for real: one allowlisted scrape of a public India
benchmark-rate page (via `sourceRegistry`/`sourceSnapshots`), cached ~1
day, the rate parsed by regex (not AI), shown as clearly-labelled
context that does not feed the calculation or the state.

Verified against the deployment with real numbers: EMI on the textbook
fixture (₹1,00,000 @ 12% p.a. / 12 mo) = ₹8,884.88 exactly;
zero-interest loan → ₹P/n with no division error; fractional tenure
(120.5) and non-integer fees (100.5) rejected at the mutation;
affordability for a ₹5,00,000 @ 10% / 60-mo offer with ₹1,00,000 down +
₹5,000 fees → EMI ₹10,624, total interest ₹1,37,440 (fees excluded),
upfront ₹1,05,000 (down + fees, counted once), monthly-remaining
−₹53,824 (existing ₹15,000 EMI included, down payment not subtracted),
reserve ₹1,95,000, state CONSTRAINT_BREACHED by code; earmarking a
₹60,000 asset dropped eligible reserve to ₹1,35,000; lump sum >
outstanding balance rejected with an explicit error, not clamped; a lump
sum equal to the balance closed the loan (revised 0 months, interest
saved ₹11,18,489, net ₹10,88,489 after a ₹30,000 charge); cross-household
obligation access blocked ("Obligation not found"); an unchanged offer
returned from cache in ~0.8s vs ~4-14s; adding an expense bumped the
household stateRevision and forced a recompute, leaving the older
`loanAnalyses` row intact alongside the new one; the Firecrawl context
showed the live 5.25% benchmark against the quoted 10% (diff 4.75pp)
with source and retrieval date.

### 2026-09-10 — Prepayment Simulator: target mode (backend)

Added a second, reversed mode to the Prepayment Simulator: instead of
"pay ₹X extra, see the result", it answers "be debt-free by date D — how
much extra per month, and can I afford it?". The existing forward mode is
untouched. Schema: one new literal `"prepaymentTarget"` on the
`loanAnalyses.analysisType` union — same table, same insert-only
versioning, no new table.

All decision-making stays deterministic in `convex/loanDebt.ts`. A single
pure function (`computePrepaymentTargetCore`) does three things: (1)
reverse amortization — the verified EMI formula solved for the payment
given a fixed month count, rounded up so the target is met, with
feasibility guards that reject a past date or a target sooner than one
payment away and name the earliest achievable date; (2) a goal/reserve
conflict check reusing the affordability pattern against the required
extra payment; (3) shortfall routing — compares the required extra
against Financial Foundation's current monthly surplus (reused via its
own runway query, not recomputed) and, on a gap, emits a structured
object naming the two relevant services with `{key, label, reason}` plus
the exact gap. gpt-4o only narrates the finished object.

Verified against the deployment with real numbers (test household:
surplus ₹48,000, one-month essentials ₹40,000, Car loan ₹5,00,000 @ 10%
p.a. fixed, EMI ₹12,000, one active goal in a confirmed timeline).
Reverse/forward consistency: required payment on the textbook fixture
(₹1,00,000 @ 12% / 12 mo) = ₹8,885, which fed back through the forward
schedule pays off in exactly 12 months; 6-mo target ₹17,255 → 6 months;
zero-interest ₹1,20,000 / 10 mo → ₹12,000 with no division error → 10
months. 36-mo target → extra ₹4,134/mo, no shortfall, no goal conflict.
12-mo target → extra ₹31,958 (≤ ₹48,000 surplus, so no shortfall) but
surplus-after-extra ₹16,042 is below the ₹40,000 floor, so goalConflict
and reserveConflict both fire — conflict flagged independently of
shortfall; with the goal removed, goalConflict flips to false while
reserveConflict stays, confirming the two checks are independent. 6-mo
target → extra ₹73,781 > surplus, shortfall gap ₹25,781, structured
routing to Income Resilience / Side-Income & Business Planning. Past date
and sub-one-month targets rejected with the earliest-achievable date. A
repeat call returned from cache; adding an expense bumped the household
stateRevision and forced a recompute, leaving the older `loanAnalyses`
row intact beside the new one. Every stored row has the fully-computed
`deterministic` block (all figures, both conflict booleans, the shortfall
gap) as a sibling of `narration` — the model is handed that finished
object and returns prose only.

### 2026-09-12 — Integration checkpoint: AgentMail + Firecrawl

Verification pass on the two third-party integrations before starting
Side-Income & Business Planning, plus one small deepening on each.

**AgentMail inbound webhook:** confirmed live against the real
deployment — `AGENTMAIL_WEBHOOK_SECRET` is not set. Posting to the real
`/agentmail/webhook` endpoint with no signature returns `500` (the
component's own `assertConfigured` throws before signature checking ever
runs), not a clean `401` — so today the webhook can't accept real mail
at all. Read `@agentmail/convex`'s webhook code to confirm the intended
behavior once the secret is set: Svix verification, `401` on a bad/missing
signature. Drove the component's own `handleEvent` mutation directly with
one `event_id` delivered twice — exactly one `inboundMessages` row
resulted, confirming its dedup guard. The one document earlier tagged as
proving inbound mail (`externalRef: "test-msg-electricity-001"`) is a
synthetic id, not a real AgentMail delivery — so inbound mail has never
actually been exercised end-to-end. The current `AGENTMAIL_API_KEY` is
also scoped too narrowly to list inboxes, list webhooks, or read API
keys (`403 missing_permission` on each), so AgentMail's own webhook
registration for our URL can't be confirmed from here.

**Firecrawl / Loan & Debt reference rate:** switched the one allowlisted
source from a news aggregator (tradingeconomics.com) to RBI's own
homepage, which carries a clean "Current Rates" table
(`Policy Repo Rate: 5.25%`) — confirmed by a live scrape, matching the
aggregator's prior reading exactly. Strengthened the wording everywhere
this rate is shown (backend note, the affordability narration prompt,
the frontend context box) so it reads as background only — never a
validation or guarantee of the household's own quoted rate. Confirmed
the graceful-degradation path: `firecrawl.scrape` throws a `ConvexError`
on an unreachable domain, caught by `getRateContext`'s existing
try/catch, which the affordability calculation never depends on (state
and figures are computed before the rate lookup runs). Confirmed the
24-hour staleness window against the real cached snapshot: a cache hit
at 0h, a forced-null (re-scrape) result at 25h past `fetchedAt`.

**One new AgentMail outbound flow:** a single, user-clicked "Email me a
summary of this" button on the Affordability result. Reuses that
result's own narration verbatim (no new OpenAI call); recipient is
always the signed-in user's own account email, resolved server-side.
Delivery status comes from AgentMail's own `outboundId`, live-queried,
not assumed from the enqueue call. Verified end-to-end in the running
app: clicking it correctly resolves the account email, then fails
cleanly with an actionable message rather than crashing, because no
AgentMail inbox to send *from* is configured yet
(`AGENTMAIL_SENDER_INBOX_ID`) — that inbox can't be discovered
automatically either, for the same permission reason as above.

### 2026-09-12 (later) — Both integrations closed out with real evidence

Resumed the checkpoint after the webhook secret was set and confirmed the
last two open items.

**Inbound, closed:** two real emails (sent from a real Gmail account to
the AgentMail inbox) were found in the component's own durable record —
not a log, actual delivered rows. One, subject "Test expense", said
*"my monthly internet expense is ₹500"*; it produced a real `documents`
row and a linked `extractedFacts` row with `claimedValue: { amountMinorUnits: 500,
category: "expenses", label: "Internet expense" }`, sitting as a pending
fact exactly as designed. A signature check against the live endpoint
now returns a clean `401` on a bad or missing signature (previously it
500'd before verification ever ran, because the secret was unset).

**Outbound, root-caused and fixed:** the "Email me a summary" button's
send kept failing with `AGENTMAIL_API_KEY is not set`, even with the key
correctly set on this deployment. Root cause: `@agentmail/convex@0.1.0`'s
own `convex.config.ts` never declares any environment variables, and
Convex isolates a component's `process.env` from the parent app's unless
the component explicitly declares what it needs (confirmed against
Convex's own docs) — so the key could never reach `performSend` inside
the component, regardless of what's set on our deployment.
`@firecrawl/firecrawl-convex` doesn't have this problem because its own
config *does* declare `FIRECRAWL_API_KEY`, which is exactly why Firecrawl
sends/scrapes always worked.

Fix: declared `AGENTMAIL_API_KEY` in this app's own `convex/convex.config.ts`
and passed it through explicitly to `app.use(agentmail, { env: {...} })` —
same pattern already used for Firecrawl — plus a local patch to the
installed package's `component/convex.config.js` so it actually declares
that variable (0.1.0 is the latest published version; no upstream fix
exists yet, so this patch needs to be reapplied, e.g. via `patch-package`,
after any `node_modules` reinstall).

Verified live after the fix: clicking "Email me a summary of this" on a
real affordability result produced `status: "sent"` with a real Amazon
SES message id (`agentmailMessageId`), `errorMessage: null` — a genuine
outbound send, not a mock.

### 2026-09-12 (later still) — Side-Income & Business Planning (Service #5)

Built the fourth active sidebar service: two paths (job, business) sharing
the household's real Financial Foundation numbers and Loan & Debt's
reserve-check pattern. Seven new tables (`sideIncomeEntries`,
`sideIncomeOpportunities`, `sideIncomeCombinedPlans`, `sideIncomeDeepDives`,
`sideIncomeAskSessions`, `schemeEligibilityChecks`, `humanConsultRequests`),
schema proposed and confirmed before pushing. Reuses `sourceRegistry`/
`sourceSnapshots` from Loan & Debt for every Firecrawl-backed result rather
than a new source-tracking table.

Job path: time-first/income-first reverse calculation (pure math, no AI)
when the hourly rate is known; one Firecrawl web search + one OpenAI
reasoning pass for a clearly-labelled rough range when it isn't. Business
path: startup-capital-vs-reserve conflict check, exact same eligible
-liquid-assets-minus-earmarked pattern as Loan & Debt Affordability.
Combined plans check time and income independently — either, both, or
neither can fire. Deep dives (6 job topics, 5 business topics) are cached
per household + entry + topic + stateRevision + a 24h source-freshness
window, so two households' searches for "Challenges" never share a
result. Scheme eligibility takes gender/state/income-slab for one search
call and discards them — only the matched scheme names and a cautious
"verify this" note get stored. Human consult is interest-only —
`status` is a schema-level fixed literal (`"interest_logged"`), so a
"scheduled" or "completed" state can't even be written.

Verified against the real deployment: job round-trip consistent both
directions (10 hrs/wk @ ₹300/hr → ₹13,000/mo → back to 10 hrs exactly;
₹20,000/mo target → 15.3846 hrs/wk → back to ₹20,000 exactly) — an
initial 2-decimal rounding step was cutting that consistency to within
~₹6/month; fixed by carrying 4-decimal precision through the calculation
and only rounding for display. Business reserve check fired correctly
(₹1,20,000 startup capital against a ₹1,00,000 reserve → conflict, reserve
would go to -₹20,000) and correctly didn't (₹20,000 against the same
reserve → fine, ₹80,000 left). Combined-plan conflict/shortfall proven
independent with four real cases (neither / time-only / income-only /
both) from two real AI-estimated opportunities (₹6,400–₹38,400/mo and
₹10,000–₹20,000/mo). Deep-dive cache genuinely isolated per household —
confirmed directly against the database: two separate rows for the same
"challenges" topic, different households, different entries, different
generated content. Scheme eligibility checked directly against the
database too — the stored row's fields are exactly
`checkedAt, householdId, matchedSchemes, sideIncomeEntryId`, no gender/
state/income-slab anywhere. Mutation validation confirmed both
directions: a job calculation against a business entry, and a business
calculation against a job entry, both rejected with a clear kind
-mismatch error. The consult button reads "Request interest in a
consultation" everywhere it appears, with "This logs your interest only
— it does not book or schedule an expert" underneath; no "book" language
exists anywhere in the feature.

### 2026-09-13 — Side-Income frontend rebuild to match approved mockups

Rebuilt `SideIncomeScreen.tsx` from scratch to match 4 approved mockup
screens exactly: a 4-step main screen (job) / idea form (business), a
combined-plan page with per-opportunity tabs, a single-option "Getting
Started" accordion page, and a deep-dive destination page — all wired to
the existing backend, with local navigation between the four (App.tsx
still only knows "sideIncome" is active, same as every other service's
own internal routing).

Three small, clearly-scoped backend touches were needed to match what
the mockups actually show (all flagged before making them, none touch
`computeJobHoursPerWeekNeeded`, `checkBusinessReserve`,
`buildCombinedPlan`, scheme eligibility, or consult logging):
- `estimateJobIncomeRange` now returns 2-3 distinct grounded opportunities
  from one search instead of one (Screen 1 shows several cards per
  "Find ideas" click) — same AI boundary, same isRoughEstimate flagging.
- `generateDeepDive` prompt asks for 3-5 titled, specific sections
  instead of a short bullet list (the "deeper content" requirement) —
  same sourcing discipline, same Firecrawl call.
- `generateDeepDive`/its cache now accept the `opportunityId` the schema
  already had room for, so two opportunities generated from the same
  entry get genuinely separate deep-dive content instead of collapsing
  onto one shared entry-level cache row (needed for Screen 2's
  per-opportunity tabs).
Two small additive, non-computational queries were added too
(`listOpportunitiesForEntry`, `getOpportunity`) — plain reads of
already-created rows, no new decision logic.

Found and fixed one real bug during verification: a cached deep-dive
response returned the raw stored row (`{..., result: {summary,
sections}}`) while a fresh one returned the flat shape
(`{summary, sections}`) directly — the deep-dive destination page
silently rendered nothing on a cache hit. Fixed by flattening the
cached-row shape to match.

Verified live end to end: Screen 1 generated 3 real, distinct
opportunities from one "Find ideas" click (e.g. Freelance Web Developer
₹6,293–₹7,077/mo, Online Data Entry ₹648–₹851/mo, Part-Time Teaching
Assistant ₹756–₹1,058/mo) with a correctly-firing "may fall short"
warning; selecting 2 and clicking "Get started on both" produced a real
combined banner (12 hrs/wk, ₹6,941–₹7,928/mo, both a time-conflict and a
target-shortfall flag firing correctly); selecting 1 went to the
single-option Getting Started page instead. Two opportunities from the
same entry produced genuinely different "How to start" deep-dive content
(confirmed directly against the database) — web-dev advice referencing
Upwork/WordPress vs. data-entry advice referencing Internshala/Udemy.
Both the "Still stuck" ask box and the "Request interest in a
consultation" box (never "book") now also appear on the deep-dive page
itself, with real generated content, not placeholders.

Flagged, not fixed (out of this task's scope): none of the side-income
actions (`estimateJobIncomeRange`, `checkBusinessReserve`,
`generateDeepDive`, `submitAskSession`, `checkSchemeEligibility`) check
household membership before acting on an entryId — a pre-existing gap
from the original build, not introduced by this rebuild, but worth
closing before this goes further.

### 2026-09-13 (later) — Side-Income: cross-household authorization gap closed

Closed the gap flagged in the previous entry. Audited every exported
Side-Income function: all mutations and queries already checked
`entry.householdId` against the caller's own membership (same pattern as
Financial Foundation's `requireMembership`), but the 5 actions
(`estimateJobIncomeRange`, `checkBusinessReserve`, `generateDeepDive`,
`submitAskSession`, `checkSchemeEligibility`) fetched their entry via an
internal helper with no auth check at all — a signed-in user from one
household could pass any entryId and act on another household's job or
business plan. For `checkBusinessReserve` specifically this meant a
real cross-household leak: household A's own reserve numbers compared
against household B's private startup capital and idea description.

Fix: replaced that helper with `requireOwnedEntryInternal`, an
internalQuery that calls `requireMembership` (from `convex/access.ts`,
the same helper every Financial Foundation and Loan & Debt function
uses) and throws unless the entry belongs to the caller's own household
— invoked via `ctx.runQuery` from each action, the same pattern Loan &
Debt's `gatherPrepaymentData` already established for actions that
don't have direct database access. Also closed a second, narrower path
in `generateDeepDive`: an opportunityId argument wasn't checked against
the (now-verified) entryId, so a caller could own entry A and still pass
a stranger's opportunityId to pull its title into a search.

Verified with the same cross-household test used for every other
service: signed in as household A (`pd76gc…zzf`), attempted to act on
household B's (`pd70qh…8nfr`) job entry, business entry, and opportunity
via all 5 actions plus the opportunity-mismatch case. All 6 rejected
with a clear error (`"Side-income entry not found."` /
`"That opportunity does not belong to this entry."`); a same-household
call against the caller's own entry immediately after was not rejected,
confirming the fix doesn't break legitimate access.
