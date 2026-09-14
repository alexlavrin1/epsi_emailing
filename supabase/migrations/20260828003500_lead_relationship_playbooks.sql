-- Make leads first-class CRM relationships and expose lead education as a
-- manual, approval-gated playbook on client-app records.
BEGIN;

ALTER TABLE client_apps DROP CONSTRAINT IF EXISTS client_apps_client_segment_check;
ALTER TABLE client_apps ADD CONSTRAINT client_apps_client_segment_check
  CHECK (client_segment IN ('lead','epsiflow_direct','stripe_plan'));

ALTER TABLE client_playbooks DROP CONSTRAINT IF EXISTS client_playbooks_segments_check;
ALTER TABLE client_playbooks ADD CONSTRAINT client_playbooks_segments_check
  CHECK (eligible_client_segments <@ ARRAY['lead','epsiflow_direct','stripe_plan']::TEXT[] AND cardinality(eligible_client_segments)>0);

DROP FUNCTION IF EXISTS dashboard_create_client_app(UUID,TEXT,TEXT,TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION dashboard_create_client_app(
  target_organization_id UUID, target_name TEXT, target_website_url TEXT,
  target_contact_name TEXT, target_contact_email TEXT, target_slack_name TEXT DEFAULT NULL,
  target_client_segment TEXT DEFAULT 'stripe_plan'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE new_app_id UUID; normalized_email TEXT; normalized_slack TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_is_org_member(target_organization_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  normalized_email:=LOWER(trim(COALESCE(target_contact_email,'')));
  normalized_slack:=NULLIF(trim(COALESCE(target_slack_name,'')),'');
  IF target_client_segment NOT IN ('lead','epsiflow_direct','stripe_plan') THEN RAISE EXCEPTION 'Invalid relationship type'; END IF;
  IF char_length(trim(COALESCE(target_name,''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Invalid client app name'; END IF;
  IF char_length(COALESCE(target_website_url,''))>2048 OR trim(COALESCE(target_website_url,'')) !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Invalid client website'; END IF;
  IF char_length(trim(COALESCE(target_contact_name,''))) NOT BETWEEN 1 AND 160 OR normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid client contact'; END IF;
  IF normalized_slack IS NOT NULL AND char_length(normalized_slack)>120 THEN RAISE EXCEPTION 'Invalid Slack name'; END IF;
  INSERT INTO client_apps(organization_id,name,website_url,client_segment,created_by_user_id)
  VALUES(target_organization_id,trim(target_name),trim(target_website_url),target_client_segment,auth.uid()) RETURNING id INTO new_app_id;
  INSERT INTO client_contacts(organization_id,client_app_id,name,email,slack_name,slack_assignment_status,created_by_user_id)
  VALUES(target_organization_id,new_app_id,trim(target_contact_name),normalized_email,normalized_slack,CASE WHEN normalized_slack IS NULL THEN 'unassigned' ELSE 'pending' END,auth.uid());
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES(target_organization_id,auth.uid(),'client.app.created','client_app',new_app_id::TEXT,jsonb_build_object('contact_count',1,'slack_requested',normalized_slack IS NOT NULL,'client_segment',target_client_segment));
  RETURN new_app_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A client app or contact with these details already exists';
END; $$;

CREATE OR REPLACE FUNCTION dashboard_set_client_relationship(target_client_app_id UUID,target_client_segment TEXT,target_relationship_state TEXT,target_client_success_enabled BOOLEAN,target_relationship_note TEXT DEFAULT '')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_apps%ROWTYPE;
BEGIN
  SELECT * INTO target FROM client_apps WHERE id=target_client_app_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_is_org_member(target.organization_id) THEN RAISE EXCEPTION 'Client app not found'; END IF;
  IF target_client_segment NOT IN ('lead','epsiflow_direct','stripe_plan') OR target_relationship_state NOT IN ('active','churned','closed') OR char_length(COALESCE(target_relationship_note,''))>1000 THEN RAISE EXCEPTION 'Invalid relationship state'; END IF;
  IF target_relationship_state='closed' THEN target_client_success_enabled:=FALSE; END IF;
  UPDATE client_apps SET client_segment=target_client_segment,relationship_state=target_relationship_state,client_success_enabled=target_client_success_enabled,relationship_note=trim(COALESCE(target_relationship_note,'')) WHERE id=target_client_app_id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata)
  VALUES(target.organization_id,auth.uid(),'client.relationship.updated','client_app',target.id::TEXT,jsonb_build_object('previous_segment',target.client_segment,'segment',target_client_segment,'previous_state',target.relationship_state,'state',target_relationship_state,'client_success_enabled',target_client_success_enabled));
END; $$;

CREATE OR REPLACE FUNCTION dashboard_create_client_playbook(target_organization_id UUID,target_name TEXT,target_description TEXT,target_channel TEXT,target_trigger_type TEXT,target_eligible_statuses TEXT[],target_eligible_segments TEXT[],target_eligible_relationships TEXT[],target_cooldown_days INTEGER,target_subject_template TEXT,target_body_template TEXT,target_agent_prompt TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE new_id UUID; normalized_subject TEXT; clean_template TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id,ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF char_length(trim(COALESCE(target_name,''))) NOT BETWEEN 3 AND 120 OR char_length(COALESCE(target_description,''))>500 OR target_channel NOT IN ('email','slack') OR target_trigger_type NOT IN ('manual_client_checkin','scheduled_checkin','stripe_cancellation','churn_reactivation') THEN RAISE EXCEPTION 'Invalid playbook identity'; END IF;
  IF NOT COALESCE(target_eligible_statuses,'{}') <@ ARRAY['none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']::TEXT[] OR NOT COALESCE(target_eligible_segments,'{}') <@ ARRAY['lead','epsiflow_direct','stripe_plan']::TEXT[] OR cardinality(target_eligible_segments)=0 OR NOT COALESCE(target_eligible_relationships,'{}') <@ ARRAY['active','churned']::TEXT[] OR cardinality(target_eligible_relationships)=0 OR target_cooldown_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Invalid playbook conditions'; END IF;
  normalized_subject:=NULLIF(trim(COALESCE(target_subject_template,'')),''); IF target_channel='email' AND (normalized_subject IS NULL OR char_length(normalized_subject)>998) THEN RAISE EXCEPTION 'Email playbooks require a subject'; END IF; IF target_channel='slack' THEN normalized_subject:=NULL; END IF;
  IF char_length(trim(COALESCE(target_body_template,''))) NOT BETWEEN 1 AND 10000 OR char_length(trim(COALESCE(target_agent_prompt,''))) NOT BETWEEN 20 AND 12000 THEN RAISE EXCEPTION 'Invalid playbook content'; END IF;
  clean_template:=COALESCE(normalized_subject,'')||target_body_template; clean_template:=replace(replace(replace(replace(replace(replace(clean_template,'{{clientName}}',''),'{{contactName}}',''),'{{contactFirstName}}',''),'{{subscriptionStatus}}',''),'{{productName}}',''),'{{billingInterval}}',''); IF clean_template ~ '\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Unsupported template variable'; END IF;
  INSERT INTO client_playbooks(organization_id,name,description,channel,trigger_type,eligible_subscription_statuses,eligible_client_segments,eligible_relationship_states,cooldown_days,created_by_user_id,updated_by_user_id) VALUES(target_organization_id,trim(target_name),trim(COALESCE(target_description,'')),target_channel,target_trigger_type,COALESCE(target_eligible_statuses,'{}'),target_eligible_segments,target_eligible_relationships,target_cooldown_days,auth.uid(),auth.uid()) RETURNING id INTO new_id;
  INSERT INTO client_playbook_versions(playbook_id,version,subject_template,body_template,agent_prompt,definition,created_by_user_id) VALUES(new_id,1,normalized_subject,trim(target_body_template),trim(target_agent_prompt),jsonb_build_object('trigger',target_trigger_type,'channel',target_channel,'eligible_subscription_statuses',COALESCE(target_eligible_statuses,'{}'),'eligible_client_segments',target_eligible_segments,'eligible_relationship_states',target_eligible_relationships,'cooldown_days',target_cooldown_days,'approval','required'),auth.uid());
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(target_organization_id,auth.uid(),'client.playbook.created','client_playbook',new_id::TEXT,jsonb_build_object('version',1,'status','draft','channel',target_channel,'trigger',target_trigger_type)); RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A playbook with this name already exists'; END; $$;

CREATE OR REPLACE FUNCTION dashboard_update_client_playbook(target_playbook_id UUID,target_name TEXT,target_description TEXT,target_channel TEXT,target_trigger_type TEXT,target_eligible_statuses TEXT[],target_eligible_segments TEXT[],target_eligible_relationships TEXT[],target_cooldown_days INTEGER,target_subject_template TEXT,target_body_template TEXT,target_agent_prompt TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target client_playbooks%ROWTYPE; next_version INTEGER; normalized_subject TEXT; clean_template TEXT;
BEGIN
  SELECT * INTO target FROM client_playbooks WHERE id=target_playbook_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT dashboard_has_org_role(target.organization_id,ARRAY['admin']) THEN RAISE EXCEPTION 'Playbook not found'; END IF;
  IF target.status='active' THEN RAISE EXCEPTION 'Pause the playbook before editing'; END IF;
  IF char_length(trim(COALESCE(target_name,''))) NOT BETWEEN 3 AND 120 OR char_length(COALESCE(target_description,''))>500 OR target_channel NOT IN ('email','slack') OR target_trigger_type NOT IN ('manual_client_checkin','scheduled_checkin','stripe_cancellation','churn_reactivation') THEN RAISE EXCEPTION 'Invalid playbook identity'; END IF;
  IF NOT COALESCE(target_eligible_statuses,'{}') <@ ARRAY['none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']::TEXT[] OR NOT COALESCE(target_eligible_segments,'{}') <@ ARRAY['lead','epsiflow_direct','stripe_plan']::TEXT[] OR cardinality(target_eligible_segments)=0 OR NOT COALESCE(target_eligible_relationships,'{}') <@ ARRAY['active','churned']::TEXT[] OR cardinality(target_eligible_relationships)=0 OR target_cooldown_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Invalid playbook conditions'; END IF;
  normalized_subject:=NULLIF(trim(COALESCE(target_subject_template,'')),''); IF target_channel='email' AND (normalized_subject IS NULL OR char_length(normalized_subject)>998) THEN RAISE EXCEPTION 'Email playbooks require a subject'; END IF; IF target_channel='slack' THEN normalized_subject:=NULL; END IF;
  IF char_length(trim(COALESCE(target_body_template,''))) NOT BETWEEN 1 AND 10000 OR char_length(trim(COALESCE(target_agent_prompt,''))) NOT BETWEEN 20 AND 12000 THEN RAISE EXCEPTION 'Invalid playbook content'; END IF;
  clean_template:=COALESCE(normalized_subject,'')||target_body_template; clean_template:=replace(replace(replace(replace(replace(replace(clean_template,'{{clientName}}',''),'{{contactName}}',''),'{{contactFirstName}}',''),'{{subscriptionStatus}}',''),'{{productName}}',''),'{{billingInterval}}',''); IF clean_template ~ '\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Unsupported template variable'; END IF;
  next_version:=target.current_version+1;
  UPDATE client_playbooks SET name=trim(target_name),description=trim(COALESCE(target_description,'')),channel=target_channel,trigger_type=target_trigger_type,eligible_subscription_statuses=COALESCE(target_eligible_statuses,'{}'),eligible_client_segments=target_eligible_segments,eligible_relationship_states=target_eligible_relationships,cooldown_days=target_cooldown_days,current_version=next_version,updated_by_user_id=auth.uid() WHERE id=target_playbook_id;
  INSERT INTO client_playbook_versions(playbook_id,version,subject_template,body_template,agent_prompt,definition,created_by_user_id) VALUES(target_playbook_id,next_version,normalized_subject,trim(target_body_template),trim(target_agent_prompt),jsonb_build_object('trigger',target_trigger_type,'channel',target_channel,'eligible_subscription_statuses',COALESCE(target_eligible_statuses,'{}'),'eligible_client_segments',target_eligible_segments,'eligible_relationship_states',target_eligible_relationships,'cooldown_days',target_cooldown_days,'approval','required'),auth.uid());
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(target.organization_id,auth.uid(),'client.playbook.version_created','client_playbook',target_playbook_id::TEXT,jsonb_build_object('previous_version',target.current_version,'version',next_version)); RETURN next_version;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A playbook with this name already exists'; END; $$;

DO $seed$
DECLARE org RECORD; admin_id UUID; source_status TEXT; source_body TEXT; source_prompt TEXT; new_id UUID;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    SELECT user_id INTO admin_id FROM organization_members WHERE organization_id=org.id AND role='admin' AND status='active' ORDER BY created_at LIMIT 1;
    IF admin_id IS NULL THEN CONTINUE; END IF;
    SELECT workflow.status,version.body_template,version.agent_prompt INTO source_status,source_body,source_prompt
      FROM automation_workflows workflow JOIN automation_workflow_versions version ON version.workflow_id=workflow.id AND version.version=workflow.current_version
      WHERE workflow.organization_id=org.id AND workflow.preset_key='lead_education_reply' LIMIT 1;
    INSERT INTO client_playbooks(organization_id,name,description,channel,trigger_type,eligible_subscription_statuses,eligible_client_segments,eligible_relationship_states,cooldown_days,status,preset_key,created_by_user_id,updated_by_user_id)
      VALUES(org.id,'New lead education and onboarding','Answer lead questions about EpsiFlow, onboarding, and available options using the full synchronized conversation.','email','manual_client_checkin','{}',ARRAY['lead'],ARRAY['active'],14,COALESCE(source_status,'draft'),'lead_education_manual',admin_id,admin_id)
      ON CONFLICT DO NOTHING RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN
      INSERT INTO client_playbook_versions(playbook_id,version,subject_template,body_template,agent_prompt,definition,created_by_user_id)
      VALUES(new_id,1,'Your EpsiFlow questions, {{clientName}}',replace(replace(COALESCE(source_body,E'Hi {{contactFirstName}},\n\nThanks for your interest in EpsiFlow. I can explain the setup and next steps based on what {{clientName}} needs. What would be most useful to clarify first?\n\nBest,\nEpsiFlow'),'{{firstName}}','{{contactFirstName}}'),'{{company}}','{{clientName}}'),COALESCE(NULLIF(source_prompt,''),'Review the complete lead conversation and answer the latest question directly. Explain EpsiFlow accurately, avoid unsupported claims, and end with one relevant low-friction next step.'),jsonb_build_object('trigger','manual_client_checkin','channel','email','eligible_client_segments',ARRAY['lead'],'eligible_relationship_states',ARRAY['active'],'cooldown_days',14,'approval','required','source_preset','lead_education_reply'),admin_id);
    END IF;
    source_status:=NULL; source_body:=NULL; source_prompt:=NULL; new_id:=NULL;
  END LOOP;
END $seed$;

REVOKE ALL ON FUNCTION dashboard_create_client_app(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_set_client_relationship(UUID,TEXT,TEXT,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_update_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_app(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_set_client_relationship(UUID,TEXT,TEXT,BOOLEAN,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_update_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT,TEXT) TO authenticated;

COMMIT;
