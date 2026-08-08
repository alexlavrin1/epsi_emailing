/**
 * Read-only connectivity and configuration audit. This script never sends,
 * imports, enrolls, or updates data.
 */

require('../src/env');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');
const { getLeadList, listAllLeads } = require('../src/integrations/instantly/client');

function withTimeout(promise, label, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

async function checkSmtp() {
  const transporter = nodemailer.createTransport({
    host: config.yandex.smtpHost,
    port: 465,
    secure: true,
    connectionTimeout: 15000,
    auth: { user: config.yandex.email, pass: config.yandex.password },
  });
  await transporter.verify();
  return { authenticated: true };
}

async function checkImap() {
  const client = new ImapFlow({
    host: config.yandex.imapHost,
    port: 993,
    secure: true,
    auth: { user: config.yandex.email, pass: config.yandex.password },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    lock.release();
    return { authenticated: true, inboxReadable: true };
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}

async function checkInstantly() {
  const [list, leads] = await Promise.all([getLeadList(), listAllLeads()]);
  const valid = leads.filter(lead => lead.verification_status === 1 && lead.email);
  return {
    listFound: Boolean(list?.id),
    fetched: leads.length,
    verified: valid.length,
    uniqueEmails: new Set(valid.map(lead => lead.email.trim().toLowerCase())).size,
  };
}

async function checkSupabase() {
  const supabase = createClient(config.supabase.url, config.supabase.key);
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, status, from_mailbox_id')
    .eq('name', config.localCampaignName)
    .maybeSingle();
  if (campaignError) throw campaignError;

  if (!campaign) return { reachable: true, campaignFound: false };

  const [{ data: steps, error: stepError }, { count, error: sendError }, { data: mailbox, error: mailboxError }] =
    await Promise.all([
      supabase.from('campaign_steps').select('step_number, delay_days').eq('campaign_id', campaign.id).order('step_number'),
      supabase.from('outreach_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id),
      supabase.from('mailboxes').select('display_name, signature').eq('id', campaign.from_mailbox_id).maybeSingle(),
    ]);
  if (stepError) throw stepError;
  if (sendError) throw sendError;
  if (mailboxError) throw mailboxError;

  return {
    reachable: true,
    campaignFound: true,
    campaignStatus: campaign.status,
    stepCount: (steps || []).length,
    delays: (steps || []).map(step => step.delay_days),
    enrolled: count || 0,
    senderNamePresent: Boolean(mailbox?.display_name),
    signaturePresent: Boolean(mailbox?.signature),
  };
}

async function main() {
  const checks = {
    configuration: {
      outreachEnabled: config.outreachEnabled,
      dailySendLimit: config.dailySendLimit,
      dailyNewLeadLimit: config.dailyNewLeadLimit,
      sendsPerCycle: config.sendsPerCycle,
      timezone: config.sendTimezone,
      hours: `${config.sendStartHour}:00-${config.sendEndHour}:00`,
      campaign: config.localCampaignName,
      supabaseKeyRole: config.supabase.keyRole,
      serverKeyConfigured: config.supabase.isServerKey,
    },
  };

  let failed = !config.supabase.isServerKey;
  for (const [name, fn] of Object.entries({
    smtp: checkSmtp,
    imap: checkImap,
    instantly: checkInstantly,
    supabase: checkSupabase,
  })) {
    try {
      checks[name] = await withTimeout(fn(), name);
    } catch (error) {
      failed = true;
      checks[name] = { ok: false, error: error.message };
    }
  }

  console.log(JSON.stringify(checks, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error('[fatal]', error.message);
  process.exit(1);
});
