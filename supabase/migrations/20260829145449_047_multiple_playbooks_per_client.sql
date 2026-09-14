-- Allow more than one playbook per client. Previously a single UNIQUE(client_app_id)
-- row limited each client to one assignment; drafts and automation runs are already
-- keyed by (playbook_id, client_app_id, client_contact_id, ...), so only the
-- assignment table and its assign RPC need to change. Adds an explicit unassign RPC
-- so a playbook can be detached from a client. Idempotent.
BEGIN;

ALTER TABLE client_playbook_assignments
  DROP CONSTRAINT IF EXISTS client_playbook_assignments_client_app_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_playbook_assignments_app_playbook_key'
      AND conrelid = 'public.client_playbook_assignments'::regclass
  ) THEN
    ALTER TABLE client_playbook_assignments
      ADD CONSTRAINT client_playbook_assignments_app_playbook_key UNIQUE (client_app_id, playbook_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_playbook_assignments_app_idx
  ON client_playbook_assignments(client_app_id);

-- Re-point the upsert conflict target to (client_app_id, playbook_id): re-assigning
-- the same playbook refreshes it in place; a different playbook inserts a new row.
CREATE OR REPLACE FUNCTION dashboard_assign_client_playbook(target_playbook_id UUID,target_client_app_id UUID,target_client_contact_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE playbook client_playbooks%ROWTYPE; app client_apps%ROWTYPE; assignment_id UUID; reply_delay INTEGER; followup INTEGER; periodic INTEGER;
BEGIN
  SELECT * INTO playbook FROM client_playbooks WHERE id=target_playbook_id AND status='active';
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(playbook.organization_id) THEN RAISE EXCEPTION 'Active playbook not found'; END IF;
  SELECT * INTO app FROM client_apps WHERE id=target_client_app_id AND organization_id=playbook.organization_id AND status='active' AND client_success_enabled=TRUE;
  IF NOT FOUND OR app.relationship_state='closed' OR NOT app.client_segment=ANY(playbook.eligible_client_segments) OR NOT app.relationship_state=ANY(playbook.eligible_relationship_states) THEN RAISE EXCEPTION 'Client app is not eligible'; END IF;
  IF NOT EXISTS(SELECT 1 FROM client_contacts WHERE id=target_client_contact_id AND client_app_id=app.id AND organization_id=app.organization_id) THEN RAISE EXCEPTION 'Client contact not found'; END IF;
  reply_delay:=15;
  followup:=CASE playbook.preset_key WHEN 'lead_education_manual' THEN 5 WHEN 'direct_payment_monthly' THEN 7 WHEN 'stripe_plan_recovery' THEN 7 ELSE 14 END;
  periodic:=CASE playbook.preset_key WHEN 'lead_education_manual' THEN 14 WHEN 'direct_payment_monthly' THEN 30 WHEN 'stripe_plan_recovery' THEN 14 ELSE playbook.cooldown_days END;
  INSERT INTO client_playbook_assignments(organization_id,client_app_id,client_contact_id,playbook_id,status,reply_delay_minutes,followup_days,periodic_days,assigned_by_user_id)
  VALUES(app.organization_id,app.id,target_client_contact_id,playbook.id,'active',reply_delay,followup,periodic,auth.uid())
  ON CONFLICT(client_app_id,playbook_id) DO UPDATE SET client_contact_id=EXCLUDED.client_contact_id,status='active',reply_delay_minutes=EXCLUDED.reply_delay_minutes,followup_days=EXCLUDED.followup_days,periodic_days=EXCLUDED.periodic_days,assigned_by_user_id=auth.uid()
  RETURNING id INTO assignment_id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(app.organization_id,auth.uid(),'client.playbook.assigned','client_playbook_assignment',assignment_id::TEXT,jsonb_build_object('client_app_id',app.id,'client_contact_id',target_client_contact_id,'playbook_id',playbook.id,'reply_delay_minutes',reply_delay,'followup_days',followup,'periodic_days',periodic,'status','active'));
  RETURN assignment_id;
END; $$;

-- Detach one playbook from a client. Existing drafts already prepared are left intact.
CREATE OR REPLACE FUNCTION dashboard_unassign_client_playbook(target_assignment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE assignment client_playbook_assignments%ROWTYPE;
BEGIN
  SELECT * INTO assignment FROM client_playbook_assignments WHERE id=target_assignment_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(assignment.organization_id) THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  DELETE FROM client_playbook_assignments WHERE id=assignment.id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES(assignment.organization_id,auth.uid(),'client.playbook.unassigned','client_playbook_assignment',assignment.id::TEXT,jsonb_build_object('client_app_id',assignment.client_app_id,'playbook_id',assignment.playbook_id));
END; $$;

REVOKE ALL ON FUNCTION dashboard_assign_client_playbook(UUID,UUID,UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION dashboard_unassign_client_playbook(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_unassign_client_playbook(UUID) TO authenticated;

COMMIT;
