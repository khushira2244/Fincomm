# Schema Design Decisions

Scope of this document: `schema.sql` + `ERD.mmd` for the vehicle-repair
trust and evidence platform (OpenCV AI Competition 2026, Agentic Vision
path). No application, agent, or frontend code included — see the parent
session instructions.

## Database choice: PostgreSQL, no objection

You asked me to flag it if I'd strongly recommend something else. I
don't. Reasons this fits:

- The core object graph (owners → vehicles → cases → media/parts/vision
  runs → agent steps) is relational with real foreign-key integrity
  requirements (e.g. "exactly one system-triggered re-record per case" is
  enforced as a partial unique index — that's much harder to guarantee in
  a document store).
- `JSONB` gives you schema flexibility for module-specific vision
  measurements without giving up SQL joins and constraints everywhere
  else.
- AWS RDS/Aurora Postgres is a supported, boring, well-understood choice
  for a 15-day solo build — no new infra concepts to learn under time
  pressure.

## Assumptions locked in this session

- **One garage per mechanic** (no `mechanic_garage` join table). If you
  later need freelance mechanics working multiple garages, add a join
  table; nothing else in the schema changes.
- **One owner per vehicle** (`vehicles.owner_id`, not a join table).
  Ownership transfer/history is not modeled — out of scope for the demo.
- **Multi-currency**: every money column has a paired `currency_code
  char(3)` (default `'INR'`) rather than assuming a single currency.

## Tiering

**CORE** (must exist for the demo; build first):
`owners`, `garages`, `mechanics`, `vehicles`, `repair_cases`,
`media_assets`, `mechanic_claims`, `repair_proposals`, `proposed_parts`,
`purchased_parts`, `fitted_parts`, `vision_analysis_runs`,
`vision_run_inputs`, `vision_findings`, `evidence_requests`,
`agent_runs`, `agent_steps`, `pre_service_reasoning_results`,
`final_repair_reports`, `owner_decisions`, `audit_timeline`,
`evaluation_clips`, `evaluation_runs`.

This is deliberately still ~22 tables, but every one of them is on the
critical path for the two things judges score: (1) a real agentic trace
(perception → decision → action/approval, all FK-linked) and (2)
evaluation evidence. Cut anything here and you can't tell that story.

**SUPPORTING** (strengthens the demo, not blocking):
`second_opinions` (mocked expert flow), `service_history_entries`
(could be a view over `repair_cases` instead of a table — keep as table
only if you need it to survive case archival or want manual curation),
`vehicle_memory` (recurring-fault detection).

**STRETCH** (only if days remain):
`notifications`.

### Suggested build order for 15 days

1. Days 1–2: `owners`, `garages`, `mechanics`, `vehicles`, `repair_cases`,
   `media_assets` — enough to record a case end to end with media.
2. Days 3–4: `mechanic_claims`, `repair_proposals`, `proposed_parts`,
   `purchased_parts`, `fitted_parts` — the money/parts trail.
3. Days 5–7: `vision_analysis_runs`, `vision_run_inputs`,
   `vision_findings` — wire up module 1 and 2 first (evidence quality,
   component visibility), they're the cheapest to demo.
4. Days 8–10: `agent_runs`, `agent_steps`, `evidence_requests`,
   `pre_service_reasoning_results`, `owner_decisions` — this is the
   Agentic Vision spine; get one full pre-service trace working
   end-to-end before touching mid/post-service.
5. Days 11–12: `final_repair_reports`, remaining vision modules
   (3, 4, 5), `audit_timeline`.
6. Days 13–14: `evaluation_clips`, `evaluation_runs` — do not leave this
   to the last day, the judges explicitly want failure cases too.
7. Day 15: buffer + `second_opinions`/`vehicle_memory` if time remains.

## Typed columns vs. JSONB for vision findings

`vision_findings` is one table for all 6 modules, not five/six
module-specific tables. The split:

- **Typed, top-level**: `module`, `result_label` (PASS/WARN/FAIL/
  INCONCLUSIVE), `confidence`, `primary_metric`. These four are what
  every cross-module query needs — "show me all FAILs for this case",
  "sort findings by confidence", "what's the coverage number for module
  2 on this case". Keeping them as real columns means normal `WHERE`/
  `ORDER BY`/index usage, and the agent-decision FK (`agent_steps
  .caused_by_finding_id`) can join against a small, stable row shape
  regardless of which module produced it.
- **JSONB `measurements`**: everything module-specific — per-frame
  sharpness/exposure/glare arrays (module 1), per-part bounding boxes and
  sizes (module 2), displacement/vibration time series (module 3),
  homography matrix and change-map S3 pointer (module 4), OCR/barcode
  raw text (module 5). These shapes genuinely differ per module and are
  read as a whole by the UI/report generator, not filtered column-by-
  column in SQL. A GIN index is included in case you do need to query
  into it later.

Why not five tables? With one table you get one FK target for
`agent_steps.caused_by_finding_id` and `evidence_requests
.triggered_by_finding_id`, which is what makes the "vision output → later
decision" trace queryable in one join instead of five different ones
with a `module` discriminator column in the join logic anyway. If a
specific module's typed needs grow (e.g. you start filtering heavily on
module 4's inlier_ratio), promote just that one field into its own typed
column — `primary_metric` already reserves that slot generically; you
can add a dedicated column without breaking anything.

`vision_run_inputs` is a separate many-to-many table (not a column on
the run) because module 4 (before/after registration) needs two media
assets per run (pre + post), and module 1 may score several candidate
frames before keyframe selection — a single `media_asset_id` FK on the
run can't express either.

## Case state machine

