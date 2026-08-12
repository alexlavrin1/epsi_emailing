const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

const supabase = createClient(config.supabase.url, config.supabase.key);

// ─── Mailboxes ────────────────────────────────────────────────────────────────

async function getMailboxByEmail(email) {
  const { data, error } = await supabase
    .from('mailboxes')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createMailbox(email, refreshToken, displayName = null) {
  const { data, error } = await supabase
    .from('mailboxes')
    .insert([{ email, oauth_token: refreshToken, display_name: displayName }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateMailboxToken(id, refreshToken, displayName = null) {
  const updates = { oauth_token: refreshToken };
  if (displayName) updates.display_name = displayName;
  const { data, error } = await supabase
    .from('mailboxes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Outreach ─────────────────────────────────────────────────────────────────

/**
 * All scheduled sends whose next_send_at has passed, joined with prospect +
 * campaign + mailbox. Filters out paused campaigns and inactive prospects.
 */
async function getDueOutreachSends() {
  const { data, error } = await supabase
    .from('outreach_sends')
    .select(`
      *,
      prospect:prospect_id(*),
      campaign:campaign_id(
        *,
        mailbox:from_mailbox_id(*)
      )
    `)
    .eq('status', 'scheduled')
    .lte('next_send_at', new Date().toISOString())
    .order('step_number', { ascending: false })
    .order('next_send_at', { ascending: true })
    .limit(200);

  if (error) throw error;
  return (data || []).filter(
    s => s.campaign?.status === 'active' && s.prospect?.status === 'active'
  );
}

async function getCampaignStep(campaignId, stepNumber) {
  const { data, error } = await supabase
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('step_number', stepNumber)
    .single();
  if (error) throw error;
  return data;
}

async function getNextCampaignStep(campaignId, currentStepNumber) {
  const { data, error } = await supabase
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('step_number', currentStepNumber + 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getStep1Send(campaignId, prospectId) {
  const { data, error } = await supabase
    .from('outreach_sends')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .eq('step_number', 1)
    .single();
  if (error) throw error;
  return data;
}

async function markOutreachSent(id, gmailThreadId, gmailMessageId) {
  const updates = {
    status: 'sent',
    sent_at: new Date().toISOString(),
    gmail_thread_id: gmailThreadId,
  };
  if (gmailMessageId) updates.gmail_message_id = gmailMessageId;

  const { data, error } = await supabase
    .from('outreach_sends')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function scheduleNextStep(campaignId, prospectId, stepNumber, delayDays, gmailThreadId) {
  const { data: existing } = await supabase
    .from('outreach_sends')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .eq('step_number', stepNumber)
    .maybeSingle();

  if (existing) return existing;

  const nextSendAt = new Date();
  nextSendAt.setDate(nextSendAt.getDate() + delayDays);

  const { data, error } = await supabase
    .from('outreach_sends')
    .insert([{
      campaign_id:     campaignId,
      prospect_id:     prospectId,
      step_number:     stepNumber,
      status:          'scheduled',
      next_send_at:    nextSendAt.toISOString(),
      gmail_thread_id: gmailThreadId,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Count how many outreach emails have been sent today across a set of campaign IDs.
 */
async function getOutreachSendsCountToday(campaignIds, stepNumber = null) {
  if (!campaignIds.length) return 0;

  const { startOfDay, endOfDay } = getDayBounds(new Date(), config.sendTimezone);

  let query = supabase
    .from('outreach_sends')
    .select('id', { count: 'exact', head: true })
    .in('campaign_id', campaignIds)
    .eq('status', 'sent')
    .gte('sent_at', startOfDay.toISOString())
    .lte('sent_at', endOfDay.toISOString());

  if (stepNumber !== null) query = query.eq('step_number', stepNumber);
  const { count, error } = await query;

  if (error) throw error;
  return count || 0;
}

function getDayBounds(now, timeZone) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = type => Number(dateParts.find(item => item.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');

  const zonedMidnightToUtc = (y, m, d) => {
    const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const value = type => Number(localParts.find(item => item.type === type)?.value);
    const representedAsUtc = Date.UTC(
      value('year'), value('month') - 1, value('day'),
      value('hour'), value('minute'), value('second')
    );
    return new Date(guess - (representedAsUtc - guess));
  };

  const startOfDay = zonedMidnightToUtc(year, month, day);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const endOfDay = zonedMidnightToUtc(
    tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()
  );
  endOfDay.setMilliseconds(endOfDay.getMilliseconds() - 1);
  return { startOfDay, endOfDay };
}

/**
 * Sent threads from the last 14 days with no detected reply — scanned each cycle.
 */
async function getOutreachSendsForReplyCheck() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('outreach_sends')
    .select(`
      *,
      prospect:prospect_id(id, email, status),
      campaign:campaign_id(
        mailbox:from_mailbox_id(id, email, oauth_token)
      )
    `)
    .eq('status', 'sent')
    .is('replied_at', null)
    .not('gmail_thread_id', 'is', null)
    .gte('sent_at', cutoff);

  if (error) throw error;
  return (data || []).filter(send => send.prospect?.status === 'active');
}

async function markOutreachReplied(id) {
  const { data, error } = await supabase
    .from('outreach_sends')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function markProspectCampaignReplied(campaignId, prospectId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('outreach_sends')
    .update({ status: 'replied', replied_at: now })
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .eq('status', 'sent')
    .select();
  if (error) throw error;
  return data;
}

async function stopProspectSequence(campaignId, prospectId) {
  const { data, error } = await supabase
    .from('outreach_sends')
    .update({ status: 'stopped' })
    .eq('campaign_id', campaignId)
    .eq('prospect_id', prospectId)
    .eq('status', 'scheduled')
    .select();
  if (error) throw error;
  return data;
}

async function stopAllProspectSequences(prospectId) {
  const { data, error } = await supabase
    .from('outreach_sends')
    .update({ status: 'stopped' })
    .eq('prospect_id', prospectId)
    .eq('status', 'scheduled')
    .select();
  if (error) throw error;
  return data;
}

async function updateProspectStatus(prospectId, status) {
  const { data, error } = await supabase
    .from('prospects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', prospectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function saveProspectReply({ outreach_send_id, campaign_id, prospect_id, gmail_message_id, subject, body, received_at }) {
  const { error } = await supabase
    .from('prospect_replies')
    .upsert(
      { outreach_send_id, campaign_id, prospect_id, gmail_message_id, subject, body, received_at },
      { onConflict: 'gmail_message_id', ignoreDuplicates: true }
    );
  if (error) logger.error('Error saving prospect reply', error.message);
}

// ─── Stripe webhook ingestion ────────────────────────────────────────────────

/**
 * Queue a verified Stripe event exactly once. We persist only routing metadata,
 * not the event payload; the eventual worker will retrieve canonical objects
 * from Stripe before taking any action.
 */
async function enqueueStripeWebhookEvent(eventRecord) {
  const { data, error } = await supabase
    .from('stripe_webhook_events')
    .insert([eventRecord])
    .select('id, status')
    .single();

  if (error?.code === '23505') {
    return { duplicate: true, id: eventRecord.id };
  }
  if (error) throw error;
  return { duplicate: false, ...data };
}

// ─── CRM and payment recovery ────────────────────────────────────────────────

async function upsertCrmCustomer(customerRecord) {
  const { data, error } = await supabase
    .from('crm_customers')
    .upsert(customerRecord, { onConflict: 'stripe_customer_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getCrmCustomerByStripeId(stripeCustomerId) {
  const { data, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setCrmCustomerSlackIdentity(customerId, slackTeamId, slackUserId) {
  const { data, error } = await supabase
    .from('crm_customers')
    .update({
      slack_team_id: slackTeamId,
      slack_user_id: slackUserId,
      slack_enabled: Boolean(slackTeamId && slackUserId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertPaymentRecoveryCase(caseRecord) {
  const { data, error } = await supabase
    .from('payment_recovery_cases')
    .upsert(caseRecord, { onConflict: 'stripe_invoice_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getPaymentRecoveryCaseByInvoiceId(stripeInvoiceId) {
  const { data, error } = await supabase
    .from('payment_recovery_cases')
    .select('*, customer:crm_customer_id(*)')
    .eq('stripe_invoice_id', stripeInvoiceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function schedulePaymentRecoveryMessage(messageRecord) {
  const { data, error } = await supabase
    .from('payment_recovery_messages')
    .upsert(messageRecord, {
      onConflict: 'recovery_case_id,channel,step_number',
      ignoreDuplicates: true,
    })
    .select()
    .maybeSingle();
  if (error) throw error;

  if (data) return { duplicate: false, message: data };
  const { data: existing, error: existingError } = await supabase
    .from('payment_recovery_messages')
    .select('*')
    .eq('recovery_case_id', messageRecord.recovery_case_id)
    .eq('channel', messageRecord.channel)
    .eq('step_number', messageRecord.step_number)
    .single();
  if (existingError) throw existingError;
  return { duplicate: true, message: existing };
}

async function getDuePaymentRecoveryMessages(limit = 100) {
  const { data, error } = await supabase
    .from('payment_recovery_messages')
    .select('*, recovery_case:recovery_case_id(*, customer:crm_customer_id(*))')
    .in('status', ['queued', 'failed'])
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).filter(message => message.recovery_case?.state === 'open');
}

async function markPaymentRecoveryMessageSending(id) {
  const { data, error } = await supabase
    .rpc('claim_payment_recovery_message', { p_message_id: id })
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function markPaymentRecoveryMessageSent(id, providerMessageId = null) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('payment_recovery_messages')
    .update({
      status: 'sent',
      provider_message_id: providerMessageId,
      last_error: null,
      sent_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'sending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function markPaymentRecoveryMessageFailed(id, errorMessage) {
  const { data, error } = await supabase
    .from('payment_recovery_messages')
    .update({
      status: 'failed',
      last_error: String(errorMessage || 'Unknown delivery error').slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'sending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function cancelPaymentRecoveryMessages(recoveryCaseId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('payment_recovery_messages')
    .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .eq('recovery_case_id', recoveryCaseId)
    .in('status', ['queued', 'failed'])
    .select();
  if (error) throw error;
  return data || [];
}

module.exports = {
  supabase,
  getMailboxByEmail,
  createMailbox,
  updateMailboxToken,
  getDueOutreachSends,
  getCampaignStep,
  getNextCampaignStep,
  getStep1Send,
  markOutreachSent,
  scheduleNextStep,
  getOutreachSendsCountToday,
  getOutreachSendsForReplyCheck,
  markOutreachReplied,
  markProspectCampaignReplied,
  stopProspectSequence,
  stopAllProspectSequences,
  updateProspectStatus,
  saveProspectReply,
  enqueueStripeWebhookEvent,
  upsertCrmCustomer,
  getCrmCustomerByStripeId,
  setCrmCustomerSlackIdentity,
  upsertPaymentRecoveryCase,
  getPaymentRecoveryCaseByInvoiceId,
  schedulePaymentRecoveryMessage,
  getDuePaymentRecoveryMessages,
  markPaymentRecoveryMessageSending,
  markPaymentRecoveryMessageSent,
  markPaymentRecoveryMessageFailed,
  cancelPaymentRecoveryMessages,
};
