const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OUTREACH_ENABLED = 'false';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const config = require('../src/config');
const { deliverClientPlaybookEmails } = require('../src/outreach/engine');

function approvedDraft(overrides = {}) {
  return {
    id: '2a18057b-b83a-45c6-941b-59fb29eb1c2d',
    recipient_email: 'client@example.com',
    subject: 'EpsiFlow next steps',
    body: 'Here are the next steps.',
    reply_to_message_id: '<inbound@example.com>',
    ...overrides,
  };
}

function enableDelivery(allowlist = ['client@example.com']) {
  config.clientSuccessEmail.enabled = true;
  config.clientSuccessEmail.dryRun = false;
  config.clientSuccessEmail.allowlist = allowlist;
  config.clientSuccessEmail.limit = 10;
  config.yandex.email = 'alex@epsifund.com';
}

test('approved client email is claimed, threaded, and completed once', async () => {
  enableDelivery();
  const draft = approvedDraft();
  const calls = [];
  const db = {
    claimClientPlaybookEmailDeliveries: async limit => { calls.push(['claim', limit]); return [draft]; },
    completeClientPlaybookEmailDelivery: async (...args) => calls.push(['complete', ...args]),
    failClientPlaybookEmailDelivery: async () => assert.fail('delivery should not fail'),
  };
  const mailer = { sendClientSuccessEmail: async (...args) => { calls.push(['send', ...args]); return { rfcMessageId: '<outbound@epsifund.com>' }; } };
  const result = await deliverClientPlaybookEmails({ db, mailer });
  assert.deepEqual(result, { enabled: true, dryRun: false, due: 1, sent: 1, failed: 0 });
  assert.deepEqual(calls[0], ['claim', 1]);
  assert.equal(calls[1][0], 'send');
  assert.equal(calls[1][2], 'client@example.com');
  assert.equal(calls[1][5].inReplyTo, '<inbound@example.com>');
  assert.equal(calls[1][5].messageId, `<epsiflow-client-${draft.id}@epsifund.com>`);
  assert.deepEqual(calls[2], ['complete', draft.id, '<outbound@epsifund.com>']);
});

test('delivery controls leave queued emails untouched while disabled or in dry-run', async () => {
  const db = { claimClientPlaybookEmailDeliveries: async () => assert.fail('queue must not be claimed') };
  config.clientSuccessEmail.enabled = false;
  config.clientSuccessEmail.dryRun = true;
  assert.deepEqual(await deliverClientPlaybookEmails({ db }), { enabled: false, dryRun: true, due: 0, sent: 0, failed: 0 });
  config.clientSuccessEmail.enabled = true;
  assert.deepEqual(await deliverClientPlaybookEmails({ db }), { enabled: true, dryRun: true, due: 0, sent: 0, failed: 0 });
});

test('a non-allowlisted recipient fails closed without SMTP', async () => {
  enableDelivery(['operator@example.com']);
  const draft = approvedDraft();
  let failure;
  const db = {
    claimClientPlaybookEmailDeliveries: async () => [draft],
    completeClientPlaybookEmailDelivery: async () => assert.fail('delivery should not complete'),
    failClientPlaybookEmailDelivery: async (...args) => { failure = args; },
  };
  const mailer = { sendClientSuccessEmail: async () => assert.fail('SMTP must not be called') };
  const result = await deliverClientPlaybookEmails({ db, mailer });
  assert.deepEqual(result, { enabled: true, dryRun: false, due: 1, sent: 0, failed: 1 });
  assert.deepEqual(failure, [draft.id, 'recipient_not_allowlisted', false]);
});
