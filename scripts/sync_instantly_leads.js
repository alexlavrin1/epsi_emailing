/**
 * Import verified contacts from INSTANTLY_LIST_ID into Supabase.
 *
 * Safe defaults:
 *   npm run sync:instantly:dry
 *   npm run sync:instantly
 *   npm run sync:instantly -- --enroll
 *
 * Importing never sends email. --enroll is allowed only while the local
 * campaign is paused, and OUTREACH_ENABLED must still be explicitly enabled
 * before the scheduler can deliver anything.
 */

require('../src/env');
const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');
const { getLeadList, listAllLeads } = require('../src/integrations/instantly/client');

const supabase = createClient(config.supabase.url, config.supabase.key);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const shouldEnroll = args.includes('--enroll');
const campaignIndex = args.indexOf('--campaign');
const campaignName = campaignIndex >= 0 ? args[campaignIndex + 1] : config.localCampaignName;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeLead(lead) {
  const email = normalizeEmail(lead.email);
  if (!email) return null;
  return {
    email,
    first_name: lead.first_name || null,
    last_name: lead.last_name || null,
    company: lead.company_name || null,
    title: lead.job_title || null,
    linkedin_url: lead.linkedin || lead.linkedin_url || null,
  };
}

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function getExistingEmails(emails) {
  const existing = new Set();
  for (const batch of chunks(emails, 100)) {
    const { data, error } = await supabase.from('prospects').select('email').in('email', batch);
    if (error) throw error;
    for (const row of data || []) existing.add(row.email.toLowerCase());
  }
  return existing;
}

async function upsertProspects(prospects) {
  for (const batch of chunks(prospects, 100)) {
    const { error } = await supabase
      .from('prospects')
      .upsert(batch, { onConflict: 'email', ignoreDuplicates: false });
    if (error) throw error;
  }
}

async function enrollProspects(emails) {
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('name', campaignName)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) throw new Error(`Local campaign not found: "${campaignName}"`);
  if (campaign.status !== 'paused') {
    throw new Error(`Refusing to enroll: campaign "${campaignName}" must be paused`);
  }

  const prospects = [];
  for (const batch of chunks(emails, 100)) {
    const { data, error } = await supabase
      .from('prospects')
      .select('id, email, status')
      .in('email', batch);
    if (error) throw error;
    prospects.push(...(data || []).filter(row => row.status === 'active'));
  }

  const rows = prospects.map(prospect => ({
    campaign_id: campaign.id,
    prospect_id: prospect.id,
    step_number: 1,
    status: 'scheduled',
    next_send_at: new Date().toISOString(),
  }));
  for (const batch of chunks(rows, 100)) {
    const { error } = await supabase
      .from('outreach_sends')
      .upsert(batch, {
        onConflict: 'campaign_id,prospect_id,step_number',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
  return rows.length;
}

async function main() {
  const list = await getLeadList();
  const rawLeads = await listAllLeads();
  const unique = new Map();
  let invalidEmail = 0;
  let unverified = 0;

  for (const lead of rawLeads) {
    const prospect = normalizeLead(lead);
    if (!prospect) {
      invalidEmail++;
      continue;
    }
    if (lead.verification_status !== 1) {
      unverified++;
      continue;
    }
    if (!unique.has(prospect.email)) unique.set(prospect.email, prospect);
  }

  const prospects = [...unique.values()];
  const stats = {
    listName: list?.name || null,
    fetched: rawLeads.length,
    verifiedUnique: prospects.length,
    duplicates: rawLeads.length - invalidEmail - unverified - prospects.length,
    invalidEmail,
    unverified,
  };

  if (dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', ...stats, wouldEnroll: shouldEnroll }, null, 2));
    return;
  }

  if (!config.supabase.isServerKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for importing or enrolling leads');
  }

  const existing = await getExistingEmails(prospects.map(item => item.email));
  await upsertProspects(prospects);
  const imported = prospects.length - existing.size;
  const updated = existing.size;
  let enrolled = 0;
  if (shouldEnroll) enrolled = await enrollProspects(prospects.map(item => item.email));

  console.log(JSON.stringify({
    mode: 'live',
    ...stats,
    imported,
    updated,
    enrolled,
    campaign: shouldEnroll ? campaignName : null,
    sendingEnabled: config.outreachEnabled,
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error('[fatal]', error.message);
    process.exit(1);
  });
}

module.exports = { normalizeEmail, normalizeLead };
