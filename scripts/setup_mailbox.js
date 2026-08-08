/**
 * Register (or update) your Yandex sending address in the database.
 * Run this ONCE before creating a campaign — safe to re-run to update
 * display_name / signature, it upserts by email.
 *
 * Usage:
 *   npm run setup:mailbox
 *   npm run setup:mailbox -- "EPSI Fund"   ← optional display name override
 *
 * Set SENDER_DISPLAY_NAME and SENDER_SIGNATURE to control the sender identity.
 */

require('../src/env');
const { createClient } = require('@supabase/supabase-js');
const config = require('../src/config');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const SIGNATURE = process.env.SENDER_SIGNATURE || 'Alex Lavrin\nBusiness Development, EpsiFlow';

async function main() {
  if (!config.supabase.isServerKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for mailbox setup');
  }
  const email       = process.env.YANDEX_EMAIL;
  const displayName = process.argv[2] || process.env.SENDER_DISPLAY_NAME ||
    (email ? email.split('@')[0] : null) || 'EpsiFlow';

  if (!email) {
    console.error('YANDEX_EMAIL is not set in .env');
    process.exit(1);
  }

  const { data: existing } = await supabase
    .from('mailboxes')
    .select('id, email, display_name')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    const { data: updated, error: uErr } = await supabase
      .from('mailboxes')
      .update({ display_name: displayName, signature: SIGNATURE })
      .eq('id', existing.id)
      .select()
      .single();
    if (uErr) throw uErr;

    console.log(`✓ Mailbox updated: ${updated.email} (id=${updated.id})`);
    console.log(`  display_name: ${updated.display_name}`);
    console.log(`  signature:    ${updated.signature}`);
    return;
  }

  const { data, error } = await supabase
    .from('mailboxes')
    .insert([{ email, oauth_token: 'smtp', display_name: displayName, signature: SIGNATURE }])
    .select()
    .single();

  if (error) throw error;

  console.log(`\n✓ Mailbox registered: ${data.email}`);
  console.log(`  id:           ${data.id}`);
  console.log(`  display_name: ${data.display_name}`);
  console.log('\nNext steps:');
  console.log('  1. In Supabase SQL editor, create a campaign pointing to this mailbox:');
  console.log(`     INSERT INTO campaigns (name, from_mailbox_id, status)`);
  console.log(`     VALUES ('EPSI Fund Outreach', '${data.id}', 'active');`);
  console.log('  2. Insert campaign_steps (step 1 + follow-ups) in the same editor.');
  console.log('  3. Import prospects: npm run import:prospects');
  console.log('  4. Enroll them:      node scripts/enroll_prospects.js "EPSI Fund Outreach"');
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
