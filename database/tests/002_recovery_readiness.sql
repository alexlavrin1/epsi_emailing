-- Run this rollback-only suite in a separately restored Supabase project.
-- It reads schema/catalog metadata and aggregate relationships only.
BEGIN;

DO $$
DECLARE expected_table TEXT; expected_function TEXT; rls_enabled BOOLEAN;
BEGIN
  FOREACH expected_table IN ARRAY ARRAY[
    'organizations', 'organization_members', 'audit_events', 'prospects', 'campaigns',
    'prospect_replies', 'crm_customers', 'crm_contact_notes', 'crm_contact_tasks',
    'payment_recovery_cases', 'automation_workflows', 'automation_runs',
    'automation_worker_cycles', 'data_retention_policies'
  ] LOOP
    IF to_regclass('public.' || expected_table) IS NULL THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: table % is missing', expected_table; END IF;
    SELECT relrowsecurity INTO rls_enabled FROM pg_class WHERE oid = to_regclass('public.' || expected_table);
    IF NOT rls_enabled THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: RLS is disabled on %', expected_table; END IF;
  END LOOP;

  FOREACH expected_function IN ARRAY ARRAY[
    'dashboard_is_org_member(uuid)', 'dashboard_has_org_role(uuid,text[])',
    'dashboard_set_automation_pause(uuid,boolean,text)', 'claim_reply_automation_run(uuid)',
    'dashboard_record_data_export(uuid,text,integer,boolean)'
  ] LOOP
    IF to_regprocedure(expected_function) IS NULL THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: function % is missing', expected_function; END IF;
  END LOOP;

  IF has_function_privilege('anon', 'dashboard_is_org_member(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: anon membership helper access was restored incorrectly'; END IF;
  IF has_function_privilege('authenticated', 'claim_reply_automation_run(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: browser worker access was restored incorrectly'; END IF;
  IF NOT has_function_privilege('service_role', 'claim_reply_automation_run(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: service worker access is missing'; END IF;
END; $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: no organization data was restored'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_members WHERE role = 'admin' AND status = 'active') THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: no active administrator was restored'; END IF;
  IF EXISTS (SELECT 1 FROM organization_members member LEFT JOIN organizations organization ON organization.id = member.organization_id WHERE organization.id IS NULL) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: orphan organization membership'; END IF;
  IF EXISTS (SELECT 1 FROM crm_contact_notes note LEFT JOIN prospects prospect ON note.contact_kind = 'prospect' AND prospect.id = note.contact_id LEFT JOIN crm_customers customer ON note.contact_kind = 'customer' AND customer.id = note.contact_id WHERE prospect.id IS NULL AND customer.id IS NULL) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: orphan CRM note'; END IF;
  IF EXISTS (SELECT 1 FROM crm_contact_tasks task LEFT JOIN prospects prospect ON task.contact_kind = 'prospect' AND prospect.id = task.contact_id LEFT JOIN crm_customers customer ON task.contact_kind = 'customer' AND customer.id = task.contact_id WHERE prospect.id IS NULL AND customer.id IS NULL) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: orphan CRM task'; END IF;
  IF EXISTS (SELECT 1 FROM payment_recovery_cases recovery LEFT JOIN crm_customers customer ON customer.id = recovery.crm_customer_id WHERE customer.id IS NULL) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: orphan recovery case'; END IF;
  IF EXISTS (SELECT 1 FROM organizations organization WHERE (SELECT COUNT(*) FROM data_retention_policies policy WHERE policy.organization_id = organization.id) <> 5) THEN RAISE EXCEPTION 'RECOVERY TEST FAILED: retention policy seed is incomplete'; END IF;
END; $$;

ROLLBACK;
SELECT 'EpsiFlow restored-project readiness checks passed' AS result;
