const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  processStripeEventRow,
  reconcilePaymentRecoveryCases,
  scheduleDuePaymentRecoveryReminders,
  deliverDueInternalRecoveryAlerts,
  deliverRecoveryFailureAlerts,
} = require('../src/payment-recovery/engine');

function stripeContext({ id = 'in_phase6', paid = false } = {}) {
  const invoice = {
    id,
    livemode: false,
    status: paid ? 'paid' : 'open',
    amount_remaining: paid ? 0 : 2500,
    currency: 'usd',
    hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    customer: 'cus_phase6',
    customer_email: 'client@example.com',
    subscription: 'sub_phase6',
    payment_intent: {
      id: 'pi_phase6',
      status: paid ? 'succeeded' : 'requires_action',
    },
  };
  return {
    invoice,
    subscription: {
      id: 'sub_phase6',
      status: paid ? 'active' : 'incomplete',
      latest_invoice: id,
    },
    customer: { id: 'cus_phase6', email: 'client@example.com', name: 'Priya Shah' },
  };
}

function stripeStub(context, recent = []) {
  return {
    events: {
      retrieve: async () => ({
        id: 'evt_phase6',
        type: 'invoice.payment_action_required',
        created: 1786528800,
        livemode: false,
        data: { object: { id: context.invoice.id } },
      }),
    },
    invoices: {
      retrieve: async id => {
        assert.equal(id, context.invoice.id);
        return context.invoice;
      },
      list: async () => ({ data: recent }),
    },
    subscriptions: { retrieve: async () => context.subscription },
    paymentIntents: { retrieve: async () => context.invoice.payment_intent },
    customers: { retrieve: async () => context.customer },
  };
}

test('Phase 6 cadence sends email now, delays Slack, and sets the final reminder cursor', async () => {
  const originalStripe = { ...config.stripe };
  const originalReminders = { ...config.paymentRecoveryReminders };
  Object.assign(config.stripe, { paymentRecoveryEnabled: true, allowLiveEvents: false });
  Object.assign(config.paymentRecoveryReminders, {
    enabled: true,
    finalDelayHours: 8,
    finalDelayMinutes: 5,
    slackInitialDelayMinutes: 20,
  });
  const context = stripeContext();
  const cases = [];
  const messages = [];
  const now = '2026-08-12T10:00:00.000Z';
  try {
    await processStripeEventRow({ id: 'evt_phase6' }, {
      now,
      stripe: stripeStub(context),
      db: {
        getPaymentRecoveryCaseByInvoiceId: async () => null,
        upsertCrmCustomer: async record => ({
          ...customer(record),
          slack_enabled: true,
          slack_team_id: 'T_EXPECTED',
          slack_user_id: 'U_CLIENT',
        }),
        upsertPaymentRecoveryCase: async record => {
          cases.push(record);
          return { id: 'case_cadence', ...record };
        },
        schedulePaymentRecoveryMessage: async record => {
          messages.push(record);
          return { duplicate: false, message: record };
        },
      },
    });
    assert.equal(cases[0].next_reminder_at, '2026-08-12T10:05:00.000Z');
    assert.deepEqual(messages.map(message => [message.channel, message.scheduled_for]), [
      ['email', '2026-08-12T10:00:00.000Z'],
      ['slack', '2026-08-12T10:20:00.000Z'],
    ]);
  } finally {
    Object.assign(config.stripe, originalStripe);
    Object.assign(config.paymentRecoveryReminders, originalReminders);
  }
});

function customer(record) {
  return {
    id: 'customer_phase6',
    ...record,
    status: 'active',
    email_enabled: true,
    slack_enabled: false,
    slack_team_id: null,
    slack_user_id: null,
  };
}

test('reconciliation is inert while its independent kill switch is off', async () => {
  const original = config.stripe.reconciliationEnabled;
  config.stripe.reconciliationEnabled = false;
  try {
    const result = await reconcilePaymentRecoveryCases({
      db: { getOpenPaymentRecoveryCases: async () => assert.fail('must not query') },
    });
    assert.deepEqual(result, {
      enabled: false, checked: 0, resolved: 0, actionable: 0, discovered: 0, failed: 0,
    });
  } finally {
    config.stripe.reconciliationEnabled = original;
  }
});

