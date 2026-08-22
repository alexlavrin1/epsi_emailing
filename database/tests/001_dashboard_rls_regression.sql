-- EpsiFlow dashboard permission and RLS regression suite.
-- Run the entire file in the Supabase SQL Editor after migration 021.
-- It changes only transaction-local role/JWT settings and always rolls back.

BEGIN;

DO $$
DECLARE
  admin_membership RECORD;
  operator_membership RECORD;
BEGIN
  SELECT user_id, organization_id
    INTO admin_membership
  FROM organization_members
  WHERE role = 'admin' AND status = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF admin_membership.user_id IS NULL THEN
    RAISE EXCEPTION 'RLS TEST FAILED: an active administrator membership is required';
  END IF;

  PERFORM set_config('epsiflow.test_admin_id', admin_membership.user_id::TEXT, TRUE);
  PERFORM set_config('epsiflow.test_admin_org_id', admin_membership.organization_id::TEXT, TRUE);

  SELECT user_id, organization_id
    INTO operator_membership
  FROM organization_members
  WHERE role = 'operator' AND status = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF operator_membership.user_id IS NOT NULL THEN
    PERFORM set_config('epsiflow.test_operator_id', operator_membership.user_id::TEXT, TRUE);
    PERFORM set_config('epsiflow.test_operator_org_id', operator_membership.organization_id::TEXT, TRUE);
  END IF;
END;
$$;

-- Privilege checks do not depend on row contents.
DO $$
DECLARE
  worker_function TEXT;
  worker_signature REGPROCEDURE;
BEGIN
  IF has_table_privilege('authenticated', 'audit_events', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: authenticated can write directly to audit_events';
  END IF;
  IF has_table_privilege('authenticated', 'automation_runs', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: authenticated can write directly to automation_runs';
  END IF;
  IF has_table_privilege('authenticated', 'automation_worker_cycles', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: authenticated can write directly to automation_worker_cycles';
  END IF;
  IF has_table_privilege('authenticated', 'crm_contact_tasks', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: authenticated can write directly to crm_contact_tasks';
  END IF;
  IF has_table_privilege('authenticated', 'client_apps', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'client_contacts', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'client_email_messages', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: authenticated can write directly to existing-client tables';
  END IF;

  FOREACH worker_function IN ARRAY ARRAY[
    'enqueue_reply_automation(uuid)',
    'claim_reply_automation_run(uuid)',
    'complete_reply_automation_run(uuid,text)',
    'fail_reply_automation_run(uuid,text)',
    'claim_operator_email_reply(uuid)',
    'start_automation_worker_cycle(uuid,text)',
    'finish_automation_worker_cycle(uuid,text,text)',
    'create_reply_followup_task(uuid)',
    'service_complete_client_slack_assignment(uuid,text,text,text,text)',
    'service_fail_client_slack_assignment(uuid,text)'
  ] LOOP
    worker_signature := to_regprocedure(worker_function);
    IF worker_signature IS NULL THEN
      RAISE EXCEPTION 'RLS TEST FAILED: expected worker function % is missing', worker_function;
    END IF;
    IF has_function_privilege('anon', worker_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', worker_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'RLS TEST FAILED: browser role can execute %', worker_function;
    END IF;
    IF NOT has_function_privilege('service_role', worker_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'RLS TEST FAILED: service_role cannot execute %', worker_function;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'dashboard_is_org_member(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'dashboard_has_org_role(uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'RLS TEST FAILED: anon can execute dashboard membership helpers';
  END IF;
END;
$$;

-- Anonymous users must see no organization or tenant data.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'anon', 'aal', 'aal1')::TEXT,
  TRUE
);
SET LOCAL ROLE anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: anon can read organizations';
  END IF;
  IF EXISTS (SELECT 1 FROM prospects) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: anon can read prospects';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_events) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: anon can read audit_events';
  END IF;
  IF EXISTS (SELECT 1 FROM client_apps) OR EXISTS (SELECT 1 FROM client_contacts) OR EXISTS (SELECT 1 FROM client_email_messages) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: anon can read existing-client data';
  END IF;
END;
$$;

RESET ROLE;

-- A password-only administrator may identify their workspace for MFA routing,
-- but cannot pass tenant membership/role checks or read tenant records.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('epsiflow.test_admin_id'),
    'role', 'authenticated',
    'aal', 'aal1'
  )::TEXT,
  TRUE
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  target_org UUID := current_setting('epsiflow.test_admin_org_id')::UUID;
BEGIN
  IF dashboard_is_org_member(target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator passed member check';
  END IF;
  IF dashboard_has_org_role(target_org, ARRAY['admin']) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator passed admin check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator cannot identify own organization for MFA routing';
  END IF;
  IF EXISTS (SELECT 1 FROM prospects WHERE organization_id = target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator can read tenant prospects';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_events WHERE organization_id = target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator can read tenant audit history';
  END IF;
  IF EXISTS (SELECT 1 FROM client_apps WHERE organization_id = target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL1 administrator can read existing-client data';
  END IF;
END;
$$;

RESET ROLE;

-- The same administrator at AAL2 receives tenant access and no cross-tenant
-- organization visibility.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('epsiflow.test_admin_id'),
    'role', 'authenticated',
    'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch FROM now())::BIGINT))
  )::TEXT,
  TRUE
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  target_org UUID := current_setting('epsiflow.test_admin_org_id')::UUID;
BEGIN
  IF NOT dashboard_is_org_member(target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL2 administrator failed member check';
  END IF;
  IF NOT dashboard_has_org_role(target_org, ARRAY['admin']) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL2 administrator failed admin check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: AAL2 administrator cannot read own organization';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM organizations visible_org
    WHERE NOT EXISTS (
      SELECT 1
      FROM organization_members own_membership
      WHERE own_membership.organization_id = visible_org.id
        AND own_membership.user_id = auth.uid()
        AND own_membership.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: administrator can see a different organization';
  END IF;
  IF EXISTS (SELECT 1 FROM client_apps WHERE organization_id <> target_org)
     OR EXISTS (SELECT 1 FROM client_contacts WHERE organization_id <> target_org)
     OR EXISTS (SELECT 1 FROM client_email_messages WHERE organization_id <> target_org) THEN
    RAISE EXCEPTION 'RLS TEST FAILED: administrator can see another organization client workspace';
  END IF;
END;
$$;

RESET ROLE;

-- Operators intentionally remain valid at AAL1. Skip this assertion when the
-- workspace has no active operator account yet.
DO $$
BEGIN
  IF current_setting('epsiflow.test_operator_id', TRUE) IS NULL THEN
    RAISE NOTICE 'RLS TEST NOTICE: operator AAL1 check skipped; no active operator exists';
  ELSE
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', current_setting('epsiflow.test_operator_id'),
        'role', 'authenticated',
        'aal', 'aal1'
      )::TEXT,
      TRUE
    );
    IF NOT dashboard_is_org_member(current_setting('epsiflow.test_operator_org_id')::UUID) THEN
      RAISE EXCEPTION 'RLS TEST FAILED: AAL1 operator failed member check';
    END IF;
    IF dashboard_has_org_role(current_setting('epsiflow.test_operator_org_id')::UUID, ARRAY['admin']) THEN
      RAISE EXCEPTION 'RLS TEST FAILED: operator passed admin check';
    END IF;
  END IF;
END;
$$;

ROLLBACK;

SELECT 'EpsiFlow permission and RLS regression checks passed' AS result;
