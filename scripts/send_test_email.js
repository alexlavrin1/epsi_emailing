/**
 * Preview a campaign step. Add --send explicitly to deliver the test.
 *
 * Usage:
 *   npm run test:email
 *   npm run test:email -- --step 2
 *   npm run test:email -- --to you@example.com --step 2 --send
 *   npm run test:email -- --to you@example.com --threaded-sequence --send
 *
 * Defaults: previews step 1 using dummy prospect data; does not send.
 */

require('../src/env');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail, sendReply } = require('../src/outreach/gmail');
const { render, buildVars, pickSubject } = require('../src/outreach/templates');
const config = require('../src/config');

const supabase = createClient(config.supabase.url, config.supabase.key);

const args = process.argv.slice(2);
const toIndex   = args.indexOf('--to');
const stepIndex = args.indexOf('--step');
const shouldSend = args.includes('--send');
const threadedSequence = args.includes('--threaded-sequence');

const TEST_TO       = toIndex   !== -1 ? args[toIndex   + 1] : 'your@email.com';
const STEP          = stepIndex !== -1 ? parseInt(args[stepIndex + 1], 10) : 1;
const CAMPAIGN_NAME = config.localCampaignName;

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

  const vars = buildVars(TEST_PROSPECT, mailbox);

  if (threadedSequence) {
    const { data: steps, error: stepsError } = await supabase
      .from('campaign_steps')
      .select('step_number, subject_template, body_template')
      .eq('campaign_id', campaign.id)
      .order('step_number', { ascending: true });
    if (stepsError) throw stepsError;
    if (!steps || steps.length !== 4) throw new Error('Expected four campaign steps');

    const initialSubject = render(
      pickSubject(steps[0].subject_template, TEST_PROSPECT.email),
      vars
    );

    console.log('\n─── THREADED SEQUENCE TEST ─────────────────────');
    console.log(`From: ${mailbox.display_name} <${mailbox.email}>`);
    console.log(`To:   ${TEST_TO}`);
    for (const step of steps) {
      const effectiveSubject = step.step_number === 1 ? initialSubject : `Re: ${initialSubject}`;
      console.log(`Step ${step.step_number}: ${effectiveSubject}`);
    }
    console.log('────────────────────────────────────────────────────\n');

    if (!shouldSend) {
      console.log('Preview only. Add --send and a real --to address to deliver this thread test.');
      return;
    }
    if (!TEST_TO || TEST_TO === 'your@email.com') {
      throw new Error('A real --to address is required with --send');
    }

    const firstBody = render(steps[0].body_template, vars);
    const first = await sendEmail(
      mailbox.oauth_token,
      mailbox.email,
      TEST_TO,
      initialSubject,
      firstBody,
      { displayName: mailbox.display_name }
    );

    for (const step of steps.slice(1)) {
      await sendReply(
        mailbox.oauth_token,
        mailbox.email,
        TEST_TO,
        first.threadId,
        first.rfcMessageId,
        initialSubject,
        render(step.body_template, vars),
        { displayName: mailbox.display_name }
      );
    }
    console.log(`✓ Sent all four steps as one threaded test to ${TEST_TO}`);
    return;
  }

  const { data: step, error: sErr } = await supabase
    .from('campaign_steps')
    .select('step_number, subject_template, body_template')
    .eq('campaign_id', campaign.id)
    .eq('step_number', STEP)
    .single();

  if (sErr || !step) throw new Error(`Step ${STEP} not found: ${sErr?.message}`);

  let subject = render(pickSubject(step.subject_template, TEST_PROSPECT.email), vars);
  if (STEP > 1) {
    const { data: firstStep, error: firstStepError } = await supabase
      .from('campaign_steps')
      .select('subject_template')
      .eq('campaign_id', campaign.id)
      .eq('step_number', 1)
      .single();
    if (firstStepError) throw firstStepError;
    const initialSubject = render(
      pickSubject(firstStep.subject_template, TEST_PROSPECT.email),
      vars
    );
    subject = `Re: ${initialSubject}`;
  }
  const body    = render(step.body_template, vars);

  let subjectVariants;
  try {
    subjectVariants = JSON.parse(step.subject_template);
    if (!Array.isArray(subjectVariants)) throw new Error();
  } catch {
    subjectVariants = null;
  }

  console.log('\n─── TEST EMAIL PREVIEW ──────────────────────────');
  console.log(`From:    ${mailbox.display_name} <${mailbox.email}>`);
  console.log(`To:      ${TEST_TO}`);
  console.log(`Step:    ${STEP}`);
  if (subjectVariants) {
    console.log('Subject variants (rotated per prospect):');
    subjectVariants.forEach((v, i) => {
      const marker = render(v, vars) === subject ? '→' : ' ';
      console.log(`  ${marker} ${i + 1}. ${render(v, vars)}`);
    });
  } else {
    console.log(`Subject: ${subject}`);
  }
  console.log('─────────────────────────────────────────────────');
  console.log(body);
  console.log('─────────────────────────────────────────────────\n');

  if (!shouldSend) {
    console.log('Preview only. Add --send and a real --to address to deliver this test.');
    return;
  }
  if (STEP > 1) {
    throw new Error('A standalone follow-up cannot verify threading. Use --threaded-sequence --send instead.');
  }
  if (!TEST_TO || TEST_TO === 'your@email.com') {
    throw new Error('A real --to address is required with --send');
  }

  await sendEmail(
    mailbox.oauth_token,
    mailbox.email,
    TEST_TO,
    subject,
    body,
    { displayName: mailbox.display_name }
  );
  console.log(`✓ Sent to ${TEST_TO}`);
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
