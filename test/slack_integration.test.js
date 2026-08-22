const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  validateWorkspace,
  lookupUserByEmail,
  lookupUserByEmailOrName,
  openDirectConversation,
  sendDirectMessage,
  sendChannelMessage,
} = require('../src/integrations/slack/client');
const { renderPaymentActionSlack } = require('../src/payment-recovery/templates');
const {
  processStripeEventRow,
  deliverDueSlackMessages,
} = require('../src/payment-recovery/engine');
const { parseArgs } = require('../scripts/map_crm_customer_slack');

function buildStripeStub({ paid = false } = {}) {
  const invoice = {
    id: 'in_slack',
    status: paid ? 'paid' : 'open',
    amount_remaining: paid ? 0 : 100,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test_slack',
    customer: 'cus_slack',
    subscription: 'sub_slack',
    payment_intent: { id: 'pi_slack', status: paid ? 'succeeded' : 'requires_action' },
  };
  return {
    events: { retrieve: async () => ({
      id: 'evt_slack', type: 'invoice.payment_action_required', created: 1786442022,
      livemode: false, data: { object: { id: invoice.id } },
    }) },
    invoices: { retrieve: async () => invoice },
    subscriptions: { retrieve: async () => ({ id: 'sub_slack', status: 'incomplete' }) },
    paymentIntents: { retrieve: async () => invoice.payment_intent },
    customers: { retrieve: async () => ({ id: 'cus_slack', email: null, name: 'Priya Shah' }) },
  };
}

test('validates that the bot token belongs to the configured workspace', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  try {
    assert.equal((await validateWorkspace({ auth: { test: async () => ({ team_id: 'T_EXPECTED' }) } })).team_id, 'T_EXPECTED');
    await assert.rejects(
      () => validateWorkspace({ auth: { test: async () => ({ team_id: 'T_OTHER' }) } }),
      /different workspace/
    );
  } finally {
    config.slack.teamId = original;
  }
});

test('falls back to one exact Slack display-name match and opens a DM without posting', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  let posted = false;
  const slack = {
    auth: { test: async () => ({ team_id: 'T_EXPECTED' }) },
    users: {
      lookupByEmail: async () => { throw new Error('email lookup unavailable'); },
      list: async () => ({ members: [
        { id: 'U_MATCH', name: 'sam', team_id: 'T_EXPECTED', profile: { display_name: 'Sam Rivera' } },
        { id: 'U_OTHER', name: 'alex', team_id: 'T_EXPECTED', profile: { display_name: 'Alex Doe' } },
      ], response_metadata: { next_cursor: '' } }),
    },
    conversations: { open: async ({ users }) => ({ channel: { id: users === 'U_MATCH' ? 'D_MATCH' : null } }) },
    chat: { postMessage: async () => { posted = true; } },
  };
  try {
    const identity = await lookupUserByEmailOrName('sam@example.com', '@Sam Rivera', slack);
    const conversation = await openDirectConversation(identity.userId, slack);
    assert.deepEqual(identity, { teamId: 'T_EXPECTED', userId: 'U_MATCH', displayName: 'Sam Rivera' });
    assert.deepEqual(conversation, { channelId: 'D_MATCH' });
    assert.equal(posted, false);
  } finally {
    config.slack.teamId = original;
  }
});

test('looks up a Slack user by email only after workspace validation', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  const calls = [];
  try {
    const result = await lookupUserByEmail('client@example.com', {
      auth: { test: async () => { calls.push('auth'); return { team_id: 'T_EXPECTED' }; } },
      users: { lookupByEmail: async ({ email }) => {
        calls.push(email);
        return { user: { id: 'U_CLIENT', team_id: 'T_EXPECTED', profile: { display_name: 'Priya' } } };
      } },
    });
    assert.deepEqual(result, { teamId: 'T_EXPECTED', userId: 'U_CLIENT', displayName: 'Priya' });
    assert.deepEqual(calls, ['auth', 'client@example.com']);
  } finally {
    config.slack.teamId = original;
  }
});