test('reconciliation resolves a paid open case and cancels queued work', async () => {
  const originalStripe = { ...config.stripe };
  Object.assign(config.stripe, {
    reconciliationEnabled: true,
    reconciliationCaseLimit: 25,
    paymentRecoveryEnabled: true,
    allowLiveEvents: false,
  });
  const context = stripeContext({ paid: true });
  const openCase = {
    id: 'case_phase6', stripe_invoice_id: context.invoice.id, next_reminder_at: null,
  };
  const cancelled = [];
  try {
    const result = await reconcilePaymentRecoveryCases({
      stripe: stripeStub(context),
      db: {
        getOpenPaymentRecoveryCases: async () => [openCase],
        getPaymentRecoveryCaseByInvoiceId: async () => openCase,
        upsertCrmCustomer: async record => customer(record),
        upsertPaymentRecoveryCase: async record => ({ id: openCase.id, ...record }),
        cancelPaymentRecoveryMessages: async id => { cancelled.push(id); return []; },
        markPaymentRecoveryCaseReconciled: async () => ({}),
      },
    });
    assert.equal(result.checked, 1);
    assert.equal(result.resolved, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(cancelled, ['case_phase6']);
  } finally {
    Object.assign(config.stripe, originalStripe);
  }
});

test('reconciliation discovers an actionable invoice missed by webhooks', async () => {
  const originalStripe = { ...config.stripe };
  Object.assign(config.stripe, {
    reconciliationEnabled: true,
    reconciliationCaseLimit: 25,
    reconciliationLookbackHours: 48,
    paymentRecoveryEnabled: true,
    allowLiveEvents: false,
  });
  const context = stripeContext({ id: 'in_missed' });
  const messages = [];
  try {
    const result = await reconcilePaymentRecoveryCases({
      stripe: stripeStub(context, [{ id: context.invoice.id, livemode: false }]),
      db: {
        getOpenPaymentRecoveryCases: async () => [],
        getPaymentRecoveryCaseByInvoiceId: async () => null,
        upsertCrmCustomer: async record => customer(record),
        upsertPaymentRecoveryCase: async record => ({ id: 'case_missed', ...record }),
        markPaymentRecoveryCaseReconciled: async () => ({}),
        schedulePaymentRecoveryMessage: async record => {
          messages.push(record);
          return { duplicate: false, message: record };
        },
      },
    });
    assert.equal(result.discovered, 1);
    assert.equal(result.actionable, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].channel, 'email');
    assert.equal(messages[0].step_number, 1);
  } finally {
    Object.assign(config.stripe, originalStripe);
  }
});

test('a due final reminder is scheduled once and clears the case reminder cursor', async () => {
  const originalStripe = { ...config.stripe };
  const originalReminders = { ...config.paymentRecoveryReminders };
  Object.assign(config.stripe, { paymentRecoveryEnabled: true, allowLiveEvents: false });
  Object.assign(config.paymentRecoveryReminders, { enabled: true, caseLimit: 25 });
  const context = stripeContext();
  const dueCase = {
    id: 'case_due',
    stripe_invoice_id: context.invoice.id,
    next_reminder_at: '2026-08-12T00:00:00.000Z',
  };
  const messages = [];
  const reminderUpdates = [];
  try {
    const result = await scheduleDuePaymentRecoveryReminders({
      now: '2026-08-12T10:00:00.000Z',
      stripe: stripeStub(context),
      db: {
        getDuePaymentRecoveryReminderCases: async () => [dueCase],
        getPaymentRecoveryCaseByInvoiceId: async () => dueCase,
        upsertCrmCustomer: async record => customer(record),
        upsertPaymentRecoveryCase: async record => ({ id: dueCase.id, ...record }),
        schedulePaymentRecoveryMessage: async record => {
          messages.push(record);
          return { duplicate: record.step_number === 1, message: record };
        },
        setPaymentRecoveryNextReminder: async (id, value) => reminderUpdates.push([id, value]),
        markPaymentRecoveryCaseReconciled: async () => ({}),
      },
    });
    assert.equal(result.due, 1);
    assert.equal(result.scheduled, 1);
    assert.deepEqual(messages.map(message => message.step_number), [1, 2]);
    assert.deepEqual(reminderUpdates, [['case_due', null]]);
  } finally {
    Object.assign(config.stripe, originalStripe);
    Object.assign(config.paymentRecoveryReminders, originalReminders);
  }
});

