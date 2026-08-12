const config = require('../config');
const db = require('../db/supabase');
const gmail = require('../outreach/gmail');
const logger = require('../utils/logger');
const { getStripeClient } = require('../integrations/stripe/client');
const {
  buildCrmCustomerRecord,
  buildPaymentRecoveryCaseRecord,
  buildRecoveryMessageRecord,
} = require('../crm/records');
const { isTrustedHostedInvoiceUrl, renderPaymentActionEmail } = require('./templates');

function objectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function invoiceSubscriptionId(invoice) {
  return objectId(invoice.subscription) ||
    objectId(invoice.parent?.subscription_details?.subscription);
}

async function retrieveSubscription(stripe, id, fallback = null) {
  if (!id) return fallback;
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch (error) {
    if (error.code === 'resource_missing' && fallback) return fallback;
    throw error;
  }
}

async function loadCanonicalContext(event, stripe) {
  let invoiceId;
  let subscription = null;

  if (event.type.startsWith('invoice.')) {
    invoiceId = event.data.object.id;
  } else if (event.type.startsWith('customer.subscription.')) {
    const eventSubscription = event.data.object;
    subscription = await retrieveSubscription(stripe, eventSubscription.id, eventSubscription);
    invoiceId = objectId(subscription.latest_invoice) || objectId(eventSubscription.latest_invoice);
  }
  if (!invoiceId) return null;

  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] });
  const subscriptionId = invoiceSubscriptionId(invoice) || objectId(subscription);
  if (!subscription && subscriptionId) {
    subscription = await retrieveSubscription(stripe, subscriptionId);
  }

  let paymentIntent = invoice.payment_intent || null;
  if (typeof paymentIntent === 'string') {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
  }

  const stripeCustomerId = objectId(invoice.customer);
  if (!stripeCustomerId) throw new Error(`Invoice ${invoice.id} has no Stripe customer`);
  const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
  if (stripeCustomer.deleted) throw new Error(`Stripe customer ${stripeCustomerId} is deleted`);

  return { invoice, paymentIntent, subscription, stripeCustomer };
}

function requiresCustomerAction({ invoice, paymentIntent }) {
  return invoice.status === 'open' &&
    Number(invoice.amount_remaining) > 0 &&
    paymentIntent?.status === 'requires_action' &&
    isTrustedHostedInvoiceUrl(invoice.hosted_invoice_url);
}

function isRecoverySignal(eventType, actionRequired) {
  return eventType === 'invoice.payment_action_required' ||
    (eventType === 'invoice.payment_failed' && actionRequired);
}

async function processStripeEventRow(row, dependencies = {}) {
  const stripe = dependencies.stripe || getStripeClient();
  const database = dependencies.db || db;
  const event = await stripe.events.retrieve(row.id);

  if (event.livemode && !config.stripe.allowLiveEvents) {
    return { outcome: 'ignored_live_event' };
  }

  const context = await loadCanonicalContext(event, stripe);
  if (!context) return { outcome: 'ignored_without_invoice' };

  const actionRequired = requiresCustomerAction(context);
  const existing = await database.getPaymentRecoveryCaseByInvoiceId(context.invoice.id);
  if (!existing && !isRecoverySignal(event.type, actionRequired)) {
    return { outcome: 'ignored_without_recovery_case' };
  }

  const customerRecord = buildCrmCustomerRecord({
    ...context.stripeCustomer,
    email: context.stripeCustomer.email || context.invoice.customer_email,
  });
  const customer = await database.upsertCrmCustomer(customerRecord);
  const now = new Date();
  const caseRecord = buildPaymentRecoveryCaseRecord({
    crmCustomerId: customer.id,
    ...context,
    eventCreatedAt: event.created,
    nextReminderAt:
      actionRequired && config.stripe.paymentRecoveryEnabled ? now : null,
    now,
  });

  if (caseRecord.state === 'open' && !actionRequired) {
    caseRecord.state = 'cancelled';
    caseRecord.next_reminder_at = null;
    caseRecord.resolved_at = now.toISOString();
    caseRecord.resolution_reason = 'payment_action_no_longer_required';
  }

  const recoveryCase = await database.upsertPaymentRecoveryCase(caseRecord);
  if (recoveryCase.state !== 'open') {
    await database.cancelPaymentRecoveryMessages(recoveryCase.id);
    return { outcome: 'case_resolved', state: recoveryCase.state };
  }

  if (!config.stripe.paymentRecoveryEnabled) {
    return { outcome: 'case_open_recovery_disabled' };
  }
  if (
    customer.status !== 'active' ||
    !customer.email_enabled ||
    !customer.email
  ) {
    return { outcome: 'case_open_email_unavailable' };
  }

  const scheduled = await database.schedulePaymentRecoveryMessage(
    buildRecoveryMessageRecord({
      recoveryCaseId: recoveryCase.id,
      channel: 'email',
      stepNumber: 1,
      scheduledFor: now,
    })
  );
  return { outcome: scheduled.duplicate ? 'message_already_scheduled' : 'message_scheduled' };
}

