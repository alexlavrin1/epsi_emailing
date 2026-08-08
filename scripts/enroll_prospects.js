/**
 * Enroll all active prospects into a campaign.
 *
 * Usage:
 *   node scripts/enroll_prospects.js "EPSI Fund Outreach"
 *   node scripts/enroll_prospects.js "EPSI Fund Outreach" --dry-run
 *   node scripts/enroll_prospects.js "EPSI Fund Outreach" --confirm-all
 *
 * What it does:
 *   - Finds the campaign by name
 *   - Finds all active prospects not yet enrolled
 *   - Inserts step 1 rows (status='scheduled', next_send_at=now)
 *   - The scheduler picks them up on the next hourly cycle
 */

require('../src/env');
const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function main() {
  if (!config.supabase.isServerKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for enrollment');
  }
  const campaignName = process.argv[2];
  const dryRun       = process.argv.includes('--dry-run');
  const confirmAll    = process.argv.includes('--confirm-all');

  if (!campaignName) {
    console.error('Usage: node scripts/enroll_prospects.js "Campaign Name" [--dry-run|--confirm-all]');
    process.exit(1);
  }

  if (!dryRun && !confirmAll) {
    console.error('Refusing to enroll every active prospect without --confirm-all.');
    console.error('For the Instantly-sourced campaign, use: npm run sync:instantly -- --enroll');
    process.exit(1);
  }

  // 1. Find campaign
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('name', campaignName)
    .maybeSingle();

  if (cErr) throw cErr;
  if (!campaign) {
    console.error(`Campaign not found: "${campaignName}"`);
    console.error('Create the campaign first via the Supabase dashboard or SQL.');
    process.exit(1);
  }

  console.log(`Campaign: "${campaign.name}" (${campaign.status})`);
  if (campaign.status !== 'active') {
    console.warn('Warning: campaign is not active — sends will be scheduled but may not fire until you set it to active.');
  }

  // 2. Find already-enrolled prospect IDs
  const { data: existing, error: eErr } = await supabase
    .from('outreach_sends')
    .select('prospect_id')
    .eq('campaign_id', campaign.id);

  if (eErr) throw eErr;
  const enrolledIds = (existing || []).map(r => r.prospect_id);
  console.log(`Already enrolled: ${enrolledIds.length} prospect(s)`);

  // 3. Get active prospects not yet enrolled
  let query = supabase
    .from('prospects')
    .select('id, email, first_name, last_name, company')
    .eq('status', 'active');

  if (enrolledIds.length) {
    query = query.not('id', 'in', `(${enrolledIds.join(',')})`);
  }

  const { data: prospects, error: pErr } = await query;
  if (pErr) throw pErr;

  if (!prospects.length) {
    console.log('No new prospects to enroll. All active prospects are already in this campaign.');
    return;
  }

  console.log(`\nProspects to enroll: ${prospects.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] First 20 prospects that would be enrolled:');
    prospects.slice(0, 20).forEach(p => {
      console.log(`  • ${p.first_name || ''} ${p.last_name || ''} <${p.email}>${p.company ? ' — ' + p.company : ''}`);
    });
    if (prospects.length > 20) console.log(`  ... and ${prospects.length - 20} more`);
    console.log('\nRe-run without --dry-run to enroll.');
    return;
  }

  // 4. Insert step 1 rows in batches
  const BATCH = 100;
  const now   = new Date().toISOString();
  let enrolled = 0;

  for (let i = 0; i < prospects.length; i += BATCH) {
    const batch = prospects.slice(i, i + BATCH);
    const rows  = batch.map(p => ({
      campaign_id:  campaign.id,
      prospect_id:  p.id,
      step_number:  1,
      status:       'scheduled',
      next_send_at: now,
    }));

    const { error: iErr } = await supabase.from('outreach_sends').insert(rows);
    if (iErr) throw iErr;
    enrolled += batch.length;
    process.stdout.write(`\rEnrolled ${enrolled}/${prospects.length}...`);
  }

  console.log(`\n\nDone. Enrolled ${enrolled} prospect(s) into "${campaign.name}".`);
  console.log('Step 1 emails will fire on the next scheduler cycle (top of the hour).');
  console.log('\nStart the scheduler with:');
  console.log('  npm start');
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
