import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseRouteClient } from "../../../lib/supabase-route";
const limit = 5000;
const safeAuditKeys = new Set(["trigger", "context_message_count", "context_warning_count", "source_count", "generation_mode", "previous_stage", "new_stage", "note_id", "task_id", "due_at", "previous_status", "new_status", "contact_kind", "contact_id", "workflow_id", "automation_run_id", "playbook_id", "version", "status", "channel", "failure_code", "retry_count", "previous_days", "new_days", "dataset", "row_count", "truncated", "client_app_id", "contact_count", "slack_requested"]);
function sanitizeAuditMetadata(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([key, item]) => safeAuditKeys.has(key) && ["string", "number", "boolean"].includes(typeof item)).slice(0, 12)); }
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { client, applyCookies } = createSupabaseRouteClient(request);
    const { data: userData } = await client.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: membership } = await client.from("organization_members").select("role,organization:organizations(id,name,slug)").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    const organization = Array.isArray(membership?.organization) ? membership.organization[0] : membership?.organization;
    const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (membership?.role !== "admin" || !organization || assurance?.currentLevel !== "aal2") return NextResponse.json({ error: "Administrator MFA verification required" }, { status: 403 });
    const queries = {
      prospects: client.from("prospects").select("id,email,first_name,last_name,company,title,status,linkedin_url,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      customers: client.from("crm_customers").select("id,email,name,status,email_enabled,slack_enabled,stripe_customer_id,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      notes: client.from("crm_contact_notes").select("id,contact_kind,contact_id,body,created_by_user_id,created_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      tasks: client.from("crm_contact_tasks").select("id,contact_kind,contact_id,title,status,due_at,assigned_to_user_id,created_by_user_id,completed_at,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      recoveryCases: client.from("payment_recovery_cases").select("id,crm_customer_id,stripe_invoice_id,state,invoice_status,payment_intent_status,amount_remaining,currency,opened_at,resolved_at,resolution_reason,created_at,updated_at").order("created_at").limit(limit + 1),
      clientApps: client.from("client_apps").select("id,name,website_url,status,client_segment,relationship_state,client_success_enabled,relationship_note,stripe_customer_id,stripe_customer_email,stripe_customer_name,stripe_sync_status,last_stripe_sync_at,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      clientContacts: client.from("client_contacts").select("id,client_app_id,name,email,slack_name,slack_assignment_status,slack_team_id,slack_user_id,slack_channel_id,slack_display_name,slack_chat_url,slack_chat_label,last_email_sync_at,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      clientEmailMessages: client.from("client_email_messages").select("id,client_app_id,client_contact_id,provider_message_id,thread_key,direction,mailbox_email,counterparty_email,subject,body,occurred_at,created_at").eq("organization_id", organization.id).order("occurred_at").limit(limit + 1),
      clientSubscriptions: client.from("client_subscriptions").select("id,client_app_id,stripe_customer_id,stripe_subscription_id,status,product_name,price_nickname,quantity,unit_amount,currency,billing_interval,interval_count,current_period_start,current_period_end,trial_end,cancel_at,cancel_at_period_end,canceled_at,latest_invoice_status,synced_at").eq("organization_id", organization.id).order("synced_at").limit(limit + 1),
      clientPlaybooks: client.from("client_playbooks").select("id,name,description,channel,trigger_type,eligible_subscription_statuses,eligible_client_segments,eligible_relationship_states,cooldown_days,status,approval_mode,current_version,preset_key,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      clientPlaybookVersions: client.from("client_playbook_versions").select("id,playbook_id,version,subject_template,body_template,agent_prompt,definition,created_at").order("created_at").limit(limit + 1),
      clientPlaybookDrafts: client.from("client_playbook_drafts").select("id,playbook_id,playbook_version,client_app_id,client_contact_id,client_subscription_id,channel,recipient_label,subject,body,status,generation_mode,context_message_count,context_latest_message_at,agent_status,agent_attempt_count,agent_generated_at,agent_model,agent_response_id,agent_failure_code,agent_context_sha256,agent_context_warnings,decided_at,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      clientPlaybookDraftSources: client.from("client_playbook_draft_sources").select("draft_id,message_id,ordinal,created_at").order("created_at").limit(limit + 1),
      clientPlaybookAutomationRuns: client.from("client_playbook_automation_runs").select("id,playbook_id,playbook_version,client_app_id,client_contact_id,trigger_key,status,draft_id,context_message_count,failure_code,created_at,completed_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      clientPlaybookAssignments: client.from("client_playbook_assignments").select("id,client_app_id,client_contact_id,playbook_id,status,reply_delay_minutes,followup_days,periodic_days,last_evaluated_at,last_draft_at,last_trigger_kind,created_at,updated_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
      auditEvents: client.from("audit_events").select("id,actor_user_id,event_type,target_type,target_id,metadata,created_at").eq("organization_id", organization.id).order("created_at").limit(limit + 1),
    };
    const entries = await Promise.all(Object.entries(queries).map(async ([name, query]) => [name, await query] as const));
    if (entries.some(([, result]) => result.error)) return NextResponse.json({ error: "The organization export could not be prepared." }, { status: 503 });
    const datasets: Record<string, unknown[]> = {}; const truncated: Record<string, boolean> = {};
    for (const [name, result] of entries) { const rows = result.data ?? []; truncated[name] = rows.length > limit; datasets[name] = rows.slice(0, limit).map(row => { const record = row as Record<string, unknown>; return name === "auditEvents" ? { ...record, metadata: sanitizeAuditMetadata(record.metadata) } : record; }); }
    const rowCount = Object.values(datasets).reduce((total, rows) => total + rows.length, 0); const anyTruncated = Object.values(truncated).some(Boolean);
    const { error: auditError } = await client.rpc("dashboard_record_data_export", { target_organization_id: organization.id, target_dataset: "organization_bundle", target_row_count: rowCount, target_truncated: anyTruncated });
    if (auditError) return NextResponse.json({ error: "Export auditing requires migration 022." }, { status: 503 });
    const payload = { schemaVersion: 6, generatedAt: new Date().toISOString(), organization, limits: { rowsPerDataset: limit, truncated }, datasets };
    const filename = `${organization.slug}-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    return applyCookies(new NextResponse(JSON.stringify(payload, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff" } }));
  } catch { return NextResponse.json({ error: "The organization export is unavailable." }, { status: 503 }); }
}