async function processPendingStripeEvents(dependencies = {}) {
  if (!config.stripe.eventProcessingEnabled) {
    return { enabled: false, claimed: 0, processed: 0, failed: 0 };
  }
  const database = dependencies.db || db;
  const rows = await database.claimStripeWebhookEvents(25);
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await processStripeEventRow(row, dependencies);
      await database.markStripeWebhookEventProcessed(row.id);
      processed++;
      logger.info('Stripe recovery event processed', {
        eventId: row.id,
        eventType: row.event_type,
        outcome: result.outcome,
      });
    } catch (error) {
      failed++;
      await database.markStripeWebhookEventFailed(row.id, error.message);
      logger.error(`Stripe recovery event failed [id=${row.id}]: ${error.message}`);
    }
  }
  return { enabled: true, claimed: rows.length, processed, failed };
}

function isAllowedRecipient(email) {
  return config.transactionalEmail.allowlist.includes(String(email || '').toLowerCase());
}

async function deliverDueTransactionalEmails(dependencies = {}) {
  if (!config.transactionalEmail.enabled) {
    return { enabled: false, due: 0, sent: 0, failed: 0, blocked: 0 };
  }
  const database = dependencies.db || db;
  const stripe = dependencies.stripe || getStripeClient();
  const mailer = dependencies.mailer || gmail;
  const due = await database.getDuePaymentRecoveryMessages(100);

  if (config.transactionalEmail.dryRun) {
    return { enabled: true, dryRun: true, due: due.length, sent: 0, failed: 0, blocked: 0 };
  }

  let sent = 0;
  let failed = 0;
  let blocked = 0;
  for (const message of due) {
    if (message.channel !== 'email') continue;
    const customer = message.recovery_case?.customer;
    if (
      !customer ||
      customer.status !== 'active' ||
      !customer.email_enabled ||
      !isAllowedRecipient(customer.email)
    ) {
      blocked++;
      continue;
    }

    const claimed = await database.markPaymentRecoveryMessageSending(message.id);
    if (!claimed) continue;

    try {
      const invoice = await stripe.invoices.retrieve(
        message.recovery_case.stripe_invoice_id,
        { expand: ['payment_intent'] }
      );
      let paymentIntent = invoice.payment_intent || null;
      if (typeof paymentIntent === 'string') {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
      }
      if (!requiresCustomerAction({ invoice, paymentIntent })) {
        await database.cancelPaymentRecoveryMessage(message.id);
        await database.cancelPaymentRecoveryMessages(message.recovery_case.id);
        continue;
      }

      const rendered = renderPaymentActionEmail({
        customerName: customer.name,
        amountRemaining: invoice.amount_remaining,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      });
      const result = await mailer.sendTransactionalEmail(
        config.yandex.email,
        customer.email,
        rendered.subject,
        rendered.body,
        { displayName: 'EpsiFlow' }
      );
      await database.markPaymentRecoveryMessageSent(message.id, result.rfcMessageId);
      sent++;
    } catch (error) {
      failed++;
      await database.markPaymentRecoveryMessageFailed(message.id, error.message);
      logger.error(`Transactional recovery email failed [message=${message.id}]: ${error.message}`);
    }
  }
  return { enabled: true, dryRun: false, due: due.length, sent, failed, blocked };
}

async function runPaymentRecoveryCycle(dependencies = {}) {
  const events = await processPendingStripeEvents(dependencies);
  const email = await deliverDueTransactionalEmails(dependencies);
  return { events, email };
}

module.exports = {
  loadCanonicalContext,
  requiresCustomerAction,
  isRecoverySignal,
  processStripeEventRow,
  processPendingStripeEvents,
  deliverDueTransactionalEmails,
  runPaymentRecoveryCycle,
};
