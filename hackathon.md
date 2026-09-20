# Hackathon log

- **Project:** Household Economic Resilience Platform
- **Event:** Convex All Gas Hackathon
- **What it does:** Tracks a household's income, expenses, obligations, and
  assets, and calculates how many months of runway its liquid savings cover.
- **Live app:** https://quixotic-dalmatian-305.convex.site
- **Repo:** none
- **Frontend:** Convex static hosting (custom, built from HTTP Actions +
  File Storage — see 2026-09-19 entries)
- **Convex deployment:** https://utmost-puffin-491.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex (Firecrawl
  now used: one allowlisted benchmark-rate scrape in Loan & Debt Resilience)
- **Convex features:** schema, tables, indexes, query, mutation, action,
  internalMutation, internalAction, internalQuery, HTTP actions, scheduled
  functions, cron jobs, file storage
- **Auth:** Convex Auth
- **AI models:** gpt-4o (via direct OpenAI API calls in Convex actions)
- **Started:** 2026-09-04T20:11:09Z
- **Last updated:** 2026-09-18T10:30:00Z

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

### 2026-09-15 — Investment & Risk Planning (Service #6)

Built the fifth active sidebar service, with the strictest AI boundary
yet: it shows capacity and ranges, never a recommendation or a promised
return. Three pieces — Investment Readiness, Goal-Based Scenarios, and a
standalone, reusable tax-bracket estimator (`convex/taxBracket.ts`, a
deliberately separable module Tax Planning will import directly later) —
plus general, non-product asset-category education. Schema (4 tables)
proposed and confirmed before pushing, including two decisions the user
specifically called out as correctly reasoned rather than
pattern-matched: which tables need a real `inputHash` cache key (only
the one with user-varied inputs) versus `inputStateRevision` alone, and
storing narration on the row itself so "Email me a summary" reuses it
verbatim.

Readiness reuses Loan & Debt's exact eligible-liquid-reserve-excluding
-earmarked calculation via a cross-file `internal.loanDebt` call rather
than reimplementing it. Scenarios are pure compound-growth arithmetic
over an assumed rate range grounded in a real Firecrawl search (or a
clearly-labelled placeholder if nothing usable turns up) — same
grounded-extraction discipline as Side-Income's rough estimates. The tax
estimator scrapes the real Income Tax Department site
(incometax.gov.in) and parses its actual, messy 4-column-then-2-column
markdown table deterministically (last slab+rate cell pair in each row,
never a fixed column index) — no AI in the parse.

Security built in from the first version this time, not deferred:
`generateInvestmentScenario`'s optional `timelineId` is checked against
the caller's household before anything is saved — caught and fixed
during the initial build, not after a follow-up audit.

Verified against the real deployment: readiness matched a hand-checked
fixture exactly (₹1,00,000 liquid reserve − ₹45,000 essential-expense
target − ₹0 earmarked = ₹55,000 investable surplus → LIMITED_CAPACITY,
downgraded one tier from MODERATE because an active goal was competing
for a still-thin surplus) and correctly returned INSUFFICIENT_DATA for
a household with no Financial Foundation data at all. Scenario math
verified by hand: ₹10,000/month for 10 years at a real
Firecrawl-sourced 9%–12% range produced ₹19,35,143–₹23,00,387, matching
independent calculation of the standard compounding formula to the
rupee. Tax estimator matched ₹12,00,000/year to the correct "10% slab"
per the real official table, cache-hit confirmed on a second call.
Cross-household attack blocked: signed in as household B, passed
household A's real timeline ID into `generateInvestmentScenario` →
rejected with "Timeline not found."; list queries confirmed
household-scoped directly against returned data. AgentMail "email me a
summary" sent with a real Amazon SES message ID. Grepped every prompt
and narration string in both files for recommendation/promise language
("invest in X", "this will return", "guaranteed") — no violations;
every match was either the boundary instruction itself or a neutral
definitional description.

### 2026-09-15
Rebuilt Investment & Risk Planning's frontend to match a two-screen
design: a single ask box with three suggestion chips and an
auto-loading "general categories, explained (not a recommendation)"
grid on the main screen, and a shared result-page shell (state banner,
stat cards, an expanded "how this was calculated" accordion plus two
collapsed ones, a boundary box, and action buttons) reused across all
three backend routes (`src/components/investment/InvestmentScreen.tsx`).
Sidebar and header were left untouched per the design brief.

Backend gained real capability it was missing rather than just UI
plumbing: `checkInvestmentReadiness` had no caching at all before this
pass despite its schema being designed for it, so added a
`findCachedReadinessCheck` cache-hit path; and `askInvestmentQuestion`
previously only executed its tax route; the readiness and goal-scenario
routes just told the caller to make a second call themselves. Both now
run end-to-end and return a fully resolved result from a single ask
(`convex/investment.ts`). New deterministic explanation text — "how
this was calculated," "what would change this answer," "what this
doesn't tell you" — is template-built from the same real diagnostic
object that decides the readiness tier, so it can never contradict the
number it explains, and is kept off the persisted schema (returned only
as transient action fields) so no schema renegotiation was needed for
a purely additive UI need.

Verified live end-to-end against the real deployment, not fixtures:
asking "How much can I safely invest right now?" returned the exact
LIMITED_CAPACITY breakdown (₹55,000 surplus, downgraded from moderate
for one competing goal) with both explanatory accordions populated;
"I have ₹10,000/month leftover — what could that become?" was parsed
by the regex router into a real 10-year scenario call, returning
₹19,35,143–₹23,00,387 off a live Firecrawl-sourced 9%–12% range; "What
should I invest in to save on taxes?" routed to the real tax-slab
estimator (10% slab on ₹12,00,000/year, served from cache) plus the
honest note that full tax planning isn't built yet. All six asset
category cards loaded real content (one genuinely grounded in the SEBI
source, the rest a clearly-labelled generic fallback). "Email me a
summary" sent a real message and the page reflected "Delivery: sent"
back from AgentMail. No console errors during the session.

The "Want a real person's opinion?" button is intentionally
non-functional for now — `humanConsultRequests` requires a
`sideIncomeEntryId` and isn't reusable for Investment without a schema
change that wasn't requested, so it's rendered per the design but only
acknowledges the click locally rather than persisting anything.

