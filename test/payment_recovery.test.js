const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  isTrustedHostedInvoiceUrl,
  formatAmount,
  renderPaymentActionEmail,
} = require('../src/payment-recovery/templates');
const {
  requiresCustomerAction,
  processStripeEventRow,
  deliverDueTransactionalEmails,
} = require('../src/payment-recovery/engine');

function buildStripeContext({ paid = false, requiresAction = true } = {}) {
  const invoice = {
    id: 'in_phase4',
    status: paid ? 'paid' : 'open',
    amount_remaining: paid ? 0 : 100,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test_phase4',
    customer: 'cus_phase4',
    customer_email: 'client@example.com',
    subscription: 'sub_phase4',
    payment_intent: {
      id: 'pi_phase4',
      status: paid ? 'succeeded' : (requiresAction ? 'requires_action' : 'requires_payment_method'),
    },
  };
  return {
    invoice,
    subscription: { id: 'sub_phase4', status: paid ? 'active' : 'incomplete', latest_invoice: invoice.id },
    customer: { id: 'cus_phase4', email: 'client@example.com', name: 'Priya Shah' },
  };
}

function buildStripeStub(options = {}) {
  const context = buildStripeContext(options);
  return {
    events: {
      retrieve: async () => ({
        id: 'evt_phase4',
        type: options.eventType || 'invoice.payment_action_required',
        created: 1786442022,
        livemode: false,
        data: { object: { id: context.invoice.id } },
      }),
    },
    invoices: { retrieve: async () => context.invoice },
    subscriptions: { retrieve: async () => context.subscription },
    paymentIntents: { retrieve: async () => context.invoice.payment_intent },
    customers: { retrieve: async () => context.customer },
  };
}

function buildDbStub(existingCase = null) {
  const calls = { customers: [], cases: [], messages: [], cancelledCases: [] };
  return {
    calls,
    getPaymentRecoveryCaseByInvoiceId: async () => existingCase,
    upsertCrmCustomer: async record => {
      calls.customers.push(record);
      return { id: '02f8033e-c85a-4d69-a618-b20e7725299b', ...record, status: 'active', email_enabled: true };
    },
    upsertPaymentRecoveryCase: async record => {
      calls.cases.push(record);
      return { id: '62488a62-90ed-4727-93d3-2d753193ef8f', ...record };
    },
    cancelPaymentRecoveryMessages: async id => { calls.cancelledCases.push(id); return []; },
    schedulePaymentRecoveryMessage: async record => {
      calls.messages.push(record);
      return { duplicate: false, message: record };
    },
  };
}

test('accepts only Stripe HTTPS hosted invoice links', () => {
  assert.equal(isTrustedHostedInvoiceUrl('https://invoice.stripe.com/i/test'), true);
  assert.equal(isTrustedHostedInvoiceUrl('http://invoice.stripe.com/i/test'), false);
  assert.equal(isTrustedHostedInvoiceUrl('https://invoice.stripe.com.evil.example/i/test'), false);
  assert.equal(isTrustedHostedInvoiceUrl('not-a-url'), false);
});

test('renders a concise payment-action email without outreach headers or secrets', () => {
  assert.equal(formatAmount(12345, 'usd'), '$123.45');
  assert.match(formatAmount(12345, 'jpy'), /12,345/);
  const rendered = renderPaymentActionEmail({
    customerName: 'Priya Shah',
    amountRemaining: 12345,
    currency: 'usd',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
  });
  assert.equal(rendered.subject, 'EpsiFlow: Invoice payment incomplete');
  assert.match(rendered.body, /^Hi Priya,/);
  assert.match(rendered.body, /Hope you are doing well\./);
  assert.match(rendered.body, /payment status for your EpsiFlow invoice is incomplete/);
  assert.match(rendered.body, /3D Secure authentication/);
  assert.match(rendered.body, /https:\/\/invoice\.stripe\.com\/i\/test/);
  assert.match(rendered.body, /Best regards,\nAlex Lavrin$/);
  assert.doesNotMatch(rendered.body, /unsubscribe/i);
  assert.doesNotMatch(rendered.body, /client_secret|sk_test|rk_test|whsec/i);
});

