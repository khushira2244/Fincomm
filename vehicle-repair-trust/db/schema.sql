-- =====================================================================
-- Vehicle Repair Trust & Evidence Platform — Database Schema
-- Target: PostgreSQL 15+ (AWS RDS / Aurora)
-- See DECISIONS.md for tiering, typed-vs-JSONB rationale, and the
-- case state machine this schema encodes.
--
-- Tier legend (also noted per table below):
--   CORE       = required for the demo / judging path
--   SUPPORTING = strengthens the story, not demo-blocking
--   STRETCH    = build only if days remain
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE vehicle_type AS ENUM ('CAR', 'BIKE');

CREATE TYPE media_stage AS ENUM ('PRE_SERVICE', 'MID_SERVICE', 'POST_SERVICE');
CREATE TYPE media_type AS ENUM ('VIDEO', 'IMAGE', 'AUDIO');
CREATE TYPE redaction_status AS ENUM ('NONE', 'PENDING', 'REDACTED');

CREATE TYPE part_source AS ENUM ('OEM', 'AFTERMARKET', 'UNKNOWN');

-- Full case lifecycle. See DECISIONS.md for the transition table.
CREATE TYPE case_state AS ENUM (
  'DRAFT',                          -- mechanic recording pre-service evidence
  'AWAITING_RERECORD',              -- weak evidence, one automatic re-record requested
  'PENDING_OWNER_REVIEW',           -- sent to owner regardless of evidence quality
  'REJECTED_BY_OWNER',
  'APPROVED',                       -- mid-service may begin
  'IN_PROGRESS',                    -- parts being purchased/fitted
  'SUPPLEMENTAL_APPROVAL_PENDING',  -- new expensive proposal raised mid-service
  'COMPLETED_PENDING_ACK',          -- post-service done, awaiting owner acknowledgement
  'CLOSED_ACKNOWLEDGED',
  'CLOSED_DISPUTED',                -- owner reported a problem
  'CANCELLED'
);

CREATE TYPE evidence_request_source AS ENUM ('SYSTEM', 'OWNER');
CREATE TYPE evidence_request_status AS ENUM ('PENDING', 'FULFILLED', 'EXPIRED');

CREATE TYPE pre_service_owner_decision AS ENUM (
  'APPROVE', 'REJECT', 'ASK_MECHANIC', 'REQUEST_EXPERT_OPINION', 'CONTINUE_DESPITE_WEAK_EVIDENCE'
);

CREATE TYPE final_owner_decision AS ENUM (
  'ACKNOWLEDGE_AND_SAVE', 'REPORT_PROBLEM', 'REQUEST_CLARIFICATION', 'REQUEST_SECOND_OPINION'
);

-- Pre-service reasoning checkpoint result. Judges evidence sufficiency
-- ONLY — never whether the mechanic's diagnosis is correct.
CREATE TYPE evidence_support_result AS ENUM (
  'SUPPORTED', 'PARTIALLY_SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'QUESTIONABLE'
);

CREATE TYPE vision_module AS ENUM (
  'EVIDENCE_QUALITY',           -- module 1: sharpness/exposure/glare/motion blur, keyframes
  'COMPONENT_VISIBILITY',       -- module 2: detector coverage of required parts
  'MOTION_EVIDENCE',            -- module 3: optical flow, displacement, vibration
  'BEFORE_AFTER_REGISTRATION',  -- module 4: homography, inlier ratio, change map
  'PART_IDENTITY',              -- module 5: label/OCR/barcode vs approved part number
  'CANDIDATE_DEFECT_DETECTION'  -- extra: candidate leak/rust regions (candidate only)
);

CREATE TYPE vision_run_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INCONCLUSIVE');
CREATE TYPE vision_result_label AS ENUM ('PASS', 'WARN', 'FAIL', 'INCONCLUSIVE');

CREATE TYPE agent_step_type AS ENUM ('PERCEPTION', 'DECISION', 'ACTION', 'HUMAN_APPROVAL');
CREATE TYPE agent_step_status AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRIED', 'SKIPPED');
CREATE TYPE agent_run_status AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE actor_type AS ENUM ('OWNER', 'MECHANIC', 'SYSTEM', 'AGENT', 'EXPERT');

