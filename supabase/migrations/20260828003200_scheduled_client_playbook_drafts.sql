-- Disabled-by-default scheduled client-success draft preparation.
BEGIN;

ALTER TABLE client_playbooks DROP CONSTRAINT IF EXISTS client_playbooks_trigger_type_check;
ALTER TABLE client_playbooks ADD CONSTRAINT client_playbooks_trigger_type_check CHECK (trigger_type IN ('manual_client_checkin','scheduled_checkin','stripe_cancellation','churn_reactivation'));
ALTER TABLE client_playbooks ADD COLUMN IF NOT EXISTS eligible_client_segments TEXT[] NOT NULL DEFAULT ARRAY['epsiflow_direct','stripe_plan']::TEXT[], ADD COLUMN IF NOT EXISTS eligible_relationship_states TEXT[] NOT NULL DEFAULT ARRAY['active']::TEXT[], ADD COLUMN IF NOT EXISTS cooldown_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE client_playbooks DROP CONSTRAINT IF EXISTS client_playbooks_segments_check;
ALTER TABLE client_playbooks ADD CONSTRAINT client_playbooks_segments_check CHECK (eligible_client_segments <@ ARRAY['epsiflow_direct','stripe_plan']::TEXT[] AND cardinality(eligible_client_segments)>0);
ALTER TABLE client_playbooks DROP CONSTRAINT IF EXISTS client_playbooks_relationships_check;
ALTER TABLE client_playbooks ADD CONSTRAINT client_playbooks_relationships_check CHECK (eligible_relationship_states <@ ARRAY['active','churned']::TEXT[] AND cardinality(eligible_relationship_states)>0);
ALTER TABLE client_playbooks DROP CONSTRAINT IF EXISTS client_playbooks_cooldown_check;
ALTER TABLE client_playbooks ADD CONSTRAINT client_playbooks_cooldown_check CHECK (cooldown_days BETWEEN 1 AND 365);

ALTER TABLE client_playbook_drafts ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'template', ADD COLUMN IF NOT EXISTS context_message_count INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS context_latest_message_at TIMESTAMPTZ;
ALTER TABLE client_playbook_drafts DROP CONSTRAINT IF EXISTS client_playbook_drafts_generation_mode_check;
ALTER TABLE client_playbook_drafts ADD CONSTRAINT client_playbook_drafts_generation_mode_check CHECK (generation_mode IN ('template','agent'));

CREATE TABLE IF NOT EXISTS client_playbook_automation_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 playbook_id UUID NOT NULL REFERENCES client_playbooks(id) ON DELETE RESTRICT, playbook_version INTEGER NOT NULL,
 client_app_id UUID NOT NULL, client_contact_id UUID NOT NULL, trigger_key TEXT NOT NULL CHECK (char_length(trigger_key) BETWEEN 1 AND 300),
 status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','drafted','skipped','failed')), draft_id UUID REFERENCES client_playbook_drafts(id) ON DELETE SET NULL,
 context_message_count INTEGER NOT NULL DEFAULT 0, failure_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
 FOREIGN KEY (playbook_id,playbook_version) REFERENCES client_playbook_versions(playbook_id,version) ON DELETE RESTRICT,
 FOREIGN KEY (client_app_id,organization_id) REFERENCES client_apps(id,organization_id) ON DELETE CASCADE,
 FOREIGN KEY (client_contact_id,organization_id) REFERENCES client_contacts(id,organization_id) ON DELETE CASCADE,
 UNIQUE (playbook_id,client_app_id,client_contact_id,trigger_key)
);
CREATE INDEX IF NOT EXISTS client_playbook_automation_runs_org_status_created_idx ON client_playbook_automation_runs(organization_id,status,created_at DESC);
ALTER TABLE client_playbook_automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_playbook_automation_runs_member_read ON client_playbook_automation_runs;
CREATE POLICY client_playbook_automation_runs_member_read ON client_playbook_automation_runs FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON client_playbook_automation_runs FROM authenticated,anon;
GRANT SELECT ON client_playbook_automation_runs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON client_playbook_automation_runs TO service_role;