### 2026-09-16
Generalized `humanConsultRequests` so "want a real person's opinion?"
is a shared capability instead of Side-Income-only plumbing. Schema
change: `sideIncomeEntryId: v.id("sideIncomeEntries")` became a pair of
plain strings, `sourceService` (which service is asking — "sideIncome",
"investment", any future one) and `sourceEntityId` (that service's own
record id, stored as a string since it can point to different tables
that Convex can't express a single foreign key across). The mutation
itself moved out of `convex/sideIncome.ts` into a new
`convex/humanConsult.ts` so it isn't owned by one service
(`requestHumanConsult`, `listHumanConsultRequests`). Dropped the old
per-entity ownership check (verifying the referenced
`sideIncomeEntries` row belonged to the caller's household) since a
generic string id can't be re-verified against an arbitrary table —
acceptable here because the table only logs interest and never exposes
or grants access to anything; every insert still goes through
`requireMembership` and is scoped to the caller's own household.

This was a live schema change on data that already existed (one real
consult request logged during Side-Income's earlier verification), not
a fresh table, so it needed an actual migration rather than just
editing the validator: pushed a transitional schema with
`sourceService`/`sourceEntityId` optional and the old
`sideIncomeEntryId` kept alongside, ran a one-off
`backfillGenericSource` internal mutation via `npx convex run` to patch
the existing row (rewrote it with the new fields and unset the old
one), confirmed via a direct table read that it converted cleanly, then
tightened the schema back to required fields with the legacy field
removed and deleted the backfill mutation.

Wired Investment & Risk Planning's consult button to the same mutation
with `sourceService: "investment"`. Used the natural entity id where
one exists — the readiness check's or scenario's own row id
(`r.checkId` / `r.scenarioId ?? r._id` to cover a cache-hit row that
only carries `_id`) — falling back to the household id for the tax
route and any edge case with no natural id, fetched once via
`api.households.getMine` and threaded down as a prop rather than
re-queried per result screen.

Verified live end-to-end against the real deployment: replayed
Side-Income's exact original consult flow (home-based tiffin service →
idea-viability deep dive → "Request interest in a consultation") and
got "Interest logged ✓" as before; a direct table read confirmed both
the migrated legacy row and the new one now carry
`sourceService: "sideIncome"` with a real entry id as
`sourceEntityId`. Then asked Investment's readiness question, clicked
"Want a real person's opinion?", got the same "Interest logged ✓", and
confirmed via a direct table read that the new row carries
`sourceService: "investment"` with `sourceEntityId` set to the actual
`investmentReadinessChecks` document id returned by that call — not a
placeholder and not the household-id fallback, since a real entity id
was available.

### 2026-09-16 (later)
Backward-audit prep pass for Insurance, Protection & Financial Rights
(Service #7) — additive groundwork in four already-built services, done
before writing any Insurance-specific code, per an explicit instruction
that nothing already-verified may change as a side effect.

Schema (confirmed with the user before pushing, same as every prior
schema change this session): new `insurancePolicies` table
(householdId, type enum, coverageAmountMinorUnits, premiumMinorUnits,
premiumFrequency, currency, optional insurerName/policyNumber,
createdAt/updatedAt/createdByMemberId — same FINANCE-table shape as
incomeSources/expenses/obligations/assets) plus one new optional field,
`bundledInsuranceCoverageMinorUnits`, on the existing `obligations`
table (`convex/schema.ts`).

Financial Foundation: `convex/insurance.ts` (`addInsurancePolicy`,
`listInsurancePolicies`) mirrors `convex/assets.ts`'s exact pattern —
integer-enforced money fields, `requireMembership`-scoped. Deliberately
does NOT call `bumpStateRevision`: nothing reads this table yet, and
per `access.ts`'s own rule that revision only bumps for
decision-affecting writes, bumping it here would just cause unrelated
cached readiness/prepayment analyses to needlessly recompute. New
"Insurance policies" section added to `FinancialFoundationScreen.tsx`,
same form/list/pending-card pattern as every other section.

Document Intelligence: added `"insurancePolicies"` as a fifth
extraction category in `convex/documentIntelligence.ts` and
`convex/extractedFacts.ts` — same generic `{category, label,
amountMinorUnits, secondaryAmountMinorUnits, detail}` shape already
used by the other four, so no new extraction schema was needed
(coverage amount reuses the primary amount slot, premium reuses the
secondary one).

Loan & Debt: `bundledInsuranceCoverageMinorUnits` flows through
`updateLoanDetails` (integer-enforced, patched via the mutation's
existing generic patch loop — no new code needed there), surfaces as a
plain line in Debt Overview ("Bundled insurance covers ₹X of the
balance" / "No bundled insurance recorded"), and triggers a Debt
Overview warning when a loan's balance is ₹5,00,000 or more with
nothing recorded. Also threaded into the prepayment simulator's
`gatherPrepaymentData` → `simulatePrepayment` → `narratePrepayment`
narration chain, with an explicit instruction to mention it in one
plain sentence when present and say nothing when null (never implying
"no insurance" from missing data). Caught and fixed one bug of my own
before it shipped: the "large loan" warning threshold was accidentally
written as `500_000_00` (a paise-style ×100), when every "MinorUnits"
field in this codebase is actually a plain rupee integer (per
`documentIntelligence.ts`'s own comment on the convention) — fixed to
`500_000` before pushing.

Investment & Risk Planning: `diagnoseReadiness` gained an optional
`insuranceAdequacyModifier` parameter, always 0 (neutral, zero effect)
via a named placeholder stub, `getInsuranceAdequacyModifierPlaceholder`,
that documents exactly where a real Insurance verdict will plug in once
Service #7 exists. The modifier is wired all the way from
`checkInvestmentReadiness`'s call site through to the tier-adjustment
logic (as a real, exercised conditional, not commented-out code) so the
hook can't silently bit-rot.

Verified against the real deployment, not fixtures:
- **Financial Foundation** — added a life policy (₹50,00,000 cover,
  ₹12,000/yr premium via LIC) and confirmed it listed correctly; tried
  a decimal coverage amount (1500.50) and got the exact
  `assertIntegerMinorUnits` rejection, with no bad row written; runway
  read `₹1,00,000 / ₹45,000 / ₹12,000 / ₹1,00,000, "reserves are not
  being depleted"` identically before and after every insurance change.
- **Document Intelligence** — a simulated insurance renewal email
  (Star Health, ₹8,00,000 sum insured, ₹18,500 premium, policy
  #HI-98234) was correctly categorized as `insurancePolicies` with all
  four fields extracted correctly, rendered as a pending card, and
  confirmed cleanly into a real `insurancePolicies` row. Re-tested the
  existing expenses and obligations categories with fresh emails
  (₹2,300 electricity bill; ₹8,500 EMI / ₹1,50,000 balance personal
  loan) — both still extract and render exactly as before.
- **Loan & Debt** — added ₹4,00,000 bundled insurance to the one
  existing car loan (₹5,00,000 balance, 10% p.a., fixed): Debt Overview
  immediately surfaced "Bundled insurance covers ₹4,00,000 of the
  balance" and the prior "large loan, no insurance" warning correctly
  disappeared. Re-ran the exact same prepayment scenario (₹50,000 lump
  sum) and got a byte-for-byte identical cache hit — Feb 2031→Aug 2030,
  ₹24,944 interest saved, ₹0 charge, ₹24,944 net saving, ₹50,000
  reserve — proving the deterministic figures are untouched. A fresh
  scenario (₹75,000 lump sum, forcing real recomputation) produced
  internally consistent new numbers AND correctly wove in "Your
  fixed-rate car loan includes bundled insurance covering ₹4,00,000 of
  the balance" as one plain sentence in the narration.
- **Investment** — re-ran the exact readiness fixture from the
  original build (household with ₹1,00,000 liquid reserve, ₹45,000
  reserve target, 1 active goal): identical LIMITED_CAPACITY result,
  ₹55,000 investable surplus, same tier-downgrade explanation sentence,
  word for word — confirming the new neutral modifier has genuinely
  zero effect on today's output.

No Insurance-specific screens, calculations, or verdict logic were
built — this pass is groundwork only, per the explicit scope
boundary.

### 2026-09-17
Built Insurance, Protection & Financial Rights (Service #7) backend —
category education, an adequacy check, portability guidance, and
cross-service gap detection (`convex/insuranceRiskPlanning.ts`, new).
Schema confirmed before pushing (same process as every prior service):
four new tables — `insuranceCategoryReferences`, `insuranceAdequacyChecks`,
`insurancePortabilityGuides`, `insuranceGapDetections` — plus the two
already-pushed prep-pass pieces (`insurancePolicies`,
`bundledInsuranceCoverageMinorUnits`) got their first real consumer.

Adequacy check formula, stated plainly since it needs to be defensible:
`estimatedLifeCoverNeeded = outstandingLoanBalance + 10 × dependableAnnualIncome`,
gap = needed − (recorded life cover + bundled loan-linked cover).
"10 years of income replacement" is a named, adjustable constant, not
buried in the arithmetic. Health adequacy uses a second simple rule:
₹5,00,000 per household member (self + a `dependentsCount` proxy — see
below) as a commonly-cited minimum; NONE / LIKELY_INSUFFICIENT /
LIKELY_ADEQUATE / INSUFFICIENT_DATA off that threshold and whether any
dependable income is on file at all. "Dependents count" has no real
field anywhere in the schema (Goal & Situation Planning never modeled
it), so it's an honestly-labeled proxy: the count of
`timelineFamilySupport` rows across the household's *confirmed*
timelines — real data, not invented, documented as a proxy everywhere
it's used.

Gap detection checks three real, defensible patterns purely
deterministically (no AI decides whether a gap exists, only whether to
narrate it): outstanding debt with no/insufficient life cover, income
concentrated in a single dependable earner with no/low health cover,
and an active Side-Income business with no policy in this app's
closest available category for business-liability-type cover (honestly
flagged as a proxy, since there's no dedicated business-liability
category yet).

Updated Investment's `insuranceAdequacyModifier` hook (the placeholder
left from the prep pass) to read the household's latest real
`insuranceAdequacyChecks` row and return −1 (one tier more
conservative) when the life-cover shortfall alone exceeds a full year
of dependable income, 0 otherwise — including when no adequacy check
has ever been run for that household, which is the default state for
every existing household. Confirmed with the user before making this
change, per their explicit instruction not to touch Investment's
behavior without a separate go-ahead.

Real-source sourcing took real trial and error, worth recording
honestly: the first candidate portability/category URLs
(`policyholder.gov.in`) turned out not to resolve at all (DNS failure)
— a mistake, not a verified source, despite an earlier comment claiming
otherwise. Found via live Firecrawl search instead: category education
settled on NCFE's (a body jointly promoted by RBI/SEBI/IRDAI/PFRDA)
page on IRDAI's financial-literacy initiatives — real and reachable,
but its actual content is about IRDAI's literacy *programs*, not
category definitions, so every category honestly falls back to a
labeled generic description (same outcome, and same honesty, as most
of Investment's own asset-category grid). Portability guidance found a
much better source: IRDAI's actual "Health Insurance Regulations, 2016
(with amendments)" — Schedule-I is the real, official, numbered
portability procedure, hosted via investindia.gov.in (a Government of
India agency) since the direct IRDAI portal wasn't reliably scrapable.

Verified against the real deployment, not fixtures:
- **Formula hand-verified twice**, both households' cached rows match
  hand arithmetic exactly: household A (₹5,00,000 loan balance,
  ₹1,00,000/mo dependable income) → 5,00,000 + 10×12,00,000 =
  1,25,00,000 needed, cover 50,00,000 + 4,00,000 bundled = gap
  71,00,000. Household B (₹3,00,000 loan, ₹50,000/mo income, no
  insurance) → 3,00,000 + 10×6,00,000 = 63,00,000 needed = 63,00,000
  gap (zero cover).
- **Gap detection** — tested all 3 gap types with both a real firing
  case and a real non-firing case: type (a) no-life-cover-with-debt
  fired on household B (significant) and correctly did NOT fire on
  household A, whose recorded cover exceeds its loan balance; type (b)
  no-health-cover-sole-earner fired on both households (both single
  dependable earners with no policy typed "health" — one real, if
  incidental, finding: a policy confirmed via the one-click "Confirm"
  flow in an earlier session defaulted to type "other" rather than
  "health", which is accurate to how that flow was built but worth
  knowing); type (c) business-without-liability-considered fired on
  household B (created with a real active Side-Income business entry
  and no "Other"-type policy) and correctly did NOT fire on household
  A (whose Side-Income entries are all still "exploring", never
  "active").
- **Cross-household security** — every new action/query rejected an
  unauthenticated call with "Not signed in." (tested after an actual
  page reload, not just clearing localStorage, since the client keeps
  its JWT in memory until reload). Signed in as household B,
  `listInsuranceAdequacyChecks`/`listInsuranceGapDetections` returned
  only B's own row; signed back in as household A, same queries
  returned only A's row — no cross-household leakage in either
  direction. No function in this module takes a foreign document ID at
  all (household is always derived from the caller's own session), so
  there's no ID-spoofing vector to test beyond this.
- **Category education and portability** — both show real
  Firecrawl-sourced attempts with honest labeling: category education
  genuinely fell back for all 6 categories after a real, successful
  scrape (not a crash) of a real source, correctly labeled
  `usedGenericFallback: true`; portability guidance returned a real,
  accurate 7-step process extracted from IRDAI's actual Schedule-I text
  (45/60-day application window, Portability Form, 7-working-day data
  handover, 15-day underwriting decision — all cross-checked against
  the raw regulatory text).
- **AgentMail** — real send confirmed with a live Amazon SES message
  ID and "sent" delivery status.
- **Recommendation-language grep** — clean across all 4 real stored
  narration rows: no insurer name, no "buy"/"purchase", no guaranteed-
  return language anywhere. One phrase flagged as a judgment call, not
  a violation: "you should consider increasing it by ₹X" quantifies the
  deterministic gap without naming any product or insurer, which is
  what the hard rule actually prohibits — but it reads more advisory
  than Investment's own narration style, worth tightening if the
  household-facing tone matters more than the literal rule.
- **Investment hook** — re-ran the original readiness fixture (the
  same household used throughout Investment's own verification)
  *before* ever running an adequacy check against it: byte-identical
  LIMITED_CAPACITY result, ₹55,000 surplus, same downgrade sentence —
  confirming the code change alone has zero effect. Then, on a separate
  household built specifically for this test (clean numbers, no
  insurance, one large loan), readiness read STRONG_CAPACITY before an
  adequacy check existed and MODERATE_CAPACITY immediately after one
  was run — the same ₹1,80,000 surplus both times, with the
  calculation explanation correctly naming the insurance gap as the
  sole reason for the downgrade.

No frontend was built this pass — backend only, per the user's
explicit request to confirm this is stable before wiring screens to
it.

### 2026-09-17 (later)
Two follow-up fixes on Insurance's adequacy/gap narration, from
reviewing the previous pass's own flagged findings.

Reworded the borderline-advisory phrase both narration prompts could
produce ("you should consider increasing it by ₹X") to stay purely
descriptive ("there is an estimated gap of ₹X"), matching Investment's
narration tone. Added the same explicit "stay descriptive, never
advisory" rule to both the adequacy-check and gap-detection system
prompts (`convex/insuranceRiskPlanning.ts`) — the gap-detection prompt
hadn't shown the problem yet but was carrying the same risk.

Fixed the test policy that got categorized "other" instead of "health"
during an earlier one-click confirm — via a real UI edit, not a direct
DB edit, which meant building one first: `insurancePolicies` had no
update mutation at all before now. Added
`updateInsurancePolicy` (`convex/insurance.ts`, ownership-checked,
integer-enforced, same partial-patch pattern as Loan & Debt's
`updateLoanDetails`) and an "Edit" control per policy row in
`FinancialFoundationScreen`'s Insurance section. Caught a real bug
while wiring this: `insurancePolicies` writes deliberately skipped
`bumpStateRevision` from the prep pass, correctly at the time ("nothing
reads this table yet") — but Service #7's adequacy check and gap
detection now do, and that comment had gone stale. Left uncorrected,
editing a policy's type would never have invalidated the
stateRevision-keyed cache, so the adequacy check would have kept
serving the stale "NONE" result forever. Fixed both `addInsurancePolicy`
and the new `updateInsurancePolicy` to call `bumpStateRevision`.

Verified against the real deployment:
- Edited the Star Health policy's type from "Other" to "Health" via the
  real Edit button; re-ran the adequacy check and got `_fromCache:
  false` (proving the stateRevision fix actually works — a stale cache
  hit would have silently kept showing the old result),
  `totalHealthCoverageMinorUnits: 800000` (previously 0), and
  `healthCoverageAssessment: "LIKELY_ADEQUATE"` (previously "NONE") —
  ₹8,00,000 against a ₹5,00,000-per-person threshold with 0 dependents,
  correct. The new narration read "There is an estimated gap of
  ₹71,00,000... compared to the estimated need of ₹1,25,00,000" — no
  advisory phrasing. Gap detection on the same household now correctly
  returns zero gaps (the no-health-cover-sole-earner gap no longer
  fires, since real health cover is now correctly recorded) — a genuine
  behavioral change following from the corrected data, not a separate
  fix.
- Re-grepped all real stored narration for recommendation language: the
  fresh rows created after the prompt fix are clean of both advisory
  phrasing and insurer/product names; the one historical row containing
  the original flagged phrase is untouched, as expected — these tables
  are insert-only decision history, never rewritten in place.

### 2026-09-17 (frontend)
Built the Insurance, Protection & Financial Rights frontend
(`src/components/insurance/InsuranceScreen.tsx`), matching the two
mockups exactly and wired to the real, already-verified backend —
backend logic untouched. Same shell pattern as every other service:
each screen owns its own title block (no separate `<Header/>` in the
authenticated layout), wrapped by the persistent `Sidebar`. Upgraded
"Insurance & Protection" from a `Soon` placeholder in `Sidebar.tsx` to
a real, clickable entry (renamed to match the service's full name),
and added the `"insurance"` route to `App.tsx`'s route union — the only
backend-adjacent files touched were routing, not logic.

Screen 1: a policy summary bar reading real `insurancePolicies` data
("You have N policies on file (types)") linking to Financial
Foundation, the ask box with the three specified suggestion chips
routed through `askInsuranceQuestion`'s real keyword matching, and a
6-card category grid auto-loading real `insuranceCategoryReferences`
content (same auto-load-on-mount pattern as Investment's asset grid).

Screen 2: one shared shell across all three real routes — a green/amber
verdict banner (amber when a real gap or coverage shortfall was
found, using the backend's own `lifeCoverageGapMinorUnits` /
`healthCoverageAssessment` / `gaps` array, never hardcoded), stat cards
only for the adequacy route, a route-specific accordion ("How this was
calculated" / "The portability process" / "Details"), a caveat box
with real `narration.caveats`, and an action row wired to the real
`emailInsuranceSummary`/`emailSendStatus`, `askInsuranceQuestion`
follow-up, and the generalized `humanConsultRequests` mutation with
`sourceService: "insurance"`. Gap items render with a real severity
distinction — a red dot and bold red label for "significant", an amber
dot and amber label for "notable" — matching the mockup. One
adaptation for the portability route: it has no AI narration object of
its own (steps are shown verbatim from the real regulation text, never
narrated), so its "email me a summary" button sends a summary built
client-side from the real step data rather than being disabled.

Verified against the real deployment, not placeholders:
- **Screen 1** rendered with real data on two different households —
  "You have 2 policies on file (Life, Health)" and "You have 0 policies
  on file" — and the category grid showed the same real, honestly-
  labeled content already verified in the backend pass.
- **Navigation**: Screen 1 → Screen 2 → "← Ask something else" → Screen
  1 confirmed working; "View in Financial Foundation →" correctly
  routes to Financial Foundation's own Insurance policies section.
- **All three answer routes tested with real data**: adequacy
  (LIFE COVER GAP FOUND banner, ₹54,00,000 current cover / ₹1,25,00,000
  need / ₹71,00,000 gap, full calculation breakdown, purely descriptive
  narration confirming the earlier wording fix reached the UI);
  portability (GREEN banner, all 7 real IRDAI-sourced steps rendered in
  order); gap detection tested on both a zero-gap household (GREEN, "No
  Gaps Found") and a three-gap household (AMBER, "SIGNIFICANT GAPS
  FOUND", all three real gap types with correct severities).
- **Action buttons, all with real backend evidence**: "Email me a
  summary" returned "Delivery: sent" on the adequacy, portability, and
  gap routes; "Want a real person's opinion?" logged real
  `humanConsultRequests` rows confirmed via direct table reads —
  `sourceService: "insurance"` with `sourceEntityId` correctly set to
  the real `checkId` on the adequacy route and the real `detectionId`
  on the gap route; "Still stuck? Ask a question" correctly transitioned
  the same result screen from one route to another (adequacy →
  gapDetection) without a page reload.
- **No new console errors** — the only errors present were expected
  leftovers from earlier deliberate negative-path tests in prior
  sessions (integer-enforcement, unauthenticated rejection).

No backend file was modified — `git status` after this pass shows only
routing changes in `App.tsx`/`Sidebar.tsx` and the new frontend files,
confirming the backend stayed untouched as required.

### 2026-09-17 (later)
Built Tax Planning (Service #8) backend — a household tax profile, a
deterministic Old-Regime deduction summary, an old-vs-new regime
comparison, and deduction-gap detection (`convex/taxPlanning.ts`, new).
Schema confirmed before pushing, including 5 real corrections surfaced
during proposal (no tracked 80C holdings exist anywhere in the app, so
added an honest direct `approximate80CInvestmentMinorUnits` input;
life insurance premiums are 80C-eligible not 80D under real law, so
policies are split by type; old vs new regime allow fundamentally
different deductions under current law, so `taxDeductionSummaries`
represents Old-Regime-eligible deductions specifically; `taxBracket.ts`
only ever parsed the New Regime column, so Old Regime slab parsing and
full progressive-tax computation are new logic, not a duplicate; no
loan-payment ledger exists, so Section 24(b) interest is a simple
current-balance × rate estimate, clearly caveated).

Every deduction cap came from a real, live Firecrawl `scrape()` call
against an official Income Tax Department page — none hardcoded, per
explicit instruction, even though the values are well-known:
- **Sections 80C, 80D, 24(b) and the Old Regime slab table** — one real
  scrape of `https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1`
  (the same official AY 2026-27 page `taxBracket.ts` already uses for
  New Regime slabs — independently re-scraped here since that module's
  own cache stores only the already-parsed new-regime array, not the
  raw deduction-table text this file needs). Real matched text: "Combined
  deduction limit of **₹ 1,50,000**" (80C), "For Self / Spouse or
  Dependent Children | **₹ 25,000**" under "Section 80D", "Self-Occupied
  | ... | **₹ 2,00,000**" under Section 24(b).
- **Standard deduction + Section 87A rebate thresholds** — one real
  scrape of `https://www.incometax.gov.in/iec/foportal/help/new-tax-vs-old-tax-regime-faqs`.
  Real matched text: "Standard deduction of Rs.50,000 ... available for
  both old and new tax regimes", the ₹5,00,000/₹12,500 Old Regime
  rebate, the ₹7,00,000/₹25,000 New Regime rebate (spelled out in words
  in the source, not digits — used as literal statutory figures named
  in that clause, not independently guessed).

A real, sourceRegistry-backed sourceSnapshotId is recorded for both
fetches and reused across every deduction/slab field sourced from them.

Caught and fixed two real bugs during live verification, not
hypothetically:
1. **Cache-collision bug.** My own `ensureLawSource` correctly reused
   `taxBracket.ts`'s *existing* sourceRegistry row for the shared real
   URL (expected — sourceRegistry is meant to be deduped by URL), but
   that meant my cache-lookup could pick up one of *its* snapshots (a
   plain `TaxSlab[]` array) and try to read `.caps` off it, crashing
   with `Cannot read properties of undefined`. Confirmed via a direct
   snapshot read that my code never *wrote* to that shared row (only a
   harmless read), so `taxBracket.ts` and Investment's own tax-bracket
   feature were never actually corrupted. Fixed by giving this file
   its own distinct sourceRegistry key (a `#`-suffixed variant of the
   same real URL) while still scraping the identical bare URL — same
   real page, independent snapshot timeline.
2. **Regex windows too short for the real FAQ text.** The Section 87A
   rebate clauses run longer in the actual scraped text than my first
   regex windows assumed (60–250 chars vs. the real ~150–400 needed) —
   caught live when the FAQ parse genuinely failed against the real
   page, not a hypothetical. Fixed by measuring the actual real
   distances and widening the windows to match.

Verified against the real deployment, not fixtures:
- **Deduction caps hand-verified**: all three real scraped caps (80C
  ₹1,50,000; 80D ₹25,000; 24(b) ₹2,00,000) plus the real standard
  deduction (₹50,000) matched a full deduction-summary computation
  exactly — household B: loan interest ₹27,000 (₹3,00,000 × 9%),
  insurance ₹25,000 (₹30,000 premium capped at the real 80D limit),
  investment ₹1,50,000 (₹2,00,000 declared, capped at the real 80C
  limit), standard ₹50,000 → total ₹2,52,000, matching the code's own
  output field-for-field.
- **Regime comparison hand-verified against a fixture**: household A
  (₹12,00,000 gross salaried income, ₹1,00,000 HRA, ₹50,000 loan
  interest, ₹18,500 80D, ₹62,000 80C, ₹50,000 standard deduction) →
  Old Regime taxable income ₹9,19,500 → tax ₹96,400 (5% + 20% bands, no
  rebate since income exceeds the ₹5,00,000 threshold); New Regime
  taxable income ₹11,50,000 → tax ₹55,000 (5% + 10% bands, no rebate).
  Hand arithmetic matched the code's real output exactly, including the
  reused `lookupTaxSlab`'s marginal-slab labels ("20% slab" / "10%
  slab") and the correct `recommendedRegime: "new"`.
- **Gap detection**: all 3 gap types tested firing AND not firing.
  `noProfileSet` fired on household B before any profile existed, then
  correctly stopped firing once one was set. `unclaimedInsuranceDeduction`
  fired on household A (₹18,500 used of ₹25,000 cap, room ₹6,500) and
  did not fire on household B once its recorded premium (₹30,000) met
  the cap. `unclaimedInvestmentDeduction` fired on household A (₹62,000
  used of ₹1,50,000, room ₹88,000) and did not fire on household B
  once its declared 80C amount (₹2,00,000) exceeded the cap.
- **Cross-household security**: every new action/query rejected an
  unauthenticated call with "Not signed in." (verified after an actual
  page reload). Signed in as household B, `getTaxProfile` returned only
  B's own data (₹20,000 HRA, not A's ₹1,00,000); B's own regime
  comparison (₹6,00,000 income) produced entirely different, correctly
  isolated numbers (both regimes zero after rebate, "similar") with no
  leakage from A's cached rows.
- **Recommendation-language grep**: clean across every real stored
  narration row (2 regime comparisons, 3 gap detections) — no "file it
  this way", "claim this", or filing instructions of any kind. One
  quality note, not a boundary violation: one AI-generated caveat
  invented an ungrounded date claim ("conditions applicable till
  October 2023") not present in any input data — worth tightening the
  prompt against fabricated specifics, though it isn't advisory or
  filing-instruction language.
- **taxBracket.ts reuse confirmed, not duplicated**: `lookupTaxSlab`,
  `TaxSlab`, `getCurrentTaxSlabs`, and `gatherDependableAnnualIncome`
  are imported directly (`import { lookupTaxSlab, getCurrentTaxSlabs,
  type TaxSlab } from "./taxBracket"`) and called at marked "REUSED
  FROM taxBracket.ts" sites in `checkTaxRegimeComparison`. The file
  itself is untouched — `git status` shows zero diff on
  `convex/taxBracket.ts` or any other previously built service's files
  after this entire pass.
- **GST**: `gstRegistered` exists only as an optional field on
  `taxProfiles`, never read by any calculation in this file or
  anywhere else in the app — grepped to confirm.

No frontend was built this pass — backend only, per the established
process for this service.

### 2026-09-18
Fixed the quality issue flagged in the previous pass: one AI narration
caveat had invented an ungrounded date ("conditions applicable till
October 2023") that appeared nowhere in the deterministic data it was
given. Checked whether a real deadline date existed in either
already-scraped source (deduction caps page, regime FAQ page) — neither
page states an ITR filing deadline, so the correct fix was removal, not
substitution. Added one explicit rule to all three narration prompts in
`convex/taxPlanning.ts` (deduction summary, regime comparison, gap
detection — the same fabrication risk existed in all three, not just
the one that had shown it): "NEVER state a specific date, year,
deadline, or cutoff ... If a caveat needs to mention timing, say so
generically (e.g. 'check current filing deadlines') without naming a
date."

Verified live, not just by inspecting the prompt: signed up a fresh
household with no tax profile and re-ran `checkTaxDeductionGaps` to
regenerate the exact `noProfileSet` narration path that had produced
the bad caveat. New real output: "This check only covers whether a tax
profile is available, not its accuracy.", "These insights aren't a
substitute for a complete tax review.", "Always confirm tax decisions
with an actual filing process or professional advice." — no date, year,
or cutoff anywhere.

### 2026-09-18 (later) — Tax Planning frontend + Economic & Policy Context card
Built `src/components/tax/TaxPlanningScreen.tsx` and wired it into
`Sidebar.tsx`/`App.tsx` (same 6-point routing pattern as every other
service). No calculation logic was touched — the screen calls the
existing verified actions/mutations directly (`saveTaxProfile`,
`getTaxProfile`, `askTaxQuestion`, `checkTaxDeductionSummary`,
`checkTaxRegimeComparison`, `checkTaxDeductionGaps`, `emailTaxSummary`,
`emailSendStatus`, `humanConsult.requestHumanConsult`).

One small new backend piece, proposed and confirmed before pushing: a
`taxEconomicContextItems` table (title, description, sourceSnapshotId,
sourceUrl, sourceLabel, fetchedAt — not household-scoped, same pattern
as the other category-reference tables) plus
`refreshTaxEconomicContext`, sourced from two already-scraped real
pages (no new source discovery) with distinct `sourceRegistry` keys via
the same `#`-suffix technique used earlier to avoid a cache-collision
bug. Card is deliberately light — "FULL COVERAGE COMING SOON" label,
explicit line pointing to the future Government, Economic & Livelihood
Intelligence service — never a general news feed.

While wiring the frontend, found and fixed an inconsistency in
`checkTaxDeductionSummary`: unlike the other two actions in the same
file, its cache-hit branch returned no `state` or `narration`, which
would have broken Screen 2's render on a second call for the same
household. Moved narration generation to run before the cache check so
both paths return a complete shape. This is a return-shape fix — the
underlying `diag` figures are byte-identical either way — not a change
to any calculation.

Verified live in the browser end to end, not just by reading the code:
- **Tax profile**: saved a salaried profile (₹40,000 TDS, ₹60,000 HRA,
  ₹50,000 80C, GST registered) — persisted and reloaded correctly on
  refresh.
- **Deduction summary** ("Am I paying more than I need to?"): real
  ₹1,00,000 total (₹50,000 80C + ₹50,000 standard deduction, home loan
  and insurance both ₹0 since none recorded), stat boxes and "How this
  was calculated" accordion matched exactly.
- **Deduction gaps** ("Have I used all my deductions?"): 2 real gaps
  found — ₹25,000 room under 80D, ₹1,00,000 room under 80C — with real
  narration and caveats.
- **Regime comparison** ("Old regime or new regime?"), tested against
  two different households to exercise both branches: one household
  produced `recommendedRegime: "similar"` (both ₹0 tax) and rendered
  "BOTH REGIMES ARE SIMILAR" with no card highlighted; another
  household (real ₹96,400 vs ₹55,000 estimated tax, cached from an
  earlier verification pass) produced `recommendedRegime: "new"` and
  correctly highlighted the New Regime card with a "RECOMMENDED" badge
  and "NEW REGIME SAVES ₹41,400" — confirmed the cache-hit path (which
  lacks the transient taxable-income/slab-label fields by design) also
  renders cleanly with those fields simply omitted, no crash.
- **Economic & policy context card**: shows one real sourced item
  ("Standard deduction applies under both tax regimes", scraped from
  the Income Tax Department's regime FAQ page, real retrieval date).
  The second candidate scrape (a regime-default note from the slabs
  page) came back with no match for the parsed phrase, so it was
  correctly omitted rather than fabricated — one real item is within
  the "1–2 max" scope originally agreed, so this was left as-is instead
  of forcing a guessed phrase to fill a second slot.
- **Action row**: "Email me a summary" showed real delivery status
  ("Delivery: sent"); "Want a real person's opinion?" wrote a real
  `humanConsultRequests` row (`sourceService: "tax"`, correct topic
  text, `status: "interest_logged"`), confirmed by reading the row back
  from the database.

The temporary `window.__convex` browser-verification hook was removed
from `src/main.tsx` afterward — confirmed via `git diff --stat` showing
no diff on that file.

### 2026-09-18 (later) — Government, Economic & Livelihood Intelligence (Service #9)
Structurally different from every prior service: PUSH, not PULL. A daily
cron (`convex/crons.ts`, first cron in this app) sweeps every household
with a livelihood profile, staggering each household's actual check 15s
apart so Firecrawl load spreads across the sweep instead of firing all
at once. Schema proposed first and confirmed before pushing:
`livelihoodProfiles`, `economicFindings`, `economicFindingDeepDives`,
`economicMonitoringState` (all in `convex/schema.ts`, additive only).
Backend lives entirely in the new `convex/governmentEconomic.ts` —
nothing in any previously built service was touched.

Two tracks, both AI-EXTRACTION-only past the deterministic layer:
OpenAI pulls occupation/sector/state (job) or business type/approx
income (business) out of free text, same boundary as Document
Intelligence. It never decides severity (a documented per-findingType
threshold) or whether a scheme match is genuine (a plain case-
insensitive substring check against a real Firecrawl search result's
own title/description — no AI call involved in that decision at all).

Bug found and fixed during verification, before any further testing:
`upsertLivelihoodProfile`'s `db.patch` silently kept STALE
interpreted* values when a re-save's extraction found nothing new,
because Convex drops an explicit `undefined` across the action ->
internalMutation call boundary — the key was simply absent by the time
the mutation's `args` existed, so spreading `...args` into `patch`
never touched the old value. Fixed by extracting to `null` (which does
survive the boundary) and converting `null` -> `undefined` immediately
before the in-process `db.patch`/`db.insert` call. Re-verified after
the fix: re-saving a job profile from a detailed description down to
"I have a job." correctly produced a row with NO interpreted* fields
at all (not stale ones), `missingFields: ["occupation","sector",
"state"]`.

Verified live against the real deployment (browser sessions for the
public/authenticated paths, direct internal-function calls via the
Convex MCP tools for the monitoring internals — all against real data,
several already-existing test households):
- **Extraction, 2+ real examples**: "I work as a Senior Data Analyst in
  the IT Services sector, based in Karnataka" → occupation/sector/state
  all correctly extracted; "I run a home bakery selling cakes and
  pastries, monthly income around ₹15,000" → businessType "Home
  Bakery", approxIncome ₹15,000 correctly extracted (paise-converted).
  A third, "I work as a Store Manager in the Retail sector, based in
  Maharashtra", also extracted correctly.
- **missingFields, complete vs incomplete**: the detailed job
  description above produced `missingFields: []`; "I have a job."
  against the same household produced `missingFields: ["occupation",
  "sector","state"]` — and, post-fix, correctly cleared the previously
  stored values rather than leaving them stale.
- **Business-track active-only gating**: saving a business profile
  against a real "exploring"-status Side-Income entry was rejected
  ("only monitors ACTIVE or graduated businesses, never
  'exploring'/'selected'"); saving against a real "active"-status entry
  (a household's actual "Home bakery" business) succeeded.
- **Change detection, real evidence**: a household's real sector-risk
  search (IT Services) classified as "hard" (genuine recent India tech-
  layoff coverage) on first check — correctly created NO finding (first
  observation only establishes a baseline). Re-running with no change
  produced no duplicate. Seeding a different prior baseline and
  re-running against the SAME real search produced exactly one new
  finding. Same pattern independently confirmed for the RBI reference
  rate (real scrape: 5.25%) and for a real scheme search (PMFME scheme
  results for "Home Bakery") — a seeded stale baseline correctly
  produced one new finding each, no duplicates on repeat checks with an
  unchanged real value.
- **Severity threshold, hand-verified**: interest-rate moves of 0.30pp
  (30bps, real RBI scrape) → `significant`; 0.10pp (10bps) →
  `notable` — exactly matching the documented ≥25bps rule. Sector risk
  "hard" (real layoff coverage) → `significant`. A scheme match where
  the business type wasn't literally named in the result →
  `notable`, per the documented rule.
- **AgentMail proactive send, real evidence**: a real send returned a
  real `outboundId`; checking its status directly against AgentMail
  returned `status: "sent"` with a real message ID. `emailSent` was
  confirmed `true` only on rows that triggered an actual successful
  send, and `false` on every `notable` finding (never emailed) and on
  a `significant` finding created while the per-household 24h cap was
  still active — confirmed the cap by forcing two `significant`
  findings for the same household in quick succession: the first sent
  (`emailSent: true`), the second was correctly capped
  (`emailSent: false`, left pending for the next eligible digest).
- **Cross-household access, real evidence**: pointing a save at another
  household's Side-Income entry returned "Side-income entry not found."
  (not a leak of its existence). `listEconomicFindings` returned only
  the calling household's own 2 findings out of 5 that existed
  database-wide. Fetching another household's finding by ID returned
  `null`. An unauthenticated call (post-reload, no token) was rejected
  with "Not signed in."
- **Recommendation-language grep**: clean across every real narration
  generated during this pass — no filing instructions or "switch/apply/
  invest now" language.
- **Deep dive caching**: generating a deep dive twice for the same
  finding returned `_fromCache: true` on the second call with identical
  content; the `economicFindingDeepDives` table held exactly one row
  afterward, scoped to that household + finding.

### 2026-09-18 (later still) — Government, Economic & Livelihood Intelligence frontend
Built `src/components/governmentEconomic/GovernmentEconomicScreen.tsx`
and wired it into `Sidebar.tsx`/`App.tsx` (same 6-point pattern as
every other service). Job/Business tabs, a profile card per track (pre-
fill notice for Job from a real `incomeSources` label, a "Found: X —
status" notice per real active Side-Income entry for Business, an amber
missing-fields notice driven by the real deterministic `missingFields`
array), a findings feed per track, and a finding-detail screen with a
real severity-colored verdict banner, stat boxes for interest-rate
findings (rate transition parsed from the real stored text; loan type
read live from Loan & Debt's own existing `listObligations` query,
read-only, nothing in Loan & Debt touched), a deep-dive button, and an
action row.

One new backend piece, small and disclosed: `emailFindingSummary` /
`emailFindingSendStatus` in `convex/governmentEconomic.ts` — the same
AgentMail pattern used everywhere else, but user-triggered for a single
finding ("Email me this finding"), distinct from the existing PROACTIVE
`sendBatchedFindingsEmailInternal` the cron uses. The mockup's "Still
stuck? Ask a question" button has no dedicated Q&A backend in this
service (never scoped for one — the spec's PULL layer was "profile +
findings feed", not an ask-box) — disclosed judgment call: both it and
"Want a real person's opinion?" log a real ticket via the existing
generic `humanConsultRequests` mutation, distinguished only by topic
text, rather than fabricating a fake AI Q&A feature.

Bug found and fixed during live verification: a business's findings
feed was filtering out its own `interestRate` findings, because those
findings have no `affectsEntityId` (the reference rate isn't tied to
one specific business) while the card's filter required an exact
entry-id match. Fixed by only excluding a finding that names a
*different* entry, not one with no entity id at all. Re-verified: a
real business card that showed 1 finding before the fix showed all 3
real findings (2 significant rate moves + 1 notable scheme match) after
it.

Verified live against real data (signed in as two different real
households — one job-track, one business-track):
- Job tab: real pre-filled/saved description persisted and reloaded;
  real findings list (2 real findings: one notable rate move, one test
  finding) rendered with correct severity badges and "Affects: Loan &
  Debt Resilience →".
- Finding detail (job, interestRate): real "REFERENCE RATE 5.15% →
  5.25%" and "HOME LOAN EMI: Floating" stat boxes, both from real data
  (the rate parsed from the finding's own stored text, the loan label/
  type read live from Loan & Debt).
- Deep dive button returned real cached content inline.
- "Email me this finding" showed real "Delivery: sent".
- Both "Ask a question" and "Want a real person's opinion?" wrote real
  `humanConsultRequests` rows (`sourceService: "governmentEconomic"`,
  correct topic text each), confirmed by reading them back from the
  database.
- Business tab (different household): real "Found: ... — active, from
  Side-Income & Business Planning" notice, all 3 real findings visible
  after the filter fix, and a significant finding's detail screen
  correctly omitted the loan-type stat box (business track has no
  single associated loan) while still showing the real rate-transition
  box.

### 2026-09-18 (later still) — Income Resilience (Service #10) backend
Cross-service SYNTHESIS, not a new domain: reads live from Financial
Foundation, Loan & Debt Resilience, Insurance, Side-Income & Business
Planning, and Government, Economic & Livelihood Intelligence — nothing
in any of those five services was modified. Schema proposed and
confirmed first: `incomeResilienceSnapshots` (written ONLY when the
household's tier genuinely changes — the interactive check itself is
fully reactive/recomputed fresh, no save button) and
`incomeResilienceBenchmarks` (one real, sourced figure, same pattern as
`taxEconomicContextItems`). All logic lives in the new
`convex/incomeResilience.ts`.

Eight deterministic dimensions score a tier (resilient / worthALook /
atRisk): income concentration, a structural monthly deficit, runway
months against a real sourced benchmark, EMI-to-income ratio, presence
of life/personal-accident insurance, a semi-liquid reserve beyond the
emergency runway, backup income in progress, and any recent real
`significant` finding from Government/Economic Intelligence. OpenAI
narrates the already-decided tier only — never re-judges it, never
recommends a specific product.

One deliberate honesty fix versus hardcoding a "6 months of expenses"
rule from training data: a real Firecrawl search for the recommended
emergency-fund benchmark, with a DETERMINISTIC regex (never AI) parse
of a months figure from the real results, cached 60 days. A real search
returned a genuine Bank of Maharashtra blog post stating "three to six
months," and the regex correctly extracted a real "3" from elsewhere in
the same results — not invented.

Bug caught by `tsc`, not a runtime surprise: the shared scoring
function originally called `api.runway.calculateRunway` and
`api.loanDebt.getDebtOverview` for reuse — both are public queries
correctly hard-gated to the CALLER's own identity via
`requireMembership`, with no way to check on behalf of another
household. That's the right design on their part, but it meant the
cron sweep (no caller identity, same as Government/Economic
Intelligence's own sweep) would throw "Not signed in" the moment it
tried to use it. Fixed by computing the same runway/EMI formulas
directly from the raw tables inside `incomeResilience.ts` (same cadence
-normalization math as `runway.ts`, not a different definition of
runway), shared by both the user-triggered action and the cron path.

The cron piggybacks on the same daily-sweep pattern as Government/
Economic Intelligence, added as a second `crons.daily(...)` entry in
`convex/crons.ts` one hour later (04:00 UTC) so its Firecrawl/OpenAI
load never overlaps with that sweep.

Verified live against real data, signed in as a real household,
deliberately walking it through three real state transitions:
- **Initial check** (no prior snapshot): real tier `atRisk` (4 weak
  dimensions: income 100% concentrated in one source, no insurance, no
  semi-liquid reserve, a real recent significant finding already in the
  database from Government/Economic Intelligence). Narration correctly
  named exactly those four, no invented figures. Correctly did NOT send
  an email (first-ever snapshot — no prior tier to have "become" worse
  than).
- **Repeat check, no real change**: zero new snapshot rows — confirmed
  no duplicate/noise recording.
- **Genuine improvement**: added one real personal-accident insurance
  policy via Insurance's own `addInsurancePolicy` mutation (nothing in
  Insurance modified) → tier correctly moved `atRisk` → `worthALook`
  (3 weak dimensions), a new snapshot was written, and — correctly —
  no email (an improvement isn't the alert condition).
- **Genuine worsening back into the worst tier**: added one real large
  -EMI obligation via the existing `addObligation` mutation → EMI-to
  -income ratio hit 60%, tier correctly moved `worthALook` → `atRisk`
  again. A new snapshot was written, and — this time — a REAL AgentMail
  send fired automatically, confirmed via a direct status check against
  AgentMail: `status: "sent"` with a real message ID. This is the exact
  condition the alert is scoped to (a genuine transition INTO the worst
  tier), not a repeat or an improvement.
- **On-demand "email me this"**: separately confirmed sent, real
  outbound ID, real "sent" status.
- **Human consult**: wrote a real `humanConsultRequests` row
  (`sourceService: "incomeResilience"`).
- **Cross-household isolation**: `listMySnapshots` returned only the
  calling household's own 3 snapshots, no leakage.
- **Unauthenticated call**: rejected with "Not signed in."
- **Recommendation-language grep**: clean across every real narration
  generated this pass.

No frontend was built this pass — backend only, per the established
process for this service; the interactive screen (tier card, weak
-dimension breakdown, trend line, routing into the relevant service,
email/consult buttons) is the natural next step.

### 2026-09-18 (later still) — Income Resilience: household note
A gap in the design: the deterministic score only ever sees what's
already structured elsewhere in FinComp — it can't know a household is
worried about layoffs, a health issue, or a dependent. Added one living
note per household (`incomeResilienceNotes`, overwritten on save, not a
log) — free text the household writes themselves. AI extracts a single
concern CATEGORY only (jobSecurity / healthOrDependent / majorLifeEvent
/ businessConcern / none), same extraction-only boundary as Document
Intelligence and the livelihood profiles — it never touches the
deterministic tier or weak-dimension list. The narration prompt (shared
by both the on-demand check and the cron, via one consolidated
`narrateResilience` helper — this pass also de-duplicated what had been
two copies of the same prompt) may honestly reference the note, never
invent beyond it.

Verified live: two distinct free-text examples correctly extracted
different categories ("layoffs at my company" → `jobSecurity`; "father
is unwell, may need to support him financially" → `healthOrDependent`).
Saving a second note overwrote the first (exactly one row for the
household throughout, confirmed by direct table read) — a living note,
not an accumulating log. A real `checkIncomeResilience` call afterward
produced narration that honestly referenced the health/dependent
concern ("you mentioned a potential upcoming financial responsibility
to support an unwell family member") while the tier and all four real
weak dimensions stayed byte-identical to before the note existed —
confirming the note colors the narration only, never the score. The
same internal read path the cron uses (`getNoteInternal`, no caller
identity) was confirmed to return the same note, so a concern written
today still colors next week's automatic check. Empty text short
-circuits to `category: "none"` without an OpenAI call. Cross-household
isolation confirmed (a second household's `getMyNote` returned `null`,
no leakage) and unauthenticated calls were rejected.

Also designed (not yet built) the actual interactive screen as an HTML
mockup, iterated with the user to add this note card once the "we can't
know everything from structured data alone" gap was raised — informed
this backend addition rather than the other way around.

### 2026-09-18 (later still) — Income Resilience frontend
Built `src/components/incomeResilience/IncomeResilienceScreen.tsx` from
the HTML mockup iterated with the user, wired into `Sidebar.tsx`/
`App.tsx` (Income Resilience was already a placeholder entry in the
Income & Work group — upgraded to real). No calculation logic was
touched — the screen calls `checkIncomeResilience` on load and on
"Recheck now", reads `listMySnapshots`/`listIncomeResilienceBenchmarks`
/`getMyNote` live, and calls `saveResilienceNote`/`emailResilienceSummary`
/`humanConsult.requestHumanConsult` for its actions.

One small refactor while wiring `App.tsx`: the ServiceKey → Route
mapping had been a duplicated ternary chain in both `Sidebar`'s
`onNavigate` and would have needed a third copy for the weak-dimension
"fix this in X" links, so it's now one `serviceKeyToRoute` function
both call.

Verified live, signed in as the same real household from the backend
pass:
- Hero card, dimension breakdown, benchmark, and trend all rendered
  with the exact real figures already verified at the backend layer
  (100% income concentration, 60% EMI ratio, ₹0 liquid reserve, real
  insurance now showing ✓ after the policy added earlier, real 3-point
  trend history).
- A weak-dimension "fix this" link (Extra liquid reserve → Investment &
  Risk Planning) navigated to that real screen, confirming the shared
  `serviceKeyToRoute` routing works end to end.
- "Email me this summary" showed real "Delivery: sent"; both "Ask a
  question" and "Want a real person's opinion?" wrote real
  `humanConsultRequests` rows (`sourceService: "incomeResilience"`),
  confirmed by reading them back from the database.
- Typed a real note into the textarea ("Company mentioned budget cuts
  might affect bonuses this year"), saved it, and the UI correctly
  showed the live-extracted "JOB SECURITY CONCERN" tag and a rechecked
  narration that honestly referenced it ("your note about potential
  bonus losses due to budget cuts highlights a job security concern")
  — while the tier and weak dimensions stayed exactly the same, proving
  the note colors the narration only, in the real UI, not just at the
  backend layer.

### 2026-09-18 (later still) — Financial Foundation: edit/delete on every entry
User-reported gap, first real test session: Financial Foundation's
income/expense/obligation/asset/insurance rows had an "Add" form but no
way to fix a mistake afterward. `convex/incomeSources.ts`,
`expenses.ts`, `obligations.ts`, `assets.ts`, and `insurance.ts` each
only had `add*`/`list*` — no `update*`/`delete*` at all. Added both to
all five, same ownership check every other mutation in this app uses
(`requireMembership` + a `householdId` match before any write, `bumpStateRevision`
after). `obligations.ts`'s new `updateObligation` only touches the
basic fields (label/balance/EMI) — Loan & Debt's own `updateLoanDetails`
in `convex/loanDebt.ts` still owns the extended fields (rate, tenure,
etc.); nothing there was touched or duplicated.

Frontend: every row in `FinancialFoundationScreen.tsx` now has Edit
(inline form, same pattern the Insurance section already used for its
own rows) and Delete (a two-click "Really delete?" confirm that resets
after 4 seconds — no modal, but a stray click can't silently remove a
real financial entry).

Verified live against a real household's real data:
- Edited "Streaming subscriptions" from ₹5,000 to ₹4,000 — confirmed
  in the UI and by reading the row back from the database
  (`updatedAt` newer than `createdAt`, `amountMinorUnits: 4000`).
- Clicked Delete once on "Rent and essentials" — button correctly
  became "Really delete?" without removing the row; left it alone and
  confirmed it silently reverted to "Delete" after the 4s window (no
  accidental deletion from a single click, and no permanently-armed
  confirm state either).
- Clicked Delete twice — the row was actually removed, confirmed by
  re-reading the `expenses` table directly: no row with that label
  remains for the household.

### 2026-09-18 (later still) — Financial Foundation: plain-language obligation labels
Second real gap from the same test session: "Outstanding balance" and
"EMI" on the Obligations quick-add form assumed banking familiarity.
Changed to "Total amount still owed" and "What you pay monthly" (Add
form, Edit form, and the read-only row display) — copy only, no schema
or mutation change. Detailed rate/tenure fields stay where they already
live (Loan & Debt's own edit, or document upload) rather than
cluttering this quick-add form.

### 2026-09-18 (later still) — Side-Income & Business Planning: location scoping
Third real gap: the job-track search only ever said "typical pay for
X work in India" — no way to say "I want local, in-person work" or
where. Schema addition (confirmed before pushing): `workLocationPreference`
("online" | "offline" | "either") and `location` (free text), both
optional, job-track-only on `sideIncomeEntries`.

Wired into `estimateJobIncomeRange`'s search query (scoped to the real
location when given and not online-only; stays "India"-wide otherwise —
never guesses a city) and into `generateDeepDive`'s query for job
entries (same discipline, especially relevant for the `whereToApply`
topic). The AI prompt now also gets an explicit instruction on which
`mode` each opportunity must be, grounded in the real preference. No
change to `computeJobMonthlyIncomeMinor`/`computeJobHoursPerWeekNeeded`
or any other deterministic math.

Frontend: a "Where?" dropdown right after "What kind of work?" (Remote
/ Local / Either), revealing a city/area text input only for Local or
Either — Remote stays clean with nothing extra to fill in.

Verified live: selected "Local / in-person only" + "Jaipur" + "home
tuition", ran a real search, and got real, genuinely city-scoped
results — "Primary/Middle/High School Tutor in Jaipur — offline" with
a grounded reasoning ("Based on typical home tuition fees for primary
classes in Jaipur which range from ₹200–400 per hour...") — not the
generic India-wide guess from before. Confirmed the real
`workLocationPreference: "offline"` / `location: "Jaipur"` values
persisted by reading the row back from the database. An older entry
created before this change (no location fields at all) still loads
and searches fine — backward compatible, no crash on missing fields.

### 2026-09-18 (later still) — Side-Income & Business Planning: free-text intent extraction
Fourth real gap from the same test session: "Type of work" and "Idea
description" were single-line inputs, forcing the household to think in
separate structured fields instead of just describing what they want.
Two new EXTRACTION-ONLY actions in `convex/sideIncome.ts` —
`extractJobIntent` and `extractBusinessIntent` — same boundary as
Document Intelligence and every other extraction pipeline in this app:
pull structured fields out of free text, never invent a number or guess
a plausible default. No schema change (both write into fields that
already existed — `typeOfWork`/`hoursPerWeek`/etc., `ideaDescription`/
`startupCapitalMinorUnits`/etc.) and no deterministic calculation
touched — `computeJobMonthlyIncomeMinor`, `checkBusinessReserve`, and
every other real math in this file are untouched.

Frontend: both single-line inputs became real textareas ("Tell us in
your own words..."). On "Find ideas"/"Check my idea", if the household
left any structured field blank, extraction fills ONLY those — it never
overwrites something they explicitly typed themselves, and the fields
stay visible/editable so they can correct anything. Relaxed the "Find
ideas" button's disabled condition (previously required "Hours per
week" filled in upfront, which defeated the point of describing hours
in free text instead) and added a clear inline message for the one
case extraction can't rescue — no weekly hours / startup capital
findable anywhere — instead of letting the deterministic check's error
surface as a raw crash.

One quality fix caught while wiring this, not asked for: extraction
also returns a clean short restatement (e.g. "home candle-making
business") of what the household wrote — used for what's actually
*stored* as `typeOfWork`/`ideaDescription`, while the full raw
paragraph is still what's sent to the search itself. Storing the raw
paragraph as a "title" would have looked messy everywhere it's
displayed (e.g. the plan summary's title fallback).

Verified live, two real end-to-end runs:
- Job: wrote "I can give about 8 hours a week on weekday evenings, want
  to make roughly 12000 rupees a month, and I'd prefer online work I
  can do from home. I have some graphic design skills." with every
  structured field left blank. Real result: Hours per week → 8, Target
  amount → 12000, When → "Weekday evenings", Where → "Remote / online
  only", all visibly pre-filled and confirmed in the database row.
  "Find ideas" returned real opportunities including "Freelance Graphic
  Designer — online" fitting 8 hrs/wk at ₹9,240–₹16,480/mo — genuinely
  grounded in the stated skill, hours, and mode, not the previous
  generic broad-category fallback.
- Business: wrote a similar free-text idea (candle-making, ₹20,000,
  12 hrs/week, 4-month ramp-up) with capital/effort/ramp-up all left
  blank. Real result: all three fields correctly filled (20000 / 12 /
  4), the real reserve check ran against the household's actual liquid
  savings ("reserve after startup capital would be ₹80,000" — a real
  ₹1,00,000 − ₹20,000), and the database row stored the clean
  "home candle-making business" label, not the raw paragraph.

### 2026-09-18 (later still) — Government, Economic & Livelihood Intelligence: copy only
Two static-text additions to `GovernmentEconomicScreen.tsx`, no backend
touched: a small muted eyebrow line above the H1, and a "What we watch
for" explanatory block below the empty-state findings message
(3 bullets + a line on the proactive-email behavior), shown only when
a track's real findings count is 0. Verified live on two different
tracks/households — the eyebrow renders on every load, and the
explanatory block correctly appears only in the genuine empty state
(a track with 1 real finding did not show it; a track with 0 did).

### 2026-09-18 (later still) — Branding: logo + tagline, marketing landing page
Frontend-only, no backend touched. New shared `src/components/Logo.tsx`
(house-icon SVG + "FinComp" wordmark + "Know before you decide."
tagline always directly beneath it, `dark`/light variants for cream vs.
deepGreen backgrounds) — wired into `Header.tsx` and `Sidebar.tsx`,
replacing their plain-text wordmarks.

Rebuilt `AuthScreen.tsx` into an actual marketing landing page (it had
been a plain two-panel sign-in form) per a reference screenshot: a top
nav with the logo and Sign in/Sign up buttons, a centered italic quote
headline, a "Get started" CTA, and a 9-card grid — one card per real
service, including the two built this session (Government/Economic
Intelligence, Income Resilience). Clicking any entry point (Sign in /
Sign up / Get started) swaps to the existing `SignInForm` (unchanged
sign-in/sign-up logic and error handling) in a focused view with a
"← Back" link, rather than replacing the marketing page outright.

Verified live: fresh unauthenticated load renders the full landing
page with the new logo+tagline nav and all 9 service cards; clicking
"Sign in" swaps to the form (also showing the logo+tagline) and "←
Back" correctly returns to the landing page without a reload; a real
sign-in with an existing test account completed successfully straight
through to the authenticated app, confirming the rebuild didn't break
auth. The Sidebar's dark-background logo+tagline variant confirmed
visually correct (cream wordmark, sage-green italic tagline) on the
authenticated shell.

### 2026-09-18 (later still) — Real header/sidebar split + Sign out
Corrected an earlier mistake: the previous pass had put the brand block
(logo/tagline/avatar/email/Sign out) at the top of the Sidebar itself,
not in a genuine full-width header. Restructured `App.tsx`'s root
layout so `Header` renders once, full-width, above BOTH the Sidebar and
the main content (a column: Header, then a row of Sidebar + content) —
applied to all three authenticated states (loading, empty-state,
main shell), not just one. `Header.tsx` now owns all account-identity
chrome (inline logo+tagline on the left; avatar, email, household name,
and a small "Sign out" link on the right, calling the same real
`useAuthActions().signOut()`). `Sidebar.tsx` had its entire top block
removed — navigation only now. `Logo.tsx` gained an `inline` layout
variant (icon + wordmark + tagline on one row) for this compact header
use, alongside the existing stacked variant still used on the landing
page and sign-in screen.

Verified live across multiple real service pages (Financial Foundation,
Government/Economic Intelligence, Insurance) — same header content on
every one, Sidebar showing navigation only with no duplicate branding,
and "Sign out" clicked from its new header location correctly signed
out and routed to the real landing page.

Also, while investigating deployment (see below): found `.env` had been
committed with real API keys in an early commit, already pushed to the
public remote; a later commit removed it from the current tree, but the
values remain recoverable from git history. Flagged to the user —
rotating both keys is the simple fix regardless of whether history gets
rewritten.

### 2026-09-18 (later still) — Deployment status (in progress)
Corrected a wrong premise: there is no "Convex static hosting" product
— checked docs.convex.dev directly rather than relying on training
data. `npx convex deploy` deploys only backend functions/schema to a
real production deployment (confirmed target: a production deployment
already provisioned for this project); the frontend static build needs
a separate host (Vercel/Netlify/GitHub Pages/custom) per Convex's own
docs. `npm run build` succeeds cleanly. Production deployment currently
has zero environment variables set (confirmed via `npx convex env list
--prod`) — real values are ready to copy from dev once the push
happens. The actual `npx convex deploy` push requires an interactive
confirmation prompt this environment can't answer (no bypass flag
exists in this Convex version) — needs the user to either run it
themselves or provide a deploy key. Live URL not yet available;
`hackathon.md`'s "Live app" field intentionally not updated until
there's a real reachable frontend, not just a bare backend URL.

### 2026-09-18 (later still) — Header: stacked tagline + avatar dropdown
Two corrections to the header from the prior pass, per real feedback:
the tagline had been placed inline next to the wordmark (a row); moved
back to stacked directly beneath it (`Logo`'s existing default variant
— the `inline` one added last pass is no longer used in the header).
"Sign out" and the email/household text had been sitting inline next
to the avatar; moved into a click-to-open dropdown anchored to the
avatar instead (click-outside closes it), so the header's right side
is just the avatar until clicked.

Verified live: tagline renders on its own line under "FinComp"; the
header's right side shows only the avatar; clicking it opens a real
dropdown with the real email, real household name, and "Sign out";
clicking "Sign out" from inside the dropdown correctly signs out and
routes to the landing page. Only `Header.tsx` changed.

### 2026-09-19 (docs) — Per-service docs + Mermaid architecture diagram
Documentation only, no code changed. Added `docs/services/` — one doc
per service (`financial-foundation.md` through `income-resilience.md`,
plus an index `docs/services/README.md`), each stating what the service
does, exactly how its numbers are computed (the deterministic core:
formulas, thresholds, cache keys), and precisely where AI is used and
why — written from this log's own verified evidence, not re-derived
from reading source. `README.md`'s service list now links each entry to
its doc. Replaced the ASCII architecture diagram with an equivalent
Mermaid flowchart (GitHub renders Mermaid natively in README.md) showing
the same real flow: frontend → Convex queries/mutations (deterministic
logic) and actions (OpenAI narration/extraction, Firecrawl real sourced
data) and HTTP actions (AgentMail in/out, plus the custom `*.convex.site`
static-file serving).

Checked `AGENTS.md`: it's the real, auto-generated Convex agent-guidance
file (`npx convex ai-files install`), still accurate for this project —
kept as-is, not scaffold junk to remove.

### 2026-09-19 (docs, later) — README restructure: story before stack
Documentation only, no code changed. Rewrote `README.md`'s framing per
explicit feedback that the product story should come before the
technical detail and that "The 9 services" implied an unverified claim.
Added: a "Why I built it" section, a "How FinComp is different"
section naming coordination (not calculators) as the actual
differentiator, "The connected service model" (renamed from "The 9
services", with an explicit "every service below is built and verified"
statement since that's what the evidence in this log actually shows —
no service needed a lower status label), a Document Intelligence
"shared intelligence layer" callout (previously missing from the
service list entirely, despite being one of the most-verified
capabilities), a daily-life-question table, expanded sponsor-technology
sections written from real workflows (not a flat tech-stack list) for
Convex/Firecrawl/AgentMail/OpenAI, and a 9-step "when income stops"
worked example.

One honesty correction made while writing the sponsor sections: the
Live demo section now explicitly flags that production's env vars
haven't been reconfirmed as set since the production push (last known:
zero set) — so AI/sourced-data/email features are proven working on dev
but not yet reconfirmed on the live `*.convex.site` URL specifically.
Firecrawl's section was also narrowed to name only the specific
allowlisted pages actually scraped per feature, not "every government
source," per the same standard already used throughout this log.

### 2026-09-20 — README reordered to match a requested reading order
Documentation only. Reordered `README.md`'s sections (no content cut) to
Intro → Architecture → Why it matters → How FinComp is different →
Service layer (connected service model, Document Intelligence, core
design principle, sponsor tech, worked example) → Guide & docs →
License, per explicit feedback that the architecture diagram should
follow the intro directly, and everything service-specific (the model,
the shared intelligence layer, sponsor tech, the walkthrough) should
nest under one "Service layer" heading before the closing guide/license
sections.

### 2026-09-19 — Real static hosting on *.convex.site, dev-verified
Convex genuinely has no static-hosting product (re-confirmed directly
against `docs.convex.dev/functions/http-actions`, which states HTTP
Actions "cannot serve static frontend builds"), so built one from real
primitives per the explicit instruction to deploy specifically on
`convex.site`. New `staticAssets` table (path → storageId/contentType,
indexed by path). `convex/staticSite.ts`: internal-only functions
(`generateUploadUrl`, `recordAsset`, `pruneAssetsNotIn`,
`getAssetByPath`, `listAssetPaths`) — never exposed to app users, only
ever called by deploy tooling with CLI-level admin access.
`convex/http.ts` gained a `pathPrefix: "/"` GET catch-all HTTP Action,
added after the existing exact-path Auth and AgentMail-webhook routes
so neither is shadowed by it: looks up the request path, serves the
stored blob from File Storage with its real content type, falls back
to `/index.html` for client-side routing, and returns a 404 with a
clear message if nothing has been deployed yet. New
`scripts/deploy-static-site.mjs` walks `dist/` after `npm run build`,
uploads each file to File Storage, records its path, and prunes any
stale path from a previous build (hashed filenames change every
build).

Two real bugs found and fixed while getting this working on Windows:
invoking `npx`/`convex` through their `.cmd` shims re-tokenized a JSON
argument through cmd.exe and silently stripped embedded quotes once
the payload had spaces/semicolons (a real content-type string) —
fixed by having the script invoke `node_modules/convex/bin/main.js`
directly with `node` and a real argv array, bypassing the shim layer
entirely. Separately, `npx convex run` prints nothing at all for a
function returning `null` (`recordAsset`), which the script's
`JSON.parse` of empty output was treating as malformed — fixed to
treat empty stdout as `null` rather than parsing it. Also hardened
`pruneAssetsNotIn` to not fail the whole prune if one row's blob is
already gone from storage.

Verified against the real dev deployment: `npm run build` produced a
clean 4-file `dist/`; the deploy script uploaded all 4 and pruned 2
stale test rows; loading `https://utmost-puffin-491.convex.site`
directly in a browser rendered the real FinComp landing page (full
copy, all 9 service cards, no console errors); navigating to an
unknown deep path served the same app shell via the `/index.html`
fallback instead of a bare 404; `POST /agentmail/webhook` still
returned its own real `401` (signature rejection), confirming the new
catch-all route did not shadow it.

Production is still blocked on the same open item as the prior
deployment pass: `npx convex deploy` requires an interactive
confirmation this environment cannot answer, so pushing this schema/
code to the production deployment — and then running the same deploy
script with `--prod` — needs the user to run it themselves or supply a
deploy key. `hackathon.md`'s "Live app" field is still intentionally
`not deployed`, now for a smaller, well-defined reason: the mechanism
itself is proven working on dev, only the prod push is outstanding.

### 2026-09-19 (later) — Production is live
User ran `npx convex deploy` themselves, pushing the schema/functions
to the production deployment (`quixotic-dalmatian-305`). Rebuilt the
frontend with `VITE_CONVEX_URL` overridden to the production Convex
URL — the default `npm run build` would otherwise have shipped a
production-hosted bundle still wired to the dev backend, since
`.env.local` only carries dev's URL; confirmed post-build that the
compiled JS bundle contains the prod domain and zero occurrences of
the dev one. Ran `node scripts/deploy-static-site.mjs --prod`,
uploading the same 4 built files to production's own File Storage.

Verified live and reachable: `https://quixotic-dalmatian-305.convex.site`
returns `200`, the real FinComp landing page renders with all 9
service cards, and clicking "Sign in" renders the real form with no
console errors — confirming the JS bundle loaded and hydrated
correctly against the production backend. Not yet verified: an actual
end-to-end sign-in/sign-up against production (no test account exists
there yet, and creating one isn't something this pass does
unprompted), and whether every production env var (AgentMail/
Firecrawl/OpenAI keys, auth's SITE_URL) is set — these were confirmed
unset as of the last check and haven't been re-verified since the
user's deploy.