CREATE TYPE second_opinion_status AS ENUM ('REQUESTED', 'COMPLETED', 'DECLINED');

CREATE TYPE notification_channel AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED');

-- =====================================================================
-- CORE: accounts, vehicles, garages
-- =====================================================================

CREATE TABLE owners (                                   -- CORE
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE garages (                                   -- CORE
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  address       text,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One garage per mechanic (assumption confirmed with user).
CREATE TABLE mechanics (                                 -- CORE
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id     uuid NOT NULL REFERENCES garages(id) ON DELETE RESTRICT,
  full_name     text NOT NULL,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mechanics_garage ON mechanics(garage_id);

-- Single owner per vehicle (assumption confirmed with user).
CREATE TABLE vehicles (                                  -- CORE
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            uuid NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  vehicle_type        vehicle_type NOT NULL,
  make                text NOT NULL,
  model               text NOT NULL,
  year                int CHECK (year BETWEEN 1950 AND 2100),
  registration_number text NOT NULL,
  vin                 text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_number)
);

CREATE INDEX idx_vehicles_owner ON vehicles(owner_id);

-- =====================================================================
-- CORE: the repair case — central object everything hangs off
-- =====================================================================

CREATE TABLE repair_cases (                              -- CORE
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  garage_id     uuid NOT NULL REFERENCES garages(id) ON DELETE RESTRICT,
  mechanic_id   uuid NOT NULL REFERENCES mechanics(id) ON DELETE RESTRICT,
  state         case_state NOT NULL DEFAULT 'DRAFT',
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cases_vehicle ON repair_cases(vehicle_id);
CREATE INDEX idx_cases_garage ON repair_cases(garage_id);
CREATE INDEX idx_cases_state ON repair_cases(state);

-- =====================================================================
-- CORE: media (S3 keys + metadata only — never blobs)
-- =====================================================================

CREATE TABLE media_assets (                              -- CORE
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                  uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  stage                    media_stage NOT NULL,
  media_type               media_type NOT NULL,
  s3_bucket                text NOT NULL,
  s3_key                   text NOT NULL,
  mime_type                text NOT NULL,
  file_size_bytes          bigint,
  duration_seconds         numeric(8,2),                 -- video/audio only
  captured_at              timestamptz,                   -- device timestamp, if available
  uploaded_at              timestamptz NOT NULL DEFAULT now(),
  redaction_status         redaction_status NOT NULL DEFAULT 'NONE',
  perceptual_hash          text,                          -- duplicate-footage detection
  challenge_marker_detected boolean,                      -- QR/ArUco freshness proof
  -- optional linkage so fitting evidence can point at the part it documents
  related_proposal_id      uuid,                          -- FK added after repair_proposals exists
  related_purchased_part_id uuid,                         -- FK added after purchased_parts exists
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_key)
);

CREATE INDEX idx_media_case ON media_assets(case_id);
CREATE INDEX idx_media_stage ON media_assets(case_id, stage);
CREATE INDEX idx_media_phash ON media_assets(perceptual_hash);

-- =====================================================================
-- CORE: mechanic claim, repair proposal, parts (proposed/approved/
-- purchased/fitted)
-- =====================================================================

CREATE TABLE mechanic_claims (                           -- CORE
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  component_claimed  text NOT NULL,       -- e.g. "front brake pad"
  claim_description  text NOT NULL,       -- what the mechanic says is wrong
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claims_case ON mechanic_claims(case_id);

CREATE TABLE repair_proposals (                          -- CORE
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  claim_id                uuid NOT NULL REFERENCES mechanic_claims(id) ON DELETE RESTRICT,
  proposed_repair         text NOT NULL,
  estimated_price         numeric(10,2) NOT NULL,
  currency_code           char(3) NOT NULL DEFAULT 'INR',
  is_supplemental         boolean NOT NULL DEFAULT false,   -- mid-service new/expensive proposal
  proposed_at             timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proposals_case ON repair_proposals(case_id);

CREATE TABLE proposed_parts (                            -- CORE
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL REFERENCES repair_proposals(id) ON DELETE CASCADE,
  part_name           text NOT NULL,
  part_number         text,
  source              part_source NOT NULL DEFAULT 'UNKNOWN',
  estimated_unit_price numeric(10,2),
  currency_code       char(3) NOT NULL DEFAULT 'INR',
  quantity            int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proposed_parts_proposal ON proposed_parts(proposal_id);

CREATE TABLE purchased_parts (                           -- CORE
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  proposed_part_id      uuid REFERENCES proposed_parts(id) ON DELETE SET NULL,  -- null if bought outside approval
  part_name             text NOT NULL,
  brand                 text,
  part_number           text,
  source                part_source NOT NULL DEFAULT 'UNKNOWN',
  purchase_price        numeric(10,2) NOT NULL,
  currency_code         char(3) NOT NULL DEFAULT 'INR',
  old_part_removed      boolean NOT NULL DEFAULT false,
  old_part_description  text,
  purchased_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchased_parts_case ON purchased_parts(case_id);

CREATE TABLE fitted_parts (                              -- CORE
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchased_part_id   uuid NOT NULL REFERENCES purchased_parts(id) ON DELETE CASCADE,
  case_id             uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  fitted_at           timestamptz NOT NULL DEFAULT now(),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fitted_parts_case ON fitted_parts(case_id);
CREATE UNIQUE INDEX uq_fitted_parts_purchased_part ON fitted_parts(purchased_part_id);

-- Now that the referenced tables exist, wire media_assets' optional FKs.
ALTER TABLE media_assets
  ADD CONSTRAINT fk_media_proposal FOREIGN KEY (related_proposal_id)
    REFERENCES repair_proposals(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_media_purchased_part FOREIGN KEY (related_purchased_part_id)
    REFERENCES purchased_parts(id) ON DELETE SET NULL;

-- =====================================================================
-- CORE: vision analysis (OpenCV module outputs)
-- =====================================================================

CREATE TABLE vision_analysis_runs (                      -- CORE
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  module         vision_module NOT NULL,
  status         vision_run_status NOT NULL DEFAULT 'PENDING',
  model_version  text,             -- ONNX detector / model tag, for reproducibility
  opencv_version text,
  code_version   text,             -- git sha of the analysis pipeline, optional
  started_at     timestamptz,
  completed_at   timestamptz,
  duration_ms    integer,
  retry_count    int NOT NULL DEFAULT 0,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vision_runs_case ON vision_analysis_runs(case_id);
CREATE INDEX idx_vision_runs_module ON vision_analysis_runs(module);
CREATE INDEX idx_vision_runs_status ON vision_analysis_runs(status);

-- Many-to-many: a run (e.g. before/after registration) can consume
-- multiple media assets, each playing a role.
CREATE TABLE vision_run_inputs (                         -- CORE
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES vision_analysis_runs(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'PRIMARY',   -- e.g. 'PRE', 'POST', 'REFERENCE'
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, media_asset_id, role)
);

CREATE INDEX idx_vision_run_inputs_run ON vision_run_inputs(run_id);
CREATE INDEX idx_vision_run_inputs_media ON vision_run_inputs(media_asset_id);

-- One row per run's finding. Typed columns cover what every module
-- needs to be filtered/sorted on; module-specific detail goes in JSONB.
-- See DECISIONS.md for why this is one table, not five.
CREATE TABLE vision_findings (                           -- CORE
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES vision_analysis_runs(id) ON DELETE CASCADE,
  case_id            uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,  -- denormalized for fast case-scoped queries
  module             vision_module NOT NULL,             -- denormalized from run for filtering
  result_label       vision_result_label NOT NULL,
  confidence         numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  primary_metric     numeric,        -- the one number most queried per module (see DECISIONS.md)
  measurements        jsonb NOT NULL DEFAULT '{}'::jsonb, -- full module-specific payload
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vision_findings_run ON vision_findings(run_id);
CREATE INDEX idx_vision_findings_case_module ON vision_findings(case_id, module);
CREATE INDEX idx_vision_findings_measurements_gin ON vision_findings USING gin (measurements);

-- =====================================================================
-- CORE: evidence requests (the one automatic re-record)
-- =====================================================================

CREATE TABLE evidence_requests (                         -- CORE
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  source                evidence_request_source NOT NULL,
  reason                text NOT NULL,
  triggered_by_finding_id uuid REFERENCES vision_findings(id) ON DELETE SET NULL,
  status                evidence_request_status NOT NULL DEFAULT 'PENDING',
  fulfilled_media_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_requests_case ON evidence_requests(case_id);

-- Enforce "exactly one automatic re-record" per case at the DB level.
CREATE UNIQUE INDEX uq_one_system_rerecord_per_case
  ON evidence_requests(case_id) WHERE source = 'SYSTEM';

-- =====================================================================
-- CORE: agent runs / steps — the Agentic Vision trace
-- =====================================================================

CREATE TABLE agent_runs (                                -- CORE
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  trigger_event  text NOT NULL,       -- e.g. 'MEDIA_UPLOADED', 'OWNER_DECISION_SUBMITTED'
  status         agent_run_status NOT NULL DEFAULT 'RUNNING',
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_case ON agent_runs(case_id);

CREATE TABLE agent_steps (                               -- CORE
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id     uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_order       int NOT NULL,
  step_type        agent_step_type NOT NULL,
  tool_name        text,                -- name of the tool/module invoked, if any
  inputs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- the vision result that caused this step's decision/action, if any —
  -- this FK is what makes the perception->decision->action trace queryable.
  caused_by_finding_id uuid REFERENCES vision_findings(id) ON DELETE SET NULL,
  status           agent_step_status NOT NULL DEFAULT 'PENDING',
  retry_count      int NOT NULL DEFAULT 0,
  error_message    text,
  started_at       timestamptz,
  completed_at     timestamptz,
  duration_ms      integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_run_id, step_order)
);

CREATE INDEX idx_agent_steps_run ON agent_steps(agent_run_id, step_order);
CREATE INDEX idx_agent_steps_finding ON agent_steps(caused_by_finding_id);
CREATE INDEX idx_agent_steps_type ON agent_steps(step_type);

-- =====================================================================
-- CORE: AI reasoning checkpoints
-- =====================================================================

CREATE TABLE pre_service_reasoning_results (             -- CORE
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  claim_id        uuid NOT NULL REFERENCES mechanic_claims(id) ON DELETE RESTRICT,
  agent_step_id   uuid REFERENCES agent_steps(id) ON DELETE SET NULL,  -- the DECISION step that produced this
  result          evidence_support_result NOT NULL,
  confidence      numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  reasoning_text  text NOT NULL,
  inputs_used     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- refs to evidence/finding ids, vehicle history used
  generated_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pre_reasoning_case ON pre_service_reasoning_results(case_id);

CREATE TABLE final_repair_reports (                      -- CORE
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  agent_step_id       uuid REFERENCES agent_steps(id) ON DELETE SET NULL,
  proposed_summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_summary    jsonb NOT NULL DEFAULT '{}'::jsonb,
  purchased_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
  fitted_summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  charged_summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  demonstrated_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  discrepancies       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array of mismatch descriptions
  generated_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_final_reports_case ON final_repair_reports(case_id);

-- =====================================================================
-- CORE: owner decisions
-- =====================================================================

CREATE TABLE owner_decisions (                           -- CORE
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                  uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  owner_id                 uuid NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  pre_service_decision     pre_service_owner_decision,
  final_decision           final_owner_decision,
  pre_service_reasoning_id uuid REFERENCES pre_service_reasoning_results(id) ON DELETE SET NULL,
  final_report_id          uuid REFERENCES final_repair_reports(id) ON DELETE SET NULL,
  notes                    text,
  decided_at               timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (pre_service_decision IS NOT NULL AND final_decision IS NULL) OR
    (pre_service_decision IS NULL AND final_decision IS NOT NULL)
  )
);

CREATE INDEX idx_owner_decisions_case ON owner_decisions(case_id);

-- =====================================================================
-- SUPPORTING: second opinion (kept minimal — expert flow is mocked)
-- =====================================================================

CREATE TABLE second_opinions (                           -- SUPPORTING
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  requested_by_decision_id uuid REFERENCES owner_decisions(id) ON DELETE SET NULL,
  expert_name    text,
  opinion_text   text,
  status         second_opinion_status NOT NULL DEFAULT 'REQUESTED',
  requested_at   timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_second_opinions_case ON second_opinions(case_id);

-- =====================================================================
-- SUPPORTING: service history, vehicle memory
-- =====================================================================

-- Denormalized per-case summary for fast "vehicle history" lookups that
-- feed pre-service reasoning. Could be a VIEW; kept as a table so it's
-- cheap to query without recomputing joins across every service.
CREATE TABLE service_history_entries (                   -- SUPPORTING
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  case_id        uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  service_date   date NOT NULL,
  summary        text NOT NULL,
  parts_replaced jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

CREATE INDEX idx_service_history_vehicle ON service_history_entries(vehicle_id, service_date DESC);

CREATE TABLE vehicle_memory (                            -- SUPPORTING
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id          uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  observation_type    text NOT NULL,     -- e.g. 'RECURRING_FAULT', 'RECURRING_PART_REPLACEMENT'
  component           text NOT NULL,
  occurrence_count    int NOT NULL DEFAULT 1,
  first_seen_case_id  uuid REFERENCES repair_cases(id) ON DELETE SET NULL,
  last_seen_case_id   uuid REFERENCES repair_cases(id) ON DELETE SET NULL,
  last_updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, observation_type, component)
);

CREATE INDEX idx_vehicle_memory_vehicle ON vehicle_memory(vehicle_id);

-- =====================================================================
-- CORE: audit timeline (append-only observability log)
-- =====================================================================

CREATE TABLE audit_timeline (                            -- CORE
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid NOT NULL REFERENCES repair_cases(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  event_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type     actor_type NOT NULL,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_timeline_case ON audit_timeline(case_id, occurred_at);

-- =====================================================================
-- CORE: evaluation (labeled set + eval runs — required for submission)
-- =====================================================================

CREATE TABLE evaluation_clips (                          -- CORE
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module         vision_module NOT NULL,
  s3_bucket      text NOT NULL,
  s3_key         text NOT NULL,
  ground_truth   jsonb NOT NULL,          -- module-specific labeled truth
  label_source   text NOT NULL DEFAULT 'MANUAL',  -- who/what produced the label
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_key)
);

CREATE INDEX idx_eval_clips_module ON evaluation_clips(module);

CREATE TABLE evaluation_runs (                           -- CORE
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_clip_id     uuid NOT NULL REFERENCES evaluation_clips(id) ON DELETE CASCADE,
  vision_run_id          uuid REFERENCES vision_analysis_runs(id) ON DELETE SET NULL,
  module                 vision_module NOT NULL,
  metric_name            text NOT NULL,     -- e.g. 'precision', 'iou', 'mae'
  metric_value           numeric NOT NULL,
  predicted_label        text,
  correct                boolean,
  agent_decision_correct boolean,           -- did the downstream agent decision match expected?
  model_version          text,
  evaluated_at           timestamptz NOT NULL DEFAULT now(),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_runs_clip ON evaluation_runs(evaluation_clip_id);
CREATE INDEX idx_eval_runs_module ON evaluation_runs(module);

-- =====================================================================
-- STRETCH: notifications (minimal)
-- =====================================================================

CREATE TABLE notifications (                             -- STRETCH
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid REFERENCES repair_cases(id) ON DELETE CASCADE,
  recipient_type actor_type NOT NULL,
  recipient_id   uuid NOT NULL,
  channel        notification_channel NOT NULL DEFAULT 'IN_APP',
  message        text NOT NULL,
  status         notification_status NOT NULL DEFAULT 'PENDING',
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, recipient_id);

-- =====================================================================
-- updated_at trigger (applied to tables that get mutated post-insert)
-- =====================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_owners_updated_at BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_garages_updated_at BEFORE UPDATE ON garages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_mechanics_updated_at BEFORE UPDATE ON mechanics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_cases_updated_at BEFORE UPDATE ON repair_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_claims_updated_at BEFORE UPDATE ON mechanic_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proposals_updated_at BEFORE UPDATE ON repair_proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
