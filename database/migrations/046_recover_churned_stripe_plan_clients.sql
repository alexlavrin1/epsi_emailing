-- Extend "Stripe plan payment and cancellation recovery" to churned clients and
-- state in the agent prompt that churned clients are win-back targets.
--
-- Mirrors dashboard_update_client_playbook: bumps current_version, writes a new
-- immutable client_playbook_versions row, syncs the denormalized columns on
-- client_playbooks, and records a client.playbook.version_created audit event.
-- Idempotent: a no-op once 'churned' is already an eligible relationship state.
-- 'churned' is already permitted by client_playbooks_relationships_check, so no
-- constraint change is needed.
BEGIN;

DO $$
DECLARE
  target        client_playbooks%ROWTYPE;
  cur           client_playbook_versions%ROWTYPE;
  next_version  INTEGER;
  new_prompt    TEXT;
  new_desc      TEXT;
BEGIN
  SELECT * INTO target FROM client_playbooks
   WHERE organization_id = 'cd731734-d00f-4be0-b62d-95d05ee31d2b'
     AND name = 'Stripe plan payment and cancellation recovery'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery playbook not found'; END IF;
  IF 'churned' = ANY(target.eligible_relationship_states) THEN
    RAISE NOTICE 'churned already eligible; nothing to do';
    RETURN;
  END IF;

  SELECT * INTO cur FROM client_playbook_versions
   WHERE playbook_id = target.id AND version = target.current_version;

  next_version := target.current_version + 1;

  new_desc := 'Understand failed, unpaid, incomplete, canceled, or churned Stripe plans and offer a relevant path back or a win-back.';

  new_prompt := 'This client uses a Stripe-funded plan and the recorded subscription is canceled, past due, unpaid, incomplete, or expired. The client may still be active or may have already churned. Churned clients are recovery targets: the goal is to win them back by understanding why they left and offering a credible path to return. Review all conversation and subscription context. Ask what caused the cancellation, pause, or payment problem and whether the client wants help resuming; for a churned client, lead with re-engagement rather than assuming an ongoing relationship. Mention a smaller plan or alternative only as an option to discuss; never invent plan names, prices, discounts, payment status, or financial terms. Acknowledge prior objections and use one low-pressure question.';

  UPDATE client_playbooks SET
    description                  = new_desc,
    eligible_relationship_states = ARRAY['active','churned'],
    current_version              = next_version,
    updated_by_user_id           = target.updated_by_user_id
  WHERE id = target.id;

  INSERT INTO client_playbook_versions
    (playbook_id, version, subject_template, body_template, agent_prompt, definition, created_by_user_id)
  VALUES (
    target.id, next_version, cur.subject_template, cur.body_template, new_prompt,
    jsonb_build_object(
      'trigger',                        target.trigger_type,
      'channel',                        target.channel,
      'eligible_subscription_statuses', to_jsonb(target.eligible_subscription_statuses),
      'eligible_client_segments',       to_jsonb(target.eligible_client_segments),
      'eligible_relationship_states',   to_jsonb(ARRAY['active','churned']::text[]),
      'cooldown_days',                  target.cooldown_days,
      'approval',                       'required'
    ),
    target.updated_by_user_id
  );

  INSERT INTO audit_events
    (organization_id, actor_user_id, event_type, target_type, target_id, metadata)
  VALUES (
    target.organization_id, target.updated_by_user_id,
    'client.playbook.version_created', 'client_playbook', target.id::TEXT,
    jsonb_build_object(
      'previous_version', target.current_version,
      'version',          next_version,
      'change',           'added churned relationship state and win-back guidance'
    )
  );
END $$;

COMMIT;
