/**
 * Register your Yandex sending address in the database.
 * Run this ONCE before creating a campaign.
 *
 * Usage:
 *   npm run setup:mailbox
 *   npm run setup:mailbox -- "EPSI Fund"   ← optional display name override
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  const email       = process.env.YANDEX_EMAIL;
  const displayName = process.argv[2] || (email ? email.split('@')[0] : null) || 'EPSI Fund';

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
    console.log(`Mailbox already exists: ${existing.email} (id=${existing.id})`);
    console.log('Nothing to do. Use the Supabase dashboard to update display_name or signature if needed.');
    return;
  }

  const { data, error } = await supabase
    .from('mailboxes')
    .insert([{ email, oauth_token: 'smtp', display_name: displayName }])
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
