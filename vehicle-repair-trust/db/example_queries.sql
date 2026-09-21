-- =====================================================================
-- Example queries proving the schema supports the three things the
-- brief specifically asked to see. Replace the :case_id / :vehicle_id
-- bind params with real UUIDs when running against seeded data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Agentic trace for one case: perception (vision finding) ->
--    decision (agent step) -> action/human-approval (agent step),
--    in order, with the FK that proves the vision output caused it.
-- ---------------------------------------------------------------------
SELECT
  ar.id                    AS agent_run_id,
  ar.trigger_event,
  s.step_order,
  s.step_type,
  s.tool_name,
  s.status                 AS step_status,
  vf.module                AS caused_by_module,
  vf.result_label          AS caused_by_result,
  vf.primary_metric        AS caused_by_metric,
  s.inputs,
  s.outputs,
  s.started_at,
  s.completed_at
FROM agent_runs ar
JOIN agent_steps s        ON s.agent_run_id = ar.id
LEFT JOIN vision_findings vf ON vf.id = s.caused_by_finding_id
WHERE ar.case_id = :case_id
ORDER BY ar.started_at, s.step_order;


-- ---------------------------------------------------------------------
-- 2. Approved-vs-fitted parts comparison for a final report: did the
--    mechanic fit what the owner actually approved?
-- ---------------------------------------------------------------------
SELECT
  pp.part_name              AS proposed_part_name,
  pp.part_number             AS proposed_part_number,
  pp.source                  AS proposed_source,
  pp.estimated_unit_price,
  pp.currency_code           AS proposed_currency,
  od.pre_service_decision    AS owner_decision,
  purch.part_name            AS purchased_part_name,
  purch.brand                AS purchased_brand,
  purch.part_number          AS purchased_part_number,
  purch.source                AS purchased_source,
  purch.purchase_price,
  purch.currency_code        AS purchased_currency,
  fp.fitted_at,
  CASE
    WHEN purch.id IS NULL THEN 'NOT_PURCHASED'
    WHEN fp.id IS NULL THEN 'PURCHASED_NOT_FITTED'
    WHEN purch.part_number IS DISTINCT FROM pp.part_number THEN 'PART_NUMBER_MISMATCH'
    ELSE 'MATCHES_APPROVAL'
  END AS match_status
FROM repair_proposals rp
JOIN proposed_parts pp        ON pp.proposal_id = rp.id
LEFT JOIN owner_decisions od  ON od.case_id = rp.case_id
                              AND od.pre_service_decision IS NOT NULL
LEFT JOIN purchased_parts purch ON purch.proposed_part_id = pp.id
LEFT JOIN fitted_parts fp     ON fp.purchased_part_id = purch.id
WHERE rp.case_id = :case_id
ORDER BY pp.part_name;


-- ---------------------------------------------------------------------
-- 3. Recurring-fault detection feeding vehicle memory: components that
--    show up as the mechanic's claim across multiple closed cases for
--    the same vehicle (the raw signal vehicle_memory rows are built from).
-- ---------------------------------------------------------------------
SELECT
  v.id                       AS vehicle_id,
  v.registration_number,
  mc.component_claimed,
  COUNT(*)                   AS occurrence_count,
  MIN(rc.opened_at)          AS first_seen_at,
  MAX(rc.opened_at)          AS last_seen_at,
  array_agg(rc.id ORDER BY rc.opened_at) AS case_ids
FROM vehicles v
JOIN repair_cases rc     ON rc.vehicle_id = v.id
JOIN mechanic_claims mc  ON mc.case_id = rc.id
WHERE v.id = :vehicle_id
  AND rc.state IN ('CLOSED_ACKNOWLEDGED', 'CLOSED_DISPUTED')
GROUP BY v.id, v.registration_number, mc.component_claimed
HAVING COUNT(*) > 1
ORDER BY occurrence_count DESC, last_seen_at DESC;

-- Equivalent read from the pre-computed vehicle_memory table, once the
-- above has been materialized into it by the app layer:
-- SELECT * FROM vehicle_memory WHERE vehicle_id = :vehicle_id ORDER BY occurrence_count DESC;
