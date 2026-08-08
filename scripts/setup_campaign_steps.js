/**
 * Create (or update) a campaign and its email sequence (step 1 + 3 follow-ups).
 * Run this after setup:mailbox and before enroll:prospects.
 *
 * Usage:
 *   node scripts/setup_campaign_steps.js
 *   node scripts/setup_campaign_steps.js "Epsi Test v1 - Local"
 *
 * What it does:
 *   - Finds the campaign by name, or creates it PAUSED using YANDEX_EMAIL
 *   - Upserts steps 1-4 with the subject/body content + delay_days below
 *
 * Note: for step 2+, engine.js always sends as a threaded reply using step 1's
 * subject line (with "Re:" prefixed) — each follow-up's own subject_template
 * below is never used for the real send, only for the standalone test:email
 * preview. It still has to be non-null because of the schema constraint.
 *
 * Edit STEPS below to change copy or timing, then re-run — safe to run
 * repeatedly, it just overwrites each step's content.
 */

require('../src/env');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const config = require('../src/config');

const SUBJECT = 'Shopify Ads';
const UNSUBSCRIBE_COPY = "If you'd rather not hear from me, reply with unsubscribe.";

const STEPS = [
  {
    step_number: 1,
    delay_days: 0,
    subject_template: SUBJECT,
    body_template: `Hi {{firstName}},

Quick question: do Indian card or cross-border payment restrictions ever get in the way of running Shopify Ads at {{companyName}}?

EpsiFlow provides the account and digital card infrastructure for eligible ad spend.

Would a short overview be useful?

{{signature}}

${UNSUBSCRIBE_COPY}`,
  },
  {
    step_number: 2,
    delay_days: 3, // 3 days after step 1
    subject_template: '',
    body_template: `Hi {{firstName}},

When a Shopify Ads payment fails, the cost isn't only the admin work. Campaigns can pause while the team finds another card or banking route.

The EpsiFlow setup includes a dedicated balance, transaction visibility, and invoices in one account.

Would it help if I sent the setup outline?

{{signature}}

${UNSUBSCRIBE_COPY}`,
  },
  {
    step_number: 3,
    delay_days: 5, // 5 days after step 2 (day 8 total)
    subject_template: '',
    body_template: `Hi {{firstName}},

The setup is fairly light: create an EpsiFund account, EpsiFlow provisions the bank account and digital card, then the details are handed over on a short call.

If Shopify Ads are on {{companyName}}'s roadmap, want me to send the onboarding steps?

{{signature}}

${UNSUBSCRIBE_COPY}`,
  },
  {
    step_number: 4,
    delay_days: 6, // 6 days after step 3 (day 14 total)
    subject_template: '',
    body_template: `Hi {{firstName}},

I'll close the loop after this.

If Shopify Ads payments aren't a constraint for {{companyName}}, there's nothing to do. If they are, reply "setup" and I'll send the steps.

{{signature}}

${UNSUBSCRIBE_COPY}`,
  },
];

async function main() {
  if (!config.supabase.isServerKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for campaign setup');
  }
  const campaignName = process.argv[2] || config.localCampaignName;

  let { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('name', campaignName)
    .maybeSingle();
  if (cErr) throw cErr;

  if (!campaign) {
    const { data: mailbox, error: mErr } = await supabase
      .from('mailboxes')
      .select('id, email')
      .eq('email', process.env.YANDEX_EMAIL)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!mailbox) {
      console.error(`Campaign "${campaignName}" not found and no mailbox is registered.`);
      console.error('Run: npm run setup:mailbox');
      process.exit(1);
    }

    const { data: created, error: crErr } = await supabase
      .from('campaigns')
      .insert([{ name: campaignName, from_mailbox_id: mailbox.id, status: 'paused' }])
      .select()
      .single();
    if (crErr) throw crErr;
    campaign = created;
    console.log(`Created paused campaign "${campaign.name}" using the configured Yandex mailbox`);
  } else {
    if (campaign.status !== 'paused') {
      const { data: paused, error: pauseError } = await supabase
        .from('campaigns')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', campaign.id)
        .select('id, name, status')
        .single();
      if (pauseError) throw pauseError;
      campaign = paused;
    }
    console.log(`Campaign: "${campaign.name}" (${campaign.status})`);
  }

  const rows = STEPS.map(s => ({ campaign_id: campaign.id, ...s }));
  const { error: sErr } = await supabase
    .from('campaign_steps')
    .upsert(rows, { onConflict: 'campaign_id,step_number' });
  if (sErr) throw sErr;

  console.log(`\n✓ ${STEPS.length} step(s) saved for "${campaign.name}"`);
  let cumulativeDays = 0;
  STEPS.forEach(s => {
    cumulativeDays += s.delay_days;
    const timing = s.step_number === 1 ? 'sent immediately' : `day ${cumulativeDays} (${s.delay_days}d after previous)`;
    console.log(`  Step ${s.step_number} — ${timing}`);
  });
  console.log(`\n  Step 1 subject: ${SUBJECT}`);
  console.log('\nNext:');
  console.log('  npm run test:email');
  console.log('  npm run test:email -- --step 2');
  console.log('  npm run test:email -- --to you@example.com --step 1 --send');
  console.log('  npm run sync:instantly:dry');
  console.log('  npm run sync:instantly -- --enroll');
  console.log('\nThe campaign remains paused and OUTREACH_ENABLED remains false until explicitly activated.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('[fatal]', err.message);
    process.exit(1);
  });
}

module.exports = { SUBJECT, STEPS, UNSUBSCRIBE_COPY };
