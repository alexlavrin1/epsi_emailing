const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OUTREACH_ENABLED = 'false';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { deliverOperatorEmailReplies } = require('../src/outreach/engine');

function queuedReply(overrides = {}) {
  return {
    id: 'reply-job-1',
    body: 'Thanks — here are the next steps.',
    source_reply: {
      gmail_message_id: '<inbound@example.com>',
      subject: 'Interested',
      prospect: { email: 'prospect@example.com', status: 'active' },
      outreach_send: {
        gmail_thread_id: '<thread@example.com>',
        campaign: { mailbox: { email: 'sender@example.com', display_name: 'EPSI', oauth_token: 'server-only' } },
      },
    },
    ...overrides,
  };
}

test('claims and sends an approved operator reply once', async () => {
  const calls = [];
  const row = queuedReply();
  const db = {
    getQueuedOperatorEmailReplies: async () => [row],
    claimOperatorEmailReply: async id => { calls.push(['claim', id]); return row; },
    markOperatorEmailReplySent: async (id, messageId) => calls.push(['sent', id, messageId]),
    markOperatorEmailReplyFailed: async () => assert.fail('reply should not fail'),
  };
  const mailer = { sendReply: async (...args) => { calls.push(['send', ...args]); return { messageId: '<outbound@example.com>' }; } };
  const result = await deliverOperatorEmailReplies({ db, mailer });
  assert.deepEqual(result, { due: 1, sent: 1, failed: 0 });
  assert.equal(calls[0][0], 'claim');
  assert.equal(calls[1][0], 'send');
  assert.equal(calls[1][3], 'prospect@example.com');
  assert.equal(calls[2][0], 'sent');
});

test('records invalid reply context as failed without calling SMTP', async () => {
  const row = queuedReply({ source_reply: { prospect: { email: 'prospect@example.com', status: 'suppressed' } } });
  let failure;
  const db = {
    getQueuedOperatorEmailReplies: async () => [row],
    claimOperatorEmailReply: async () => row,
    markOperatorEmailReplySent: async () => assert.fail('reply should not be sent'),
    markOperatorEmailReplyFailed: async (_id, message) => { failure = message; },
  };
  const mailer = { sendReply: async () => assert.fail('SMTP should not be called') };
  const result = await deliverOperatorEmailReplies({ db, mailer });
  assert.deepEqual(result, { due: 1, sent: 0, failed: 1 });
  assert.match(failure, /context is incomplete|not active/i);
});

test('skips a reply another worker already claimed', async () => {
  const row = queuedReply();
  const db = {
    getQueuedOperatorEmailReplies: async () => [row],
    claimOperatorEmailReply: async () => null,
  };
  const mailer = { sendReply: async () => assert.fail('SMTP should not be called') };
  const result = await deliverOperatorEmailReplies({ db, mailer });
  assert.deepEqual(result, { due: 1, sent: 0, failed: 0 });
});

test('continues safely before the operator reply migration is installed', async () => {
  const db = {
    getQueuedOperatorEmailReplies: async () => { const error = new Error("Could not find the table 'public.operator_email_replies' in the schema cache"); error.code = 'PGRST205'; throw error; },
  };
  const result = await deliverOperatorEmailReplies({ db, mailer: {} });
  assert.deepEqual(result, { enabled: false, due: 0, sent: 0, failed: 0 });
});
