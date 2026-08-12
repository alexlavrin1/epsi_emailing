const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCrmCustomerRecord,
  deriveRecoveryState,
  buildPaymentRecoveryCaseRecord,
  buildRecoveryMessageRecord,
} = require('../src/crm/records');

const now = new Date('2026-08-12T08:00:00.000Z');

test('builds a normalized CRM customer without channel preference fields', () => {
  assert.deepEqual(buildCrmCustomerRecord({
    id: 'cus_test',
    email: ' Client@Example.COM ',
    name: ' Client Name ',
  }, now), {
    stripe_customer_id: 'cus_test',
    email: 'client@example.com',
    name: 'Client Name',
    updated_at: now.toISOString(),
  });
});

test('derives recovery terminal states from canonical Stripe state', () => {
  assert.deepEqual(
    deriveRecoveryState({ status: 'paid', amount_remaining: 0 }, { status: 'active' }),
    { state: 'resolved', resolutionReason: 'paid' }
  );
  assert.deepEqual(
    deriveRecoveryState({ status: 'void', amount_remaining: 100 }, { status: 'incomplete_expired' }),
    { state: 'expired', resolutionReason: 'subscription_incomplete_expired' }
  );
  assert.deepEqual(
    deriveRecoveryState({ status: 'void', amount_remaining: 100 }, null),
    { state: 'void', resolutionReason: 'invoice_voided' }
  );
  assert.deepEqual(
    deriveRecoveryState({ status: 'open', amount_remaining: 100 }, { status: 'canceled' }),
    { state: 'cancelled', resolutionReason: 'subscription_cancelled' }
  );
});

test('builds an open recovery case from expanded Stripe objects', () => {
  const record = buildPaymentRecoveryCaseRecord({
    crmCustomerId: '2eb0253f-1d83-436e-904d-0b4c728f2974',
    invoice: {
      id: 'in_test',
      status: 'open',
      amount_remaining: 1500,
      currency: 'USD',
      hosted_invoice_url: 'https://invoice.stripe.com/i/test',
      parent: { subscription_details: { subscription: 'sub_test' } },
    },
    paymentIntent: { id: 'pi_test', status: 'requires_action' },
    subscription: { id: 'sub_test', status: 'incomplete' },
    eventCreatedAt: 1786442022,
    now,
  });

  assert.equal(record.stripe_invoice_id, 'in_test');
  assert.equal(record.stripe_subscription_id, 'sub_test');
  assert.equal(record.stripe_payment_intent_id, 'pi_test');
  assert.equal(record.state, 'open');
  assert.equal(record.invoice_status, 'open');
  assert.equal(record.payment_intent_status, 'requires_action');
  assert.equal(record.amount_remaining, 1500);
  assert.equal(record.currency, 'usd');
  assert.equal(record.resolved_at, null);
  assert.equal(record.resolution_reason, null);
});

test('builds a resolved recovery case and records its reason', () => {
  const record = buildPaymentRecoveryCaseRecord({
    crmCustomerId: '2eb0253f-1d83-436e-904d-0b4c728f2974',
    invoice: {
      id: 'in_paid',
      status: 'paid',
      amount_remaining: 0,
      currency: 'usd',
      hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    },
    paymentIntent: { id: 'pi_paid', status: 'succeeded' },
    eventCreatedAt: '2026-08-12T07:59:00Z',
    now,
  });

  assert.equal(record.state, 'resolved');
  assert.equal(record.resolved_at, now.toISOString());
  assert.equal(record.resolution_reason, 'paid');
});

test('rejects unsafe open recovery records', () => {
  assert.throws(() => buildPaymentRecoveryCaseRecord({
    crmCustomerId: '2eb0253f-1d83-436e-904d-0b4c728f2974',
    invoice: { id: 'in_test', status: 'open', amount_remaining: 100, currency: 'usd' },
    eventCreatedAt: now,
    now,
  }), /hosted invoice URL/);

  assert.throws(() => buildPaymentRecoveryCaseRecord({
    crmCustomerId: '2eb0253f-1d83-436e-904d-0b4c728f2974',
    invoice: {
      id: 'in_test', status: 'open', amount_remaining: -1, currency: 'usd',
      hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    },
    eventCreatedAt: now,
    now,
  }), /nonnegative safe integer/);
});

test('builds deterministic channel jobs and validates their identity', () => {
  assert.deepEqual(buildRecoveryMessageRecord({
    recoveryCaseId: '3f54b41b-a394-4ff6-b70c-4d880bb99428',
    channel: 'email',
    stepNumber: 1,
    scheduledFor: now,
  }), {
    recovery_case_id: '3f54b41b-a394-4ff6-b70c-4d880bb99428',
    channel: 'email',
    step_number: 1,
    status: 'queued',
    scheduled_for: now.toISOString(),
  });

  assert.throws(() => buildRecoveryMessageRecord({
    recoveryCaseId: '3f54b41b-a394-4ff6-b70c-4d880bb99428',
    channel: 'sms',
    stepNumber: 1,
    scheduledFor: now,
  }), /email or slack/);
});
