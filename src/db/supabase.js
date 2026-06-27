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
async function getOutreachSendsCountToday(campaignIds) {
  if (!campaignIds.length) return 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const { count, error } = await supabase
    .from('outreach_sends')
    .select('id', { count: 'exact', head: true })
    .in('campaign_id', campaignIds)
    .eq('status', 'sent')
    .gte('sent_at', startOfDay.toISOString())
    .lte('sent_at', endOfDay.toISOString());

  if (error) throw error;
  return count || 0;
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
      prospect:prospect_id(id, email),
      campaign:campaign_id(
        mailbox:from_mailbox_id(id, email, oauth_token)
      )
    `)
    .eq('status', 'sent')
    .is('replied_at', null)
    .not('gmail_thread_id', 'is', null)
    .gte('sent_at', cutoff);

  if (error) throw error;
  return data || [];
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

async function saveProspectReply({ outreach_send_id, campaign_id, prospect_id, gmail_message_id, subject, body, received_at }) {
  const { error } = await supabase
    .from('prospect_replies')
    .upsert(
      { outreach_send_id, campaign_id, prospect_id, gmail_message_id, subject, body, received_at },
      { onConflict: 'gmail_message_id', ignoreDuplicates: true }
    );
  if (error) logger.error('Error saving prospect reply', error.message);
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
  stopProspectSequence,
  saveProspectReply,
};
