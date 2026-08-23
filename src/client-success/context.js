const database = require('../db/supabase');

async function getClientConversationContext(clientAppId, dependencies = {}) {
  const client = dependencies.supabase || database.supabase;
  const { data: app, error: appError } = await client.from('client_apps')
    .select('id,organization_id,name,website_url,client_segment,relationship_state,client_success_enabled,relationship_note,stripe_customer_id,contacts:client_contacts(id,name,email,slack_name,slack_display_name,slack_chat_url,slack_chat_label),subscriptions:client_subscriptions(status,product_name,price_nickname,billing_interval,current_period_end,cancel_at_period_end,canceled_at,latest_invoice_status,synced_at)')
    .eq('id', clientAppId).maybeSingle();
  if (appError) throw appError;
  if (!app) return null;
  const messages = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from('client_email_messages')
      .select('id,client_contact_id,thread_key,direction,subject,body,occurred_at')
      .eq('organization_id', app.organization_id).eq('client_app_id', app.id)
      .order('occurred_at', { ascending: true }).range(from, from + 499);
    if (error) throw error;
    messages.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return { app, conversations: { email: messages, slack: { available: false, reason: 'history_sync_not_installed', links: (app.contacts || []).filter(contact => contact.slack_chat_url).map(contact => ({ contactId: contact.id, url: contact.slack_chat_url, label: contact.slack_chat_label })) } }, sourceMessageCount: messages.length };
}

module.exports = { getClientConversationContext };
