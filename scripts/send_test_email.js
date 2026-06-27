/**
 * Send a test version of campaign step 1 to verify your mailbox + templates.
 *
 * Usage:
 *   npm run test:email
 *   npm run test:email -- --to you@example.com
 *   npm run test:email -- --step 2
 *
 * Defaults: sends step 1 to the address in TEST_TO using dummy prospect data.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../src/outreach/gmail');
const { render, buildVars } = require('../src/outreach/templates');
const config = require('../src/config');

const supabase = createClient(config.supabase.url, config.supabase.key);

const args = process.argv.slice(2);
const toIndex   = args.indexOf('--to');
const stepIndex = args.indexOf('--step');

const TEST_TO       = toIndex   !== -1 ? args[toIndex   + 1] : 'your@email.com';
const STEP          = stepIndex !== -1 ? parseInt(args[stepIndex + 1], 10) : 1;
const CAMPAIGN_NAME = 'EPSI Fund Outreach';

const TEST_PROSPECT = {
  first_name: 'Alex',
  last_name:  'Test',
  company:    'EPSI Fund',
  email:      TEST_TO,
};

async function main() {
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, name, from_mailbox_id, mailboxes(email, display_name, oauth_token, signature)')
    .eq('name', CAMPAIGN_NAME)
    .single();

  if (cErr || !campaign) throw new Error(`Campaign "${CAMPAIGN_NAME}" not found: ${cErr?.message}`);

  const mailbox = campaign.mailboxes;
  if (!mailbox) throw new Error('No mailbox linked to campaign');

  const { data: step, error: sErr } = await supabase
    .from('campaign_steps')
    .select('step_number, subject_template, body_template')
    .eq('campaign_id', campaign.id)
    .eq('step_number', STEP)
    .single();

  if (sErr || !step) throw new Error(`Step ${STEP} not found: ${sErr?.message}`);

  const vars    = buildVars(TEST_PROSPECT, mailbox);
  const subject = render(step.subject_template, vars);
  const body    = render(step.body_template,    vars);

  console.log('\n─── TEST EMAIL PREVIEW ──────────────────────────');
  console.log(`From:    ${mailbox.display_name} <${mailbox.email}>`);
  console.log(`To:      ${TEST_TO}`);
  console.log(`Step:    ${STEP}`);
  console.log(`Subject: ${subject}`);
  console.log('─────────────────────────────────────────────────');
  console.log(body);
  console.log('─────────────────────────────────────────────────\n');

  await sendEmail(mailbox.oauth_token, mailbox.email, TEST_TO, subject, body);
  console.log(`✓ Sent to ${TEST_TO}`);
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