test('renders all four follow-ups as distinct recovery steps', () => {
  const reminder = renderPaymentActionEmail({
    customerName: 'Priya Shah',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
    stepNumber: 2,
  });
  assert.equal(reminder.subject, 'Reminder: EpsiFlow payment action required');
  assert.match(reminder.body, /previous email/);

  const discovery = renderPaymentActionEmail({
    customerName: 'Priya Shah',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
    stepNumber: 3,
  });
  assert.equal(discovery.subject, 'Can we help with your EpsiFlow payment?');
  assert.match(discovery.body, /what is preventing you/);
  assert.match(discovery.body, /3D Secure, the payment link/);

  const softWarning = renderPaymentActionEmail({
    customerName: 'Priya Shah',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
    stepNumber: 4,
  });
  assert.equal(softWarning.subject, 'EpsiFlow: Please respond to avoid card interruption');
  assert.match(softWarning.body, /will need to block the EpsiFlow card/);

  const finalNotice = renderPaymentActionEmail({
    customerName: 'Priya Shah',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/test',
    stepNumber: 5,
  });
  assert.equal(finalNotice.subject, 'EpsiFlow: Your card will be blocked in 3 days');
  assert.match(finalNotice.body, /three-day notice/i);
  assert.match(finalNotice.body, /block the EpsiFlow card until the account is funded/);
});

test('classifies only canonical open requires_action invoices as actionable', () => {
  const action = buildStripeContext();
  assert.equal(requiresCustomerAction({
    invoice: action.invoice,
    paymentIntent: action.invoice.payment_intent,
  }), true);
  const paid = buildStripeContext({ paid: true });
  assert.equal(requiresCustomerAction({
    invoice: paid.invoice,
    paymentIntent: paid.invoice.payment_intent,
  }), false);
});

test('turns a stale action-required event for an already-paid invoice into a resolved case', async () => {
  const database = buildDbStub();
  const result = await processStripeEventRow(
    { id: 'evt_phase4' },
    { stripe: buildStripeStub({ paid: true }), db: database }
  );
  assert.deepEqual(result, { outcome: 'case_resolved', state: 'resolved' });
  assert.equal(database.calls.cases.length, 1);
  assert.equal(database.calls.cases[0].state, 'resolved');
  assert.equal(database.calls.cases[0].resolution_reason, 'paid');
  assert.equal(database.calls.messages.length, 0);
  assert.equal(database.calls.cancelledCases.length, 1);
});

test('records an actionable case but schedules nothing while recovery is disabled', async () => {
  const original = config.stripe.paymentRecoveryEnabled;
  config.stripe.paymentRecoveryEnabled = false;
  try {
    const database = buildDbStub();
    const result = await processStripeEventRow(
      { id: 'evt_phase4' },
      { stripe: buildStripeStub(), db: database }
    );
    assert.equal(result.outcome, 'case_open_recovery_disabled');
    assert.equal(database.calls.cases[0].state, 'open');
    assert.equal(database.calls.messages.length, 0);
  } finally {
    config.stripe.paymentRecoveryEnabled = original;
  }
});

test('ignores an ordinary payment failure when no recovery case exists', async () => {
  const database = buildDbStub();
  const result = await processStripeEventRow(
    { id: 'evt_phase4' },
    {
      stripe: buildStripeStub({ eventType: 'invoice.payment_failed', requiresAction: false }),
      db: database,
    }
  );
  assert.equal(result.outcome, 'ignored_without_recovery_case');
  assert.equal(database.calls.customers.length, 0);
  assert.equal(database.calls.cases.length, 0);
});

test('dry-run email delivery does not claim or send due messages', async () => {
  const original = { ...config.transactionalEmail };
  Object.assign(config.transactionalEmail, { enabled: true, dryRun: true });
  let claimed = 0;
  let sent = 0;
  try {
    const result = await deliverDueTransactionalEmails({
      db: {
        getDuePaymentRecoveryMessages: async () => [{ id: 'msg_phase4' }],
        markPaymentRecoveryMessageSending: async () => { claimed++; },
      },
      mailer: { sendTransactionalEmail: async () => { sent++; } },
    });
    assert.deepEqual(result, {
      enabled: true, dryRun: true, due: 1, sent: 0, failed: 0, blocked: 0,
    });
    assert.equal(claimed, 0);
    assert.equal(sent, 0);
  } finally {
    Object.assign(config.transactionalEmail, original);
  }
});

