-- Unblock approved client email delivery and repair the scheduled-draft worker.
BEGIN;

-- Migration 042 deliberately defaulted historical approvals to not_requested.
-- They were explicitly approved, so queue those email drafts once now.
WITH queued AS (
  UPDATE client_playbook_drafts draft
     SET delivery_status='queued',
         delivery_queued_at=COALESCE(draft.decided_at,NOW()),
         delivery_claimed_at=NULL,
         delivered_at=NULL,
         delivery_failure_code=NULL,
         provider_message_id=NULL
   WHERE draft.channel='email'
     AND draft.status='approved'
     AND draft.delivery_status='not_requested'
  RETURNING draft.id,draft.organization_id,draft.client_app_id,draft.playbook_id
)
INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata)
SELECT queued.organization_id,'client.playbook.email_queued','client_playbook_draft',queued.id::TEXT,
       jsonb_build_object('client_app_id',queued.client_app_id,'playbook_id',queued.playbook_id,'status','approved','delivery_status','queued','source','migration_044')
FROM queued;

-- The former local variable `draft_id` collided with the automation-run column
-- in `SET draft_id=draft_id`, causing PostgreSQL 42702 and aborting the worker.
CREATE OR REPLACE FUNCTION service_prepare_due_client_playbook_drafts(target_limit INTEGER DEFAULT 10) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item RECORD; new_run_id UUID; new_draft_id UUID; trigger_key TEXT; trigger_kind TEXT; rendered_subject TEXT; rendered_body TEXT; context_count INTEGER; context_latest TIMESTAMPTZ; drafted INTEGER:=0; skipped INTEGER:=0;
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
    UPDATE client_playbook_assignments assignment SET last_evaluated_at=NOW() WHERE assignment.id=item.id;
    IF trigger_key IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
    INSERT INTO client_playbook_automation_runs(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,trigger_key) ON CONFLICT DO NOTHING RETURNING id INTO new_run_id;
    IF new_run_id IS NULL AND trigger_kind='followup' AND item.latest_at<=NOW()-make_interval(days=>item.periodic_days) THEN
      trigger_kind:='periodic'; trigger_key:='periodic:'||floor(extract(epoch FROM NOW())/(item.periodic_days*86400))::BIGINT::TEXT;
      INSERT INTO client_playbook_automation_runs(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,trigger_key) ON CONFLICT DO NOTHING RETURNING id INTO new_run_id;
    END IF;
    IF new_run_id IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
    SELECT COUNT(*),MAX(message.occurred_at) INTO context_count,context_latest FROM client_email_messages message WHERE message.organization_id=item.organization_id AND message.client_app_id=item.client_app_id;
    rendered_subject:=replace(replace(replace(replace(replace(replace(COALESCE(item.subject_template,''),'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
    rendered_body:=replace(replace(replace(replace(replace(replace(item.body_template,'{{clientName}}',item.app_name),'{{contactName}}',item.contact_name),'{{contactFirstName}}',split_part(item.contact_name,' ',1)),'{{subscriptionStatus}}',item.subscription_status),'{{productName}}',item.product_name),'{{billingInterval}}',item.billing_interval);
    BEGIN
      INSERT INTO client_playbook_drafts(organization_id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,created_by_user_id,generation_mode,context_message_count,context_latest_message_at,agent_status) VALUES(item.organization_id,item.playbook_id,item.current_version,item.client_app_id,item.client_contact_id,item.subscription_id,item.channel,CASE WHEN item.channel='email' THEN item.email ELSE item.contact_name END,NULLIF(rendered_subject,''),rendered_body,item.assigned_by_user_id,'template',context_count,context_latest,'pending') RETURNING id INTO new_draft_id;
      UPDATE client_playbook_automation_runs automation_run SET status='drafted',draft_id=new_draft_id,context_message_count=context_count,completed_at=NOW() WHERE automation_run.id=new_run_id;
      UPDATE client_playbook_assignments assignment SET last_draft_at=NOW(),last_trigger_kind=trigger_kind WHERE assignment.id=item.id;
      INSERT INTO audit_events(organization_id,event_type,target_type,target_id,metadata) VALUES(item.organization_id,'client.playbook.automatic_draft_created','client_playbook_draft',new_draft_id::TEXT,jsonb_build_object('client_app_id',item.client_app_id,'playbook_id',item.playbook_id,'trigger_kind',trigger_kind,'context_message_count',context_count,'status','draft'));
      drafted:=drafted+1;
    EXCEPTION WHEN unique_violation THEN UPDATE client_playbook_automation_runs automation_run SET status='skipped',failure_code='open_draft_exists',completed_at=NOW() WHERE automation_run.id=new_run_id; skipped:=skipped+1; END;
    new_run_id:=NULL; new_draft_id:=NULL;
  END LOOP;
  RETURN jsonb_build_object('drafted',drafted,'skipped',skipped);
END; $$;

REVOKE ALL ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION service_prepare_due_client_playbook_drafts(INTEGER) TO service_role;

COMMIT;