test('failure-alert dry-run reports exhausted jobs without claiming them', async () => {
  const original = { ...config.slack };
  Object.assign(config.slack, {
    failureAlertsEnabled: true,
    failureAlertsDryRun: true,
    failureAlertChannelId: 'C_INTERNAL',
  });
  let claimed = 0;
  try {
    const result = await deliverRecoveryFailureAlerts({
      db: {
        getExhaustedPaymentRecoveryMessages: async () => [{ id: 'msg_failed' }],
        claimPaymentRecoveryFailureAlert: async () => { claimed++; },
      },
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.due, 1);
    assert.equal(claimed, 0);
  } finally {
    Object.assign(config.slack, original);
  }
});

test('internal recovery alerts schedule operator email and channel jobs without customer delivery', async () => {
  const originalStripe = { ...config.stripe };
  const originalInternal = { ...config.paymentRecoveryInternalAlerts };
  Object.assign(config.stripe, { paymentRecoveryEnabled: false, allowLiveEvents: false });
  Object.assign(config.paymentRecoveryInternalAlerts, {
    enabled: true,
    dryRun: true,
    emailEnabled: true,
    email: 'operator@example.com',
    slackChannelId: 'C_INTERNAL',
  });
  const context = stripeContext();
  const messages = [];
  try {
    const result = await processStripeEventRow({ id: 'evt_phase6' }, {
      stripe: stripeStub(context),
      db: {
        getPaymentRecoveryCaseByInvoiceId: async () => null,
        upsertCrmCustomer: async record => customer(record),
        upsertPaymentRecoveryCase: async record => ({ id: 'case_internal', ...record }),
        schedulePaymentRecoveryMessage: async record => {
          messages.push(record);
          return { duplicate: false, message: record };
        },
      },
    });
    assert.equal(result.outcome, 'messages_scheduled');
    assert.deepEqual(messages.map(message => message.channel), ['internal_email', 'internal_slack']);
  } finally {
    Object.assign(config.stripe, originalStripe);
    Object.assign(config.paymentRecoveryInternalAlerts, originalInternal);
  }
});

test('internal recovery delivery emails the operator and posts to the configured channel', async () => {
  const original = { ...config.paymentRecoveryInternalAlerts };
  Object.assign(config.paymentRecoveryInternalAlerts, {
    enabled: true,
    dryRun: false,
    emailEnabled: true,
    email: 'operator@example.com',
    slackChannelId: 'C_INTERNAL',
  });
  const context = stripeContext();
  const recoveryCase = {
    id: 'case_internal',
    state: 'open',
    stripe_invoice_id: context.invoice.id,
    customer: { name: 'Priya Shah', email: 'client@example.com' },
  };
  const sent = [];
  try {
    const result = await deliverDueInternalRecoveryAlerts({
      stripe: stripeStub(context),
      db: {
        getDuePaymentRecoveryMessages: async (_limit, channel) => [{
          id: `msg_${channel}`,
          channel,
          recovery_case: recoveryCase,
        }],
        markPaymentRecoveryMessageSending: async id => ({ id }),
        markPaymentRecoveryMessageSent: async (id, providerId) => sent.push([id, providerId]),
        markPaymentRecoveryMessageFailed: async () => assert.fail('delivery must not fail'),
        cancelPaymentRecoveryMessage: async () => assert.fail('action is still required'),
        cancelPaymentRecoveryMessages: async () => assert.fail('action is still required'),
      },
      mailer: {
        sendTransactionalEmail: async (_from, to, subject, body) => {
          assert.equal(to, 'operator@example.com');
          assert.match(subject, /Priya Shah/);
          assert.match(body, /internal alert/i);
          return { rfcMessageId: '<internal@example.com>' };
        },
      },
      slack: {
        sendChannelMessage: async (channel, text) => {
          assert.equal(channel, 'C_INTERNAL');
          assert.match(text, /Customer payment requires authentication/);
          assert.match(text, /in_phase6/);
          return { messageId: 'C_INTERNAL:123.456' };
        },
      },
    });
    assert.deepEqual(result, {
      enabled: true, dryRun: false, due: 2, sent: 2, failed: 0, blocked: 0,
    });
    assert.deepEqual(sent, [
      ['msg_internal_email', '<internal@example.com>'],
      ['msg_internal_slack', 'C_INTERNAL:123.456'],
    ]);
  } finally {
    Object.assign(config.paymentRecoveryInternalAlerts, original);
  }
});

test('failure alerts are claimed atomically and record the Slack provider ID', async () => {
  const original = { ...config.slack };
  Object.assign(config.slack, {
    failureAlertsEnabled: true,
    failureAlertsDryRun: false,
    failureAlertChannelId: 'C_INTERNAL',
  });
  const message = {
    id: 'msg_failed', channel: 'email', attempt_count: 3, last_error: 'SMTP unavailable',
    recovery_case: { stripe_invoice_id: 'in_failed' },
  };
  const transitions = [];
  try {
    const result = await deliverRecoveryFailureAlerts({
      db: {
        getExhaustedPaymentRecoveryMessages: async () => [message],
        claimPaymentRecoveryFailureAlert: async id => { transitions.push(['claim', id]); return message; },
        markPaymentRecoveryFailureAlertSent: async (id, providerId) => {
          transitions.push(['sent', id, providerId]);
        },
        markPaymentRecoveryFailureAlertFailed: async () => assert.fail('alert must not fail'),
      },
      slack: {
        sendChannelMessage: async (channelId, text) => {
          assert.equal(channelId, 'C_INTERNAL');
          assert.match(text, /in_failed/);
          assert.doesNotMatch(text, /invoice\.stripe\.com/);
          return { messageId: 'C_INTERNAL:123.456' };
        },
      },
    });
    assert.equal(result.sent, 1);
    assert.deepEqual(transitions, [
      ['claim', 'msg_failed'],
      ['sent', 'msg_failed', 'C_INTERNAL:123.456'],
    ]);
  } finally {
    Object.assign(config.slack, original);
  }
});