test('allowlisted delivery re-checks Stripe and records one successful send', async () => {
  const original = { ...config.transactionalEmail };
  Object.assign(config.transactionalEmail, {
    enabled: true,
    dryRun: false,
    allowlist: ['client@example.com'],
  });
  const context = buildStripeContext();
  const transitions = [];
  let sentBody;
  try {
    const result = await deliverDueTransactionalEmails({
      stripe: {
        invoices: { retrieve: async () => context.invoice },
        paymentIntents: { retrieve: async () => context.invoice.payment_intent },
      },
      db: {
        getDuePaymentRecoveryMessages: async () => [{
          id: 'msg_phase4',
          channel: 'email',
          recovery_case: {
            id: 'case_phase4',
            state: 'open',
            stripe_invoice_id: context.invoice.id,
            customer: {
              email: 'client@example.com', name: 'Priya Shah', status: 'active', email_enabled: true,
            },
          },
        }],
        markPaymentRecoveryMessageSending: async id => { transitions.push(['sending', id]); return { id }; },
        markPaymentRecoveryMessageSent: async (id, providerId) => transitions.push(['sent', id, providerId]),
        markPaymentRecoveryMessageFailed: async () => assert.fail('send must not fail'),
      },
      mailer: {
        sendTransactionalEmail: async (_from, _to, _subject, body) => {
          sentBody = body;
          return { rfcMessageId: '<phase4@example.com>' };
        },
      },
    });
    assert.equal(result.sent, 1);
    assert.match(sentBody, /invoice\.stripe\.com/);
    assert.deepEqual(transitions, [
      ['sending', 'msg_phase4'],
      ['sent', 'msg_phase4', '<phase4@example.com>'],
    ]);
  } finally {
    Object.assign(config.transactionalEmail, original);
  }
});

test('non-allowlisted delivery remains queued and sends nothing', async () => {
  const original = { ...config.transactionalEmail };
  Object.assign(config.transactionalEmail, {
    enabled: true,
    dryRun: false,
    allowlist: ['internal@example.com'],
  });
  let claimed = 0;
  let sent = 0;
  try {
    const result = await deliverDueTransactionalEmails({
      db: {
        getDuePaymentRecoveryMessages: async () => [{
          id: 'msg_blocked',
          channel: 'email',
          recovery_case: {
            id: 'case_blocked',
            state: 'open',
            customer: {
              email: 'client@example.com', status: 'active', email_enabled: true,
            },
          },
        }],
        markPaymentRecoveryMessageSending: async () => { claimed++; },
      },
      mailer: { sendTransactionalEmail: async () => { sent++; } },
    });
    assert.equal(result.blocked, 1);
    assert.equal(claimed, 0);
    assert.equal(sent, 0);
  } finally {
    Object.assign(config.transactionalEmail, original);
  }
});

test('wildcard recovery allowlist authorizes an active customer email', async () => {
  const original = { ...config.transactionalEmail };
  Object.assign(config.transactionalEmail, {
    enabled: true,
    dryRun: false,
    allowlist: ['*'],
  });
  const context = buildStripeContext();
  let sent = 0;
  try {
    const result = await deliverDueTransactionalEmails({
      stripe: {
        invoices: { retrieve: async () => context.invoice },
        paymentIntents: { retrieve: async () => context.invoice.payment_intent },
      },
      db: {
        getDuePaymentRecoveryMessages: async () => [{
          id: 'msg_wildcard',
          channel: 'email',
          recovery_case: {
            id: 'case_wildcard',
            state: 'open',
            stripe_invoice_id: context.invoice.id,
            customer: {
              email: 'new-client@example.com', name: 'Arpit Sharma', status: 'active', email_enabled: true,
            },
          },
        }],
        markPaymentRecoveryMessageSending: async id => ({ id }),
        markPaymentRecoveryMessageSent: async () => {},
        markPaymentRecoveryMessageFailed: async () => assert.fail('send must not fail'),
      },
      mailer: {
        sendTransactionalEmail: async (_from, to, subject, body) => {
          sent++;
          assert.equal(to, 'new-client@example.com');
          assert.equal(subject, 'EpsiFlow: Invoice payment incomplete');
          assert.match(body, /^Hi Arpit,/);
          return { rfcMessageId: '<wildcard@example.com>' };
        },
      },
    });
    assert.equal(result.sent, 1);
    assert.equal(sent, 1);
  } finally {
    Object.assign(config.transactionalEmail, original);
  }
});

test('payment recovery cron requires configured authentication', async () => {
  const handler = require('../api/cron/payment-recovery');
  const originalSecret = config.cronSecret;
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    config.cronSecret = undefined;
    await handler({ headers: {} }, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /authentication is not configured/);
  } finally {
    config.cronSecret = originalSecret;
  }
});
