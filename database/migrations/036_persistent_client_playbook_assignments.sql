-- Persistent per-client playbook assignments with reply, follow-up, and
-- periodic-review signals. Every result remains an approval-only draft.
BEGIN;

CREATE TABLE IF NOT EXISTS client_playbook_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_app_id UUID NOT NULL,
  client_contact_id UUID NOT NULL,
  playbook_id UUID NOT NULL REFERENCES client_playbooks(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  reply_delay_minutes INTEGER NOT NULL CHECK (reply_delay_minutes BETWEEN 0 AND 10080),
  followup_days INTEGER NOT NULL CHECK (followup_days BETWEEN 1 AND 90),
  periodic_days INTEGER NOT NULL CHECK (periodic_days BETWEEN 1 AND 365),
  last_evaluated_at TIMESTAMPTZ,
  last_draft_at TIMESTAMPTZ,
  last_trigger_kind TEXT CHECK (last_trigger_kind IS NULL OR last_trigger_kind IN ('manual','reply','followup','periodic')),
  assigned_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_app_id,organization_id) REFERENCES client_apps(id,organization_id) ON DELETE CASCADE,
  FOREIGN KEY (client_contact_id,organization_id) REFERENCES client_contacts(id,organization_id) ON DELETE CASCADE,
  UNIQUE (client_app_id)
);
CREATE INDEX IF NOT EXISTS client_playbook_assignments_org_status_idx ON client_playbook_assignments(organization_id,status,updated_at DESC);
DROP TRIGGER IF EXISTS client_playbook_assignments_touch_updated_at ON client_playbook_assignments;
CREATE TRIGGER client_playbook_assignments_touch_updated_at BEFORE UPDATE ON client_playbook_assignments FOR EACH ROW EXECUTE FUNCTION dashboard_touch_updated_at();
ALTER TABLE client_playbook_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_playbook_assignments_member_read ON client_playbook_assignments;
CREATE POLICY client_playbook_assignments_member_read ON client_playbook_assignments FOR SELECT TO authenticated USING (dashboard_is_org_member(organization_id));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON client_playbook_assignments FROM authenticated,anon;
GRANT SELECT ON client_playbook_assignments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON client_playbook_assignments TO service_role;

CREATE OR REPLACE FUNCTION dashboard_client_playbook_assignments_ready() RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT auth.uid() IS NOT NULL; $$;

-- Preserve the most recently chosen playbook/contact for records that already
-- have a draft from the former one-shot picker.
INSERT INTO client_playbook_assignments(organization_id,client_app_id,client_contact_id,playbook_id,status,reply_delay_minutes,followup_days,periodic_days,last_draft_at,last_trigger_kind,assigned_by_user_id)
SELECT DISTINCT ON (draft.client_app_id) draft.organization_id,draft.client_app_id,draft.client_contact_id,draft.playbook_id,'active',15,
  CASE playbook.preset_key WHEN 'lead_education_manual' THEN 5 WHEN 'direct_payment_monthly' THEN 7 WHEN 'stripe_plan_recovery' THEN 7 ELSE 14 END,
  CASE playbook.preset_key WHEN 'lead_education_manual' THEN 14 WHEN 'direct_payment_monthly' THEN 30 WHEN 'stripe_plan_recovery' THEN 14 ELSE playbook.cooldown_days END,
  draft.created_at,'manual',draft.created_by_user_id
FROM client_playbook_drafts draft JOIN client_playbooks playbook ON playbook.id=draft.playbook_id AND playbook.status='active'
ORDER BY draft.client_app_id,draft.created_at DESC
ON CONFLICT(client_app_id) DO NOTHING;

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
  ON CONFLICT(client_app_id) DO UPDATE SET client_contact_id=EXCLUDED.client_contact_id,playbook_id=EXCLUDED.playbook_id,status='active',reply_delay_minutes=EXCLUDED.reply_delay_minutes,followup_days=EXCLUDED.followup_days,periodic_days=EXCLUDED.periodic_days,assigned_by_user_id=auth.uid()
  RETURNING id INTO assignment_id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(app.organization_id,auth.uid(),'client.playbook.assigned','client_playbook_assignment',assignment_id::TEXT,jsonb_build_object('client_app_id',app.id,'client_contact_id',target_client_contact_id,'playbook_id',playbook.id,'reply_delay_minutes',reply_delay,'followup_days',followup,'periodic_days',periodic,'status','active'));
  RETURN assignment_id;
END; $$;