test('rejects missing or deactivated Slack lookup identities', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  try {
    await assert.rejects(() => lookupUserByEmail('missing@example.com', {
      auth: { test: async () => ({ team_id: 'T_EXPECTED' }) },
      users: { lookupByEmail: async () => ({}) },
    }), /no user ID/);
    await assert.rejects(() => lookupUserByEmail('disabled@example.com', {
      auth: { test: async () => ({ team_id: 'T_EXPECTED' }) },
      users: { lookupByEmail: async () => ({ user: { id: 'U_DISABLED', deleted: true } }) },
    }), /deactivated/);
  } finally {
    config.slack.teamId = original;
  }
});

test('opens a bot DM and returns a stable provider message ID', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  const posted = [];
  try {
    const result = await sendDirectMessage('U_CLIENT', 'hello', {
      auth: { test: async () => ({ team_id: 'T_EXPECTED' }) },
      conversations: { open: async ({ users }) => ({ channel: { id: users === 'U_CLIENT' ? 'D_DM' : null } }) },
      chat: { postMessage: async payload => { posted.push(payload); return { ok: true, ts: '123.456' }; } },
    });
    assert.deepEqual(result, { channelId: 'D_DM', ts: '123.456', messageId: 'D_DM:123.456' });
    assert.equal(posted[0].unfurl_links, false);
  } finally {
    config.slack.teamId = original;
  }
});

test('posts an internal channel alert without link unfurls', async () => {
  const original = config.slack.teamId;
  config.slack.teamId = 'T_EXPECTED';
  const posted = [];
  try {
    const result = await sendChannelMessage('C_INTERNAL', 'delivery failed', {
      auth: { test: async () => ({ team_id: 'T_EXPECTED' }) },
      chat: { postMessage: async payload => { posted.push(payload); return { ok: true, ts: '789.012' }; } },
    });
    assert.equal(result.messageId, 'C_INTERNAL:789.012');
    assert.equal(posted[0].channel, 'C_INTERNAL');
    assert.equal(posted[0].unfurl_links, false);
  } finally {
    config.slack.teamId = original;
  }
});

test('renders a concise Slack action message with the trusted Stripe link', () => {
  const text = renderPaymentActionSlack({
    customerName: 'Priya Shah', amountRemaining: 100, currency: 'usd',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test_slack',
  });
  assert.match(text, /^Hi Priya/);
  assert.match(text, /\$1\.00/);
  assert.match(text, /invoice\.stripe\.com/);
  assert.doesNotMatch(text, /client_secret|rk_test|whsec/i);
});

test('schedules Slack independently for an explicitly mapped customer', async () => {
  const original = config.stripe.paymentRecoveryEnabled;
  config.stripe.paymentRecoveryEnabled = true;
  const messages = [];
  try {
    const result = await processStripeEventRow({ id: 'evt_slack' }, {
      stripe: buildStripeStub(),
      db: {
        getPaymentRecoveryCaseByInvoiceId: async () => null,
        upsertCrmCustomer: async record => ({
          id: '0c2f5ec5-e550-419a-8bed-3be2877d59df', ...record,
          status: 'active', email_enabled: false, slack_enabled: true,
          slack_team_id: 'T_EXPECTED', slack_user_id: 'U_CLIENT',
        }),
        upsertPaymentRecoveryCase: async record => ({ id: 'case_slack', ...record }),
        schedulePaymentRecoveryMessage: async record => { messages.push(record); return { duplicate: false }; },
        cancelPaymentRecoveryMessages: async () => [],
      },
    });
    assert.deepEqual(result, { outcome: 'messages_scheduled', channels: ['slack'], duplicates: [] });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].channel, 'slack');
  } finally {
    config.stripe.paymentRecoveryEnabled = original;
  }
});