`repair_cases.state` (enum `case_state`) models stage + status as one
lifecycle rather than two separate columns, because the two are not
actually independent (e.g. "MID_SERVICE" only makes sense after
approval, so tracking them separately would let you represent invalid
combinations).

```
DRAFT
  → AWAITING_RERECORD        (evidence-quality vision run WARNs/FAILs; exactly one
                               system evidence_request created; see constraint below)
  → PENDING_OWNER_REVIEW      (case always reaches the owner, weak evidence or not)

AWAITING_RERECORD
  → PENDING_OWNER_REVIEW      (mechanic fulfills the re-record, or it expires —
                               either way the case proceeds, never blocks permanently)

PENDING_OWNER_REVIEW
  → REJECTED_BY_OWNER         (owner_decisions.pre_service_decision = REJECT)
  → APPROVED                  (APPROVE or CONTINUE_DESPITE_WEAK_EVIDENCE)
  → PENDING_OWNER_REVIEW       (ASK_MECHANIC — case stays here, a new mechanic_claims
                                or media round trip happens, owner reviews again)
  → PENDING_OWNER_REVIEW       (REQUEST_EXPERT_OPINION — second_opinions row created,
                                case stays here until opinion returns)

APPROVED
  → IN_PROGRESS                (mechanic starts purchasing/fitting parts)

IN_PROGRESS
  → SUPPLEMENTAL_APPROVAL_PENDING  (a new expensive repair_proposals row with
                                     is_supplemental = true is created)
  → COMPLETED_PENDING_ACK      (post-service evidence submitted, final_repair_reports
                                 generated)

SUPPLEMENTAL_APPROVAL_PENDING
  → IN_PROGRESS                (owner approves the supplemental proposal)
  → REJECTED_BY_OWNER          (owner rejects it — case may still close out on
                                 already-approved work; app logic decides)

COMPLETED_PENDING_ACK
  → CLOSED_ACKNOWLEDGED        (ACKNOWLEDGE_AND_SAVE)
  → CLOSED_DISPUTED            (REPORT_PROBLEM)
  → COMPLETED_PENDING_ACK       (REQUEST_CLARIFICATION — stays open, awaiting more info)
  → COMPLETED_PENDING_ACK       (REQUEST_SECOND_OPINION — second_opinions row created)

any pre-approval state
  → CANCELLED                  (owner or mechanic cancels before work starts)
```

Two structural constraints in `schema.sql` directly encode requirements
from the brief:

- `uq_one_system_rerecord_per_case`: a partial unique index on
  `evidence_requests(case_id) WHERE source = 'SYSTEM'` — guarantees the
  "exactly one automatic re-record" rule at the database level, not just
  in application code.
- `owner_decisions` has a `CHECK` forcing exactly one of
  `pre_service_decision` / `final_decision` to be set per row — a single
  table for both checkpoints (they share owner/case/notes/timestamp
  shape), but a row can never claim to be both.

State transitions themselves (which `state` values a decision is allowed
to produce) are intentionally **not** enforced by a DB trigger — that
belongs in the agent/application layer, which is out of scope for this
session. A trigger could be added later if you find bad transitions
slipping through.

## Other notable choices

- **UUID primary keys** (`gen_random_uuid()` via `pgcrypto`) everywhere,
  not serial ints. Slightly larger indexes, but avoids ID collisions if
  you ever need to seed/merge data across environments (useful for the
  evaluation dataset, which you'll likely build offline and import).
- **`media_assets` optional FKs** (`related_proposal_id`,
  `related_purchased_part_id`) let fitting evidence point at the specific
  part it documents, without a separate join table — added via `ALTER
  TABLE` after the referenced tables exist, since `media_assets` is
  created early (Day 1) and those tables don't exist yet at that point in
  the file.
- **`vision_findings.case_id` and `.module` are denormalized** from
  `vision_analysis_runs` — pure query convenience (the two "prove the
  agentic trace" and "recurring fault" example queries below both need
  case-scoped, module-filtered finding lookups without an extra join).
  Kept in sync by the application layer at write time (single INSERT,
  not an update path, so no drift risk).
- **`audit_timeline` is intentionally schema-loose** (`event_type` text +
  `event_payload jsonb`) rather than a typed table per event kind — it's
  an observability log, not a query surface with filters beyond
  case/time, so the flexibility is worth more than typed columns here.
- **No soft-delete columns.** Nothing in the brief calls for deleting
  cases or media, and evidence/audit tables should never be deleted
  anyway. If you need to hide a case from a UI list, that's a `state`
  value (`CANCELLED`), not a delete.

## Open questions (didn't change the schema, but worth flagging)

- **Redaction pipeline**: `media_assets.redaction_status` tracks state
  but nothing here defines who/what triggers redaction or where the
  redacted copy lives (same S3 key, new key, new bucket?). Fine to defer
  — it's an app/pipeline decision, not a schema one, but decide before
  Day 1 media upload code is written.
- **Supplemental proposal approval loop**: I modeled
  `SUPPLEMENTAL_APPROVAL_PENDING` as a case-level state, meaning only one
  supplemental proposal can be pending owner review at a time. If you
  need multiple simultaneous supplemental proposals, the state machine
  needs to move from a single `case_state` enum to tracking approval
  status per-proposal instead (`repair_proposals` would need its own
  status column). Flagging now because it's a bigger schema change than
  most others.
- **Evaluation clips vs. real case media**: `evaluation_clips` currently
  stores its own S3 pointer rather than referencing `media_assets`, on
  the assumption your labeled eval set is built from separate/curated
  clips, not live case footage. If you're instead planning to promote
  real case media into the eval set, add a nullable
  `source_media_asset_id` FK — cheap to add later, not adding it
  preemptively per your "don't add tables I didn't ask for" instruction.