CREATE OR REPLACE FUNCTION dashboard_create_client_playbook_draft(target_playbook_id UUID,target_client_app_id UUID,target_client_contact_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE playbook client_playbooks%ROWTYPE; version_row client_playbook_versions%ROWTYPE; app client_apps%ROWTYPE; contact client_contacts%ROWTYPE; subscription client_subscriptions%ROWTYPE;
DECLARE subscription_status TEXT; product_name TEXT; billing_interval TEXT; rendered_subject TEXT; rendered_body TEXT; recipient TEXT; new_id UUID;
BEGIN
  SELECT * INTO playbook FROM client_playbooks WHERE id=target_playbook_id;
  IF NOT FOUND OR playbook.status<>'active' OR auth.uid() IS NULL OR NOT dashboard_is_org_member(playbook.organization_id) THEN RAISE EXCEPTION 'Active playbook not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM client_playbook_assignments assignment WHERE assignment.client_app_id=target_client_app_id AND assignment.client_contact_id=target_client_contact_id AND assignment.playbook_id=playbook.id AND assignment.status='active') THEN RAISE EXCEPTION 'Playbook is not assigned to this client'; END IF;
  SELECT * INTO app FROM client_apps WHERE id=target_client_app_id AND organization_id=playbook.organization_id AND status='active' AND client_success_enabled=TRUE;
  IF NOT FOUND OR app.relationship_state='closed' OR NOT app.client_segment=ANY(playbook.eligible_client_segments) OR NOT app.relationship_state=ANY(playbook.eligible_relationship_states) THEN RAISE EXCEPTION 'Client app is not eligible'; END IF;
  SELECT * INTO contact FROM client_contacts WHERE id=target_client_contact_id AND client_app_id=app.id AND organization_id=playbook.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client contact not found'; END IF;
  IF playbook.channel='slack' AND contact.slack_assignment_status NOT IN ('assigned','linked') THEN RAISE EXCEPTION 'Contact has no linked Slack conversation'; END IF;
  SELECT * INTO subscription FROM client_subscriptions WHERE client_app_id=app.id ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,synced_at DESC LIMIT 1;
  subscription_status:=COALESCE(subscription.status,'none'); product_name:=COALESCE(subscription.product_name,subscription.price_nickname,'your subscription'); billing_interval:=COALESCE(subscription.billing_interval,'not available');
  IF cardinality(playbook.eligible_subscription_statuses)>0 AND NOT subscription_status=ANY(playbook.eligible_subscription_statuses) THEN RAISE EXCEPTION 'Client subscription state is not eligible for this playbook'; END IF;
  SELECT * INTO version_row FROM client_playbook_versions WHERE playbook_id=playbook.id AND version=playbook.current_version;
  rendered_subject:=replace(replace(replace(replace(replace(replace(COALESCE(version_row.subject_template,''),'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
  rendered_body:=replace(replace(replace(replace(replace(replace(version_row.body_template,'{{clientName}}',app.name),'{{contactName}}',contact.name),'{{contactFirstName}}',split_part(contact.name,' ',1)),'{{subscriptionStatus}}',subscription_status),'{{productName}}',product_name),'{{billingInterval}}',billing_interval);
  recipient:=CASE WHEN playbook.channel='email' THEN contact.email ELSE COALESCE(contact.slack_chat_label,contact.slack_display_name,contact.slack_name,contact.name) END;
  INSERT INTO client_playbook_drafts(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id,generation_mode,agent_status) VALUES(playbook.organization_id,playbook.id,playbook.current_version,app.id,contact.id,subscription.id,playbook.channel,recipient,NULLIF(rendered_subject,''),rendered_body,auth.uid(),'template','pending') RETURNING id INTO new_id;
  UPDATE client_playbook_assignments SET last_evaluated_at=NOW(),last_draft_at=NOW(),last_trigger_kind='manual' WHERE client_app_id=app.id;
  INSERT INTO audit_events(organization_id,actor_user_id,event_type,target_type,target_id,metadata) VALUES(playbook.organization_id,auth.uid(),'client.playbook.draft_created','client_playbook_draft',new_id::TEXT,jsonb_build_object('client_app_id',app.id,'playbook_id',playbook.id,'version',playbook.current_version,'channel',playbook.channel,'trigger_kind','manual','status','draft'));
  RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'An open draft already exists for this playbook and contact'; END; $$;

CREATE OR REPLACE FUNCTION service_prepare_due_client_playbook_drafts(target_limit INTEGER DEFAULT 10) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item RECORD; run_id UUID; draft_id UUID; trigger_key TEXT; trigger_kind TEXT; rendered_subject TEXT; rendered_body TEXT; context_count INTEGER; context_latest TIMESTAMPTZ; drafted INTEGER:=0; skipped INTEGER:=0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF target_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
  FOR item IN
    SELECT assignment.*,playbook.current_version,playbook.channel,playbook.eligible_subscription_statuses,playbook.trigger_type,version.subject_template,version.body_template,
      app.name app_name,app.relationship_state,contact.name contact_name,contact.email,contact.slack_assignment_status,
      COALESCE(subscription.status,'none') subscription_status,COALESCE(subscription.product_name,subscription.price_nickname,'your subscription') product_name,COALESCE(subscription.billing_interval,'not available') billing_interval,subscription.id subscription_id,subscription.canceled_at,
      latest.id latest_id,latest.direction latest_direction,latest.occurred_at latest_at
    FROM client_playbook_assignments assignment
    JOIN client_playbooks playbook ON playbook.id=assignment.playbook_id AND playbook.status='active'
    JOIN client_playbook_versions version ON version.playbook_id=playbook.id AND version.version=playbook.current_version
    JOIN client_apps app ON app.id=assignment.client_app_id AND app.organization_id=assignment.organization_id AND app.status='active' AND app.client_success_enabled=TRUE AND app.relationship_state<>'closed' AND app.client_segment=ANY(playbook.eligible_client_segments) AND app.relationship_state=ANY(playbook.eligible_relationship_states)
    JOIN client_contacts contact ON contact.id=assignment.client_contact_id AND contact.client_app_id=app.id AND contact.organization_id=assignment.organization_id AND (playbook.channel='email' OR contact.slack_assignment_status IN ('assigned','linked'))
    JOIN automation_runtime_controls control ON control.organization_id=assignment.organization_id AND control.globally_paused=FALSE
    LEFT JOIN LATERAL(SELECT * FROM client_subscriptions candidate WHERE candidate.client_app_id=app.id ORDER BY CASE candidate.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 WHEN 'past_due' THEN 3 WHEN 'unpaid' THEN 4 ELSE 5 END,candidate.synced_at DESC LIMIT 1) subscription ON TRUE
    LEFT JOIN LATERAL(SELECT message.id,message.direction,message.occurred_at FROM client_email_messages message WHERE message.client_app_id=app.id AND message.client_contact_id=contact.id ORDER BY message.occurred_at DESC LIMIT 1) latest ON TRUE
    WHERE assignment.status='active' AND (cardinality(playbook.eligible_subscription_statuses)=0 OR COALESCE(subscription.status,'none')=ANY(playbook.eligible_subscription_statuses)) AND (playbook.trigger_type<>'stripe_cancellation' OR subscription.status='canceled') AND (playbook.trigger_type<>'churn_reactivation' OR app.relationship_state='churned')
    ORDER BY COALESCE(assignment.last_evaluated_at,'epoch'::TIMESTAMPTZ),assignment.created_at LIMIT target_limit
  LOOP
    trigger_kind:=NULL; trigger_key:=NULL;
    IF item.latest_direction='inbound' AND item.latest_at<=NOW()-make_interval(mins=>item.reply_delay_minutes) THEN trigger_kind:='reply'; trigger_key:='reply:'||item.latest_id::TEXT;
    ELSIF item.latest_direction='outbound' AND item.latest_at<=NOW()-make_interval(days=>item.followup_days) THEN trigger_kind:='followup'; trigger_key:='followup:'||item.latest_id::TEXT;
    ELSIF item.latest_id IS NULL THEN trigger_kind:='periodic'; trigger_key:='initial:'||item.id::TEXT;
    ELSIF item.latest_at<=NOW()-make_interval(days=>item.periodic_days) THEN trigger_kind:='periodic'; trigger_key:='periodic:'||floor(extract(epoch FROM NOW())/(item.periodic_days*86400))::BIGINT::TEXT;
    END IF;
    UPDATE client_playbook_assignments SET last_evaluated_at=NOW() WHERE id=item.id;
    IF trigger_key IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
    INSERT INTO client_playbook_automation_runs(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,trigger_key) ON CONFLICT DO NOTHING RETURNING id INTO run_id;
    IF run_id IS NULL AND trigger_kind='followup' AND item.latest_at<=NOW()-make_interval(days=>item.periodic_days) THEN
      trigger_kind:='periodic'; trigger_key:='periodic:'||floor(extract(epoch FROM NOW())/(item.periodic_days*86400))::BIGINT::TEXT;
      INSERT INTO client_playbook_automation_runs(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,trigger_key) ON CONFLICT DO NOTHING RETURNING id INTO run_id;
    END IF;
    IF run_id IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
    SELECT COUNT(*),MAX(occurred_at) INTO context_count,context_latest FROM client_email_messages WHERE organization_id=item.organization_id AND client_app_id=item.client_app_id;
    rendered_subject:=replace(replace(replace(replace(replace(replace(COALESCE(item.subject_template,''),'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
    rendered_body:=replace(replace(replace(replace(replace(replace(item.body_template,'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
    BEGIN
      INSERT INTO client_playbook_drafts(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id,generation_mode,context_message_count,context_latest_message_at,agent_status) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,item.subscription_id,item.channel,CASE WHEN item.channel='email' THEN item.email ELSE item.contact_name END,NULLIF(rendered_subject,''),rendered_body,item.assigned_by_user_id,'template',context_count,context_latest,'pending') RETURNING id INTO draft_id;
      UPDATE client_playbook_automation_runs SET status='drafted',draft_id=draft_id,context_message_count=context_count,completed_at=NOW() WHERE id=run_id;
      UPDATE client_playbook_assignments SET last_draft_at=NOW(),last_trigger_kind=trigger_kind WHERE id=item.id;
      INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(item.organization_id,'client.playbook.automatic_draft_created','client_playbook_draft',draft_id::TEXT,jsonb_build_object('client_app_id',item.client_app_id,'playbook_id',item.playbook_id,'trigger_kind',trigger_kind,'context_message_count',context_count,'status','draft'));
      drafted:=drafted+1;
    EXCEPTION WHEN unique_violation THEN UPDATE client_playbook_automation_runs SET status='skipped',failure_code='open_draft_exists',completed_at=NOW() WHERE id=run_id; skipped:=skipped+1; END;
    run_id:=NULL; draft_id:=NULL;
  END LOOP;
  RETURN jsonb_build_object('drafted',drafted,'skipped',skipped);
END; $$;

DO $upgrade$
DECLARE target RECORD; next_version INTEGER; stronger_prompt TEXT := $p$Treat the latest unanswered inbound email as the primary task. Identify every explicit question or request and answer each one directly; never replace an answer with an offer to explain later. Use the complete synchronized conversation to avoid repetition and match the lead's level of knowledge.

Confirmed EpsiFlow facts: EpsiFlow helps Shopify app companies launch and run Shopify Ads when payment setup is the blocker. The supported onboarding path is: confirm fit and intended ad spend; create an account at https://app.epsifund.com/; EpsiFlow provisions the relevant account and digital debit card; schedule a short controlled card-detail handover; add the payment method to Shopify Ads; fund it through the agreed commercial route; then monitor spend and invoices in the app. Commercial routes discussed are (1) an EpsiFlow Direct monthly subscription and (2) Stripe-based funding/top-up plans, including a $500 funding-level example.

If the lead asks about pricing, explain both commercial routes using only confirmed terms in CRM notes or conversation history. The exact Direct monthly price, plan fee percentages, refund terms, and custody details are not confirmed in the shared product facts, so do not invent them; state precisely which figure needs confirmation for human review. Connect the answer to the lead's stated use case, then propose one concrete low-friction next step.$p$;
BEGIN
  FOR target IN SELECT playbook.* FROM client_playbooks playbook WHERE playbook.preset_key='lead_education_manual' LOOP
    next_version:=target.current_version+1;
    INSERT INTO client_playbook_versions(playbook_id,version,subject_template,body_template,agent_prompt,definition,created_by_user_id)
    VALUES(target.id,next_version,'EpsiFlow setup and options for {{clientName}}',E'Hi {{contactFirstName}},\n\nEpsiFlow helps Shopify app companies get Shopify Ads running when payment setup is the blocker. Onboarding starts with confirming fit and expected spend, then creating an account at https://app.epsifund.com/. We provision the relevant account and digital card, complete a short handover, connect it to Shopify Ads, and fund it through either an EpsiFlow Direct subscription or a Stripe-based top-up plan.\n\nI can include the exact current price and fee for the option that fits {{clientName}} once those commercial terms are confirmed. Which monthly advertising budget are you planning for?\n\nBest,\nEpsiFlow',stronger_prompt,jsonb_build_object('trigger','assigned_client_monitor','signals',ARRAY['unanswered_inbound','followup_due','periodic_due'],'channel','email','eligible_client_segments',ARRAY['lead'],'approval','required'),target.updated_by_user_id);
    UPDATE client_playbooks SET current_version=next_version,cooldown_days=14 WHERE id=target.id;
  END LOOP;
END $upgrade$;

REVOKE ALL ON FUNCTION dashboard_client_playbook_assignments_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_assign_client_playbook(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dashboard_client_playbook_assignments_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_assign_client_playbook(UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_create_client_playbook_draft(UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) TO service_role;

COMMIT;