test('Slack dry-run reports due jobs without claiming or posting', async () => {
  const original = { ...config.slack };
  Object.assign(config.slack, { enabled: true, dryRun: true });
  let claimed = 0;
  try {
    const result = await deliverDueSlackMessages({
      db: {
        getDuePaymentRecoveryMessages: async (_limit, channel) => {
          assert.equal(channel, 'slack');
          return [{ id: 'msg_slack' }];
        },
        markPaymentRecoveryMessageSending: async () => { claimed++; },
      },
    });
    assert.deepEqual(result, { enabled: true, dryRun: true, due: 1, sent: 0, failed: 0, blocked: 0 });
    assert.equal(claimed, 0);
  } finally {
    Object.assign(config.slack, original);
  }
});

test('allowlisted Slack delivery re-checks Stripe and records one DM', async () => {
  const original = { ...config.slack };
  Object.assign(config.slack, {
    enabled: true, dryRun: false, teamId: 'T_EXPECTED', userAllowlist: ['U_CLIENT'],
  });
  const stripe = buildStripeStub();
  const transitions = [];
  try {
    const result = await deliverDueSlackMessages({
      stripe,
      db: {
        getDuePaymentRecoveryMessages: async () => [{
          id: 'msg_slack', channel: 'slack',
          recovery_case: {
            id: 'case_slack', stripe_invoice_id: 'in_slack', state: 'open',
            customer: {
              name: 'Priya Shah', status: 'active', slack_enabled: true,
              slack_team_id: 'T_EXPECTED', slack_user_id: 'U_CLIENT',
            },
          },
        }],
        markPaymentRecoveryMessageSending: async id => { transitions.push(['sending', id]); return { id }; },
        markPaymentRecoveryMessageSent: async (id, providerId) => transitions.push(['sent', id, providerId]),
        markPaymentRecoveryMessageFailed: async () => assert.fail('Slack send must not fail'),
      },
      slack: {
        sendDirectMessage: async (userId, text) => {
          assert.equal(userId, 'U_CLIENT');
          assert.match(text, /invoice\.stripe\.com/);
          return { messageId: 'D_DM:123.456' };
        },
      },
    });
    assert.equal(result.sent, 1);
    assert.deepEqual(transitions, [
      ['sending', 'msg_slack'],
      ['sent', 'msg_slack', 'D_DM:123.456'],
    ]);
  } finally {
    Object.assign(config.slack, original);
  }
});

test('non-allowlisted Slack delivery remains queued and posts nothing', async () => {
  const original = { ...config.slack };
  Object.assign(config.slack, {
    enabled: true, dryRun: false, teamId: 'T_EXPECTED', userAllowlist: ['U_INTERNAL'],
  });
  let claimed = 0;
  let posted = 0;
  try {
    const result = await deliverDueSlackMessages({
      db: {
        getDuePaymentRecoveryMessages: async () => [{
          id: 'msg_blocked', channel: 'slack',
          recovery_case: {
            state: 'open',
            customer: {
              status: 'active', slack_enabled: true,
              slack_team_id: 'T_EXPECTED', slack_user_id: 'U_EXTERNAL',
            },
          },
        }],
        markPaymentRecoveryMessageSending: async () => { claimed++; },
      },
      slack: { sendDirectMessage: async () => { posted++; } },
    });
    assert.equal(result.blocked, 1);
    assert.equal(claimed, 0);
    assert.equal(posted, 0);
  } finally {
    Object.assign(config.slack, original);
  }
});

test('Slack mapping CLI is preview-only unless --confirm is explicit', () => {
  assert.deepEqual(parseArgs([
    '--stripe-customer', 'cus_123', '--slack-email', 'person@example.com',
  ]), {
    stripeCustomerId: 'cus_123', slackEmail: 'person@example.com', confirm: false,
  });
  assert.equal(parseArgs([
    '--stripe-customer', 'cus_123', '--slack-email', 'person@example.com', '--confirm',
  ]).confirm, true);
  assert.deepEqual(parseArgs(['--stripe-customer', 'cus_123']), {
    stripeCustomerId: 'cus_123', slackEmail: null, confirm: false,
  });
});
