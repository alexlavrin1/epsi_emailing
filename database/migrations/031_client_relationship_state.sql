BEGIN;
ALTER TABLE client_apps ADD COLUMN IF NOT EXISTS client_segment TEXT NOT NULL DEFAULT 'stripe_plan', ADD COLUMN IF NOT EXISTS relationship_state TEXT NOT NULL DEFAULT 'active', ADD COLUMN IF NOT EXISTS client_success_enabled BOOLEAN NOT NULL DEFAULT TRUE, ADD COLUMN IF NOT EXISTS relationship_note TEXT NOT NULL DEFAULT '';
ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_client_segment_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_client_segment_check CHECK (client_segment IN ('epsiflow_direct','stripe_plan'));
ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_relationship_state_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_relationship_state_check CHECK (relationship_state IN ('active','churned','closed'));
ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_relationship_note_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_relationship_note_check CHECK (char_length(relationship_note) <= 1000);
CREATE INDEX IF NOT EXISTS idx_client_apps_org_relationship ON client_apps (organization_id, relationship_state, client_success_enabled, updated_at DESC);
CREATE OR REPLACE FUNCTION dashboard_set_client_relationship(target_client_app_id UUID,target_client_segment TEXT,target_relationship_state TEXT,target_client_success_enabled BOOLEAN,target_relationship_note TEXT DEFAULT '') RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_apps%ROWTYPE;
BEGIN
 SELECT * INTO target FROM client_apps WHERE id=target_client_app_id FOR UPDATE;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Client app not found'; END IF;
 IF target_client_segment NOT IN ('epsiflow_direct','stripe_plan') OR target_relationship_state NOT IN ('active','churned','closed') OR char_length(COALESCE(target_relationship_note,''))>1000 THEN RAISE EXCEPTION 'Invalid relationship state'; END IF;
 IF target_relationship_state='closed' THEN target_client_success_enabled:=FALSE; END IF;
 UPDATE client_apps SET client_segment=target_client_segment,relationship_state=target_relationship_state,client_success_enabled=target_client_success_enabled,relationship_note=trim(COALESCE(target_relationship_note,'')) WHERE id=target_client_app_id;
 INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES (target.organization_id,auth.uid(),'client.relationship.updated','client_app',target.id::TEXT,jsonb_build_object('previous_segment',target.client_segment,'segment',target_client_segment,'previous_state',target.relationship_state,'state',target_relationship_state,'client_success_enabled',target_client_success_enabled));
END; $$;
REVOKE ALL ON FUNCTION dashboard_set_client_relationship(UUID,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_client_relationship(UUID,TEXT,TEXT,BOOLEAN,TEXT) TO authenticated;
COMMIT;
