const test = require('node:test');
const assert = require('node:assert/strict');

const { render, buildVars, pickSubject } = require('../src/outreach/templates');
const {
  isBounceSender,
  isUnsubscribeReply,
  composeRawMessage,
  findSentMailbox,
} = require('../src/outreach/gmail');
const { normalizeEmail, normalizeLead } = require('../scripts/sync_instantly_leads');
const { SUBJECT, STEPS, UNSUBSCRIBE_COPY } = require('../scripts/setup_campaign_steps');

test('renders the approved lead and sender variables', () => {
  const vars = buildVars(
    { email: 'lead@example.com', first_name: 'Priya', company: 'Example App' },
    { display_name: 'Alexander Lavrin', signature: 'Alex\nEpsiFlow' }
  );
  assert.equal(
    render('Hi {{firstName}} at {{companyName}}\n\n{{signature}}', vars),
    'Hi Priya at Example App\n\nAlex\nEpsiFlow'
  );
});

test('subject selection is stable for the same prospect', () => {
  const variants = JSON.stringify(['shopify ads', 'ad payments']);
  assert.equal(pickSubject(variants, 'prospect-1'), pickSubject(variants, 'prospect-1'));
});

test('normalizes Instantly leads without reactivating prospect status', () => {
  assert.equal(normalizeEmail('  PERSON@Example.COM '), 'person@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.deepEqual(normalizeLead({
    email: ' PERSON@Example.COM ',
    first_name: 'Priya',
    last_name: 'Shah',
    company_name: 'Example App',
    job_title: 'Founder',
  }), {
    email: 'person@example.com',
    first_name: 'Priya',
    last_name: 'Shah',
    company: 'Example App',
    title: 'Founder',
    linkedin_url: null,
  });
});

test('classifies replies, unsubscribe requests, and common bounces', () => {
  assert.equal(isUnsubscribeReply('Re: Shopify Ads', 'unsubscribe\n\n> old message'), true);
  assert.equal(isUnsubscribeReply('Re: Shopify Ads', 'Sounds useful'), false);
  assert.equal(isBounceSender('mailer-daemon@example.com', 'Delivery failed'), true);
  assert.equal(isBounceSender('person@example.com', 'Re: Shopify Ads'), false);
});

test('composes one auditable RFC822 message for SMTP and Sent archiving', async () => {
  const message = await composeRawMessage({
    from: { name: 'Alex', address: 'sender@example.com' },
    replyTo: 'sender@example.com',
    to: 'lead@example.com',
    subject: 'Shopify Ads',
    text: 'Hello',
    headers: { 'List-Unsubscribe': '<mailto:sender@example.com?subject=unsubscribe>' },
  });

  const raw = message.raw.toString('utf8');
  assert.match(raw, /Subject: Shopify Ads/);
  assert.match(raw, /Message-ID:/i);
  assert.match(raw, /List-Unsubscribe:/i);
  assert.match(raw, /Hello/);
  assert.equal(message.envelope.from, 'sender@example.com');
  assert.deepEqual(message.envelope.to, ['lead@example.com']);
});

test('finds the provider Sent mailbox by special-use flag or path', () => {
  assert.equal(findSentMailbox([
    { path: 'Archive' },
    { path: 'Sent', specialUse: '\\Sent' },
  ]).path, 'Sent');
  assert.equal(findSentMailbox([{ path: 'Sent Items' }]).path, 'Sent Items');
});

test('local sequence matches the approved Instantly cadence and safety footer', () => {
  assert.equal(SUBJECT, 'Shopify Ads');
  assert.deepEqual(STEPS.map(step => step.delay_days), [0, 3, 5, 6]);
  assert.equal(STEPS.length, 4);
  assert.ok(STEPS.every(step => step.body_template.includes('{{signature}}')));
  assert.ok(STEPS.every(step => step.body_template.includes(UNSUBSCRIBE_COPY)));
});