DROP FUNCTION IF EXISTS dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT[],TEXT,TEXT);
CREATE OR REPLACE FUNCTION dashboard_create_client_playbook(target_organization_id UUID,target_name TEXT,target_description TEXT,target_channel TEXT,target_trigger_type TEXT,target_eligible_statuses TEXT[],target_eligible_segments TEXT[],target_eligible_relationships TEXT[],target_cooldown_days INTEGER,target_subject_template TEXT,target_body_template TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE new_id UUID; normalized_subject TEXT; clean_template TEXT;
BEGIN
 IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id,ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 IF char_length(trim(COALESCE(target_name,''))) NOT BETWEEN 3 AND 120 OR char_length(COALESCE(target_description,''))>500 OR target_channel NOT IN ('email','slack') OR target_trigger_type NOT IN ('manual_client_checkin','scheduled_checkin','stripe_cancellation','churn_reactivation') THEN RAISE EXCEPTION 'Invalid playbook identity'; END IF;
 IF NOT COALESCE(target_eligible_statuses,'{}') <@ ARRAY['none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']::TEXT[] OR NOT COALESCE(target_eligible_segments,'{}') <@ ARRAY['epsiflow_direct','stripe_plan']::TEXT[] OR cardinality(target_eligible_segments)=0 OR NOT COALESCE(target_eligible_relationships,'{}') <@ ARRAY['active','churned']::TEXT[] OR cardinality(target_eligible_relationships)=0 OR target_cooldown_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Invalid playbook conditions'; END IF;
 normalized_subject:=NULLIF(trim(COALESCE(target_subject_template,'')),''); IF target_channel='email' AND (normalized_subject IS NULL OR char_length(normalized_subject)>998) THEN RAISE EXCEPTION 'Email playbooks require a subject'; END IF; IF target_channel='slack' THEN normalized_subject:=NULL; END IF;
 IF char_length(trim(COALESCE(target_body_template,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid playbook body'; END IF;
 clean_template:=COALESCE(normalized_subject,'')||target_body_template; clean_template:=replace(replace(replace(replace(replace(replace(clean_template,'{{clientName}}',''),'{{contactName}}',''),'{{contactFirstName}}',''),'{{subscriptionStatus}}',''),'{{productName}}',''),'{{billingInterval}}',''); IF clean_template ~ '\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Unsupported template variable'; END IF;
 INSERT INTO client_playbooks (organization_id,name,description,channel,trigger_type,eligible_subscription_statuses,eligible_client_segments,eligible_relationship_states,cooldown_days,created_by_user_id,updated_by_user_id) VALUES (target_organization_id,trim(target_name),trim(COALESCE(target_description,'')),target_channel,target_trigger_type,COALESCE(target_eligible_statuses,'{}'),target_eligible_segments,target_eligible_relationships,target_cooldown_days,auth.uid(),auth.uid()) RETURNING id INTO new_id;
 INSERT INTO client_playbook_versions (playbook_id,version,subject_template,body_template,definition,created_by_user_id) VALUES (new_id,1,normalized_subject,trim(target_body_template),jsonb_build_object('trigger',target_trigger_type,'channel',target_channel,'eligible_subscription_statuses',COALESCE(target_eligible_statuses,'{}'),'eligible_client_segments',target_eligible_segments,'eligible_relationship_states',target_eligible_relationships,'cooldown_days',target_cooldown_days,'approval','required'),auth.uid());
 INSERT INTO audit_events (organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES (target_organization_id,auth.uid(),'client.playbook.created','client_playbook',new_id::TEXT,jsonb_build_object('version',1,'status','draft','channel',target_channel,'trigger',target_trigger_type)); RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A playbook with this name already exists'; END; $$;

CREATE OR REPLACE FUNCTION service_prepare_due_client_playbook_drafts(target_limit INTEGER DEFAULT 10) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item RECORD; run_id UUID; draft_id UUID; trigger_key TEXT; rendered_subject TEXT; rendered_body TEXT; context_count INTEGER; context_latest TIMESTAMPTZ; drafted INTEGER:=0; skipped INTEGER:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF; IF target_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 FOR item IN SELECT p.*,a.id app_id,a.name app_name,a.organization_id app_org,a.client_segment,a.relationship_state,c.id contact_id,c.name contact_name,c.email,c.slack_assignment_status,COALESCE(s.status,'none') subscription_status,COALESCE(s.product_name,s.price_nickname,'your subscription') product_name,COALESCE(s.billing_interval,'not available') billing_interval,s.id subscription_id,s.canceled_at,v.subject_template,v.body_template
  FROM client_playbooks p JOIN automation_runtime_controls control ON control.organization_id=p.organization_id AND control.globally_paused=FALSE JOIN client_apps a ON a.organization_id=p.organization_id AND a.status='active' AND a.client_success_enabled=TRUE JOIN LATERAL (SELECT * FROM client_contacts cc WHERE cc.client_app_id=a.id ORDER BY cc.created_at LIMIT 1) c ON TRUE LEFT JOIN LATERAL (SELECT * FROM client_subscriptions cs WHERE cs.client_app_id=a.id ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,synced_at DESC LIMIT 1) s ON TRUE JOIN client_playbook_versions v ON v.playbook_id=p.id AND v.version=p.current_version
  WHERE p.status='active' AND p.trigger_type<>'manual_client_checkin' AND a.client_segment=ANY(p.eligible_client_segments) AND a.relationship_state=ANY(p.eligible_relationship_states) AND (cardinality(p.eligible_subscription_statuses)=0 OR COALESCE(s.status,'none')=ANY(p.eligible_subscription_statuses)) AND (p.channel='email' OR c.slack_assignment_status IN ('assigned','linked')) AND (p.trigger_type<>'stripe_cancellation' OR s.status='canceled') AND (p.trigger_type<>'churn_reactivation' OR a.relationship_state='churned')
   AND (p.trigger_type='stripe_cancellation' OR NOT EXISTS (SELECT 1 FROM client_playbook_automation_runs recent WHERE recent.playbook_id=p.id AND recent.client_app_id=a.id AND recent.client_contact_id=c.id AND recent.status='drafted' AND recent.created_at>NOW()-make_interval(days=>p.cooldown_days)))
  ORDER BY a.updated_at LIMIT target_limit
 LOOP
  trigger_key:=CASE WHEN item.trigger_type='stripe_cancellation' THEN 'stripe-cancellation:'||COALESCE(item.subscription_id::TEXT,'none')||':'||COALESCE(item.canceled_at::TEXT,'unknown') ELSE item.trigger_type||':'||floor(extract(epoch FROM NOW())/(item.cooldown_days*86400))::BIGINT::TEXT END;
  INSERT INTO client_playbook_automation_runs (organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key) VALUES (item.organization_id,item.id,item.current_version,item.app_id,item.contact_id,trigger_key) ON CONFLICT DO NOTHING RETURNING id INTO run_id;
  IF run_id IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
  SELECT COUNT(*),MAX(occurred_at) INTO context_count,context_latest FROM client_email_messages WHERE organization_id=item.organization_id AND client_app_id=item.app_id;
  rendered_subject:=item.subject_template; rendered_body:=item.body_template;
  rendered_subject:=replace(replace(replace(replace(replace(replace(COALESCE(rendered_subject,''),'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
  rendered_body:=replace(replace(replace(replace(replace(replace(rendered_body,'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
  BEGIN
   INSERT INTO client_playbook_drafts (organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id,generation_mode,context_message_count,context_latest_message_at) VALUES (item.organization_id,item.id,item.current_version,item.app_id,item.contact_id,item.subscription_id,item.channel,CASE WHEN item.channel='email' THEN item.email ELSE item.contact_name END,NULLIF(rendered_subject,''),rendered_body,item.created_by_user_id,'template',context_count,context_latest) RETURNING id INTO draft_id;
   UPDATE client_playbook_automation_runs SET status='drafted',draft_id=draft_id,context_message_count=context_count,completed_at=NOW() WHERE id=run_id; drafted:=drafted+1;
   INSERT INTO audit_events (organization_id,event_type,target_type,target_id,metadata) VALUES (item.organization_id,'client.playbook.automatic_draft_created','client_playbook_draft',draft_id::TEXT,jsonb_build_object('client_app_id',item.app_id,'playbook_id',item.id,'trigger',item.trigger_type,'context_message_count',context_count,'status','draft'));
  EXCEPTION WHEN unique_violation THEN UPDATE client_playbook_automation_runs SET status='skipped',failure_code='open_draft_exists',completed_at=NOW() WHERE id=run_id; skipped:=skipped+1; END;
  run_id:=NULL; draft_id:=NULL;
 END LOOP; RETURN jsonb_build_object('drafted',drafted,'skipped',skipped);
END; $$;

REVOKE ALL ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook(UUID,TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[],TEXT[],INTEGER,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION dashboard_retention_preview(target_organization_id UUID)
RETURNS TABLE(category TEXT, retention_days INTEGER, enabled BOOLEAN, eligible_rows BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT dashboard_has_org_role(target_organization_id, ARRAY['admin']) THEN RAISE EXCEPTION 'Administrator AAL2 access required'; END IF;
 RETURN QUERY SELECT policy.category,policy.retention_days,policy.enabled,
  CASE policy.category
   WHEN 'automation_history' THEN
    (SELECT COUNT(*) FROM automation_runs WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days))
    +(SELECT COUNT(*) FROM client_playbook_automation_runs WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days))
   WHEN 'worker_monitoring' THEN (SELECT COUNT(*) FROM automation_worker_cycles WHERE organization_id=target_organization_id AND started_at<NOW()-make_interval(days=>policy.retention_days))
   WHEN 'email_content' THEN
    (SELECT COUNT(*) FROM prospect_replies reply JOIN campaigns campaign ON campaign.id=reply.campaign_id WHERE campaign.organization_id=target_organization_id AND COALESCE(reply.received_at,reply.created_at)<NOW()-make_interval(days=>policy.retention_days))
    +(SELECT COUNT(*) FROM operator_email_replies WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days))
    +(SELECT COUNT(*) FROM client_email_messages WHERE organization_id=target_organization_id AND occurred_at<NOW()-make_interval(days=>policy.retention_days))
    +(SELECT COUNT(*) FROM client_playbook_drafts WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days))
   WHEN 'crm_notes' THEN (SELECT COUNT(*) FROM crm_contact_notes WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days))
   WHEN 'audit_history' THEN (SELECT COUNT(*) FROM audit_events WHERE organization_id=target_organization_id AND created_at<NOW()-make_interval(days=>policy.retention_days)) ELSE 0 END::BIGINT
 FROM data_retention_policies policy WHERE policy.organization_id=target_organization_id ORDER BY policy.category;
END; $$;
COMMIT;
