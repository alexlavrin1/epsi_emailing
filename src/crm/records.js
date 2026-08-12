function requiredId(value, field) {
  const id = typeof value === 'string' ? value : value?.id;
  if (!id) throw new Error(`${field} is required`);
  return id;
}

function optionalId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeEmail(value) {
  const email = optionalText(value);
  return email ? email.toLowerCase() : null;
}

function toIsoTimestamp(value, field) {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function buildCrmCustomerRecord(stripeCustomer, now = new Date()) {
  return {
    stripe_customer_id: requiredId(stripeCustomer, 'Stripe customer ID'),
    email: normalizeEmail(stripeCustomer.email),
    name: optionalText(stripeCustomer.name),
    updated_at: toIsoTimestamp(now, 'now'),
  };
}

function deriveRecoveryState(invoice, subscription) {
  if (invoice.status === 'paid' || Number(invoice.amount_remaining) === 0) {
    return { state: 'resolved', resolutionReason: 'paid' };
  }
  if (invoice.status === 'void') {
    const expired = subscription?.status === 'incomplete_expired';
    return {
      state: expired ? 'expired' : 'void',
      resolutionReason: expired ? 'subscription_incomplete_expired' : 'invoice_voided',
    };
  }
  if (subscription?.status === 'canceled') {
    return { state: 'cancelled', resolutionReason: 'subscription_cancelled' };
  }
  return { state: 'open', resolutionReason: null };
}

function buildPaymentRecoveryCaseRecord({
  crmCustomerId,
  invoice,
  paymentIntent = null,
  subscription = null,
  eventCreatedAt,
  nextReminderAt = null,
  now = new Date(),
}) {
  const timestamp = toIsoTimestamp(now, 'now');
  const resolution = deriveRecoveryState(invoice, subscription);
  const amountRemaining = Number(invoice.amount_remaining);
  const currency = String(invoice.currency || '').toLowerCase();

  if (!Number.isSafeInteger(amountRemaining) || amountRemaining < 0) {
    throw new Error('Invoice amount_remaining must be a nonnegative safe integer');
  }
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error('Invoice currency must be a three-letter lowercase code');
  }
  if (resolution.state === 'open' && !invoice.hosted_invoice_url) {
    throw new Error('Open recovery cases require a hosted invoice URL');
  }

  return {
    crm_customer_id: requiredId(crmCustomerId, 'CRM customer ID'),
    stripe_invoice_id: requiredId(invoice, 'Stripe invoice ID'),
    stripe_subscription_id:
      optionalId(subscription) ||
      optionalId(invoice.subscription) ||
      optionalId(invoice.parent?.subscription_details?.subscription),
    stripe_payment_intent_id: optionalId(paymentIntent) || optionalId(invoice.payment_intent),
    state: resolution.state,
    invoice_status: optionalText(invoice.status) || 'unknown',
    payment_intent_status: optionalText(paymentIntent?.status),
    amount_remaining: amountRemaining,
    currency,
    hosted_invoice_url: optionalText(invoice.hosted_invoice_url),
    last_stripe_event_created_at: toIsoTimestamp(eventCreatedAt, 'eventCreatedAt'),
    next_reminder_at:
      resolution.state === 'open' && nextReminderAt
        ? toIsoTimestamp(nextReminderAt, 'nextReminderAt')
        : null,
    resolved_at: resolution.state === 'open' ? null : timestamp,
    resolution_reason: resolution.resolutionReason,
    updated_at: timestamp,
  };
}

function buildRecoveryMessageRecord({ recoveryCaseId, channel, stepNumber, scheduledFor }) {
  if (!['email', 'slack'].includes(channel)) {
    throw new Error('Recovery message channel must be email or slack');
  }
  if (!Number.isInteger(stepNumber) || stepNumber < 1) {
    throw new Error('Recovery message stepNumber must be a positive integer');
  }
  return {
    recovery_case_id: requiredId(recoveryCaseId, 'Recovery case ID'),
    channel,
    step_number: stepNumber,
    status: 'queued',
    scheduled_for: toIsoTimestamp(scheduledFor, 'scheduledFor'),
  };
}

module.exports = {
  buildCrmCustomerRecord,
  deriveRecoveryState,
  buildPaymentRecoveryCaseRecord,
  buildRecoveryMessageRecord,
};
