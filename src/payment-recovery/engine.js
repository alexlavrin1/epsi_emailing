const config = require('../config');
const db = require('../db/supabase');
const gmail = require('../outreach/gmail');
const logger = require('../utils/logger');
const { getStripeClient } = require('../integrations/stripe/client');
const slackClient = require('../integrations/slack/client');
const {
  buildCrmCustomerRecord,
  buildPaymentRecoveryCaseRecord,
  buildRecoveryMessageRecord,
} = require('../crm/records');
const {
  isTrustedHostedInvoiceUrl,
  renderPaymentActionEmail,
  renderPaymentActionSlack,
  renderRecoveryFailureAlert,
} = require('./templates');

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

async function loadInvoiceContext(invoiceId, stripe, subscription = null) {
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
  return loadInvoiceContext(invoiceId, stripe, subscription);
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

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function reminderTimestamp(now) {
  if (!config.paymentRecoveryReminders.enabled) return null;
  const minutes = positiveInteger(config.paymentRecoveryReminders.finalDelayMinutes, null);
  const hours = positiveInteger(config.paymentRecoveryReminders.finalDelayHours, 8);
  const delayMinutes = minutes || (hours * 60);
  return new Date(now.getTime() + (delayMinutes * 60 * 1000));
}

function initialSlackTimestamp(now) {
  if (!config.paymentRecoveryReminders.enabled) return now;
  const configured = config.paymentRecoveryReminders.slackInitialDelayMinutes;
  const minutes = Number.isInteger(configured) && configured >= 0 ? configured : 20;
  return new Date(now.getTime() + (minutes * 60 * 1000));
}

async function scheduleRecoveryChannels({
  database,
  recoveryCase,
  customer,
  stepNumber,
  scheduledFor,
  slackScheduledFor = scheduledFor,
}) {
  const channels = [];
  const duplicates = [];
  if (customer.email_enabled && customer.email) {
    const scheduled = await database.schedulePaymentRecoveryMessage(
      buildRecoveryMessageRecord({
        recoveryCaseId: recoveryCase.id,
        channel: 'email',
        stepNumber,
        scheduledFor,
      })
    );
    channels.push('email');
    if (scheduled.duplicate) duplicates.push('email');
  }
  if (customer.slack_enabled && customer.slack_team_id && customer.slack_user_id) {
    const scheduled = await database.schedulePaymentRecoveryMessage(
      buildRecoveryMessageRecord({
        recoveryCaseId: recoveryCase.id,
        channel: 'slack',
        stepNumber,
        scheduledFor: slackScheduledFor,
      })
    );
    channels.push('slack');
    if (scheduled.duplicate) duplicates.push('slack');
  }
  return { channels, duplicates };
}

async function persistRecoveryContext({
  context,
  eventType,
  observedAt,
  allowCreate = false,
  dependencies = {},
}) {
  const database = dependencies.db || db;
  const actionRequired = requiresCustomerAction(context);
  const existing = await database.getPaymentRecoveryCaseByInvoiceId(context.invoice.id);
  const created = !existing;
  if (!existing && !allowCreate && !isRecoverySignal(eventType, actionRequired)) {
    return { result: { outcome: 'ignored_without_recovery_case' } };
  }
  if (!existing && allowCreate && !actionRequired) {
    return { result: { outcome: 'ignored_without_recovery_case' } };
  }

  const customerRecord = buildCrmCustomerRecord({
    ...context.stripeCustomer,
    email: context.stripeCustomer.email || context.invoice.customer_email,
  });
  const customer = await database.upsertCrmCustomer(customerRecord);
  const now = dependencies.now ? new Date(dependencies.now) : new Date();
  const nextReminderAt = existing
    ? existing.next_reminder_at
    : (actionRequired && config.stripe.paymentRecoveryEnabled ? reminderTimestamp(now) : null);
  const eventCreatedAt = eventType.startsWith('reconciliation.') && existing
    ? (existing.last_stripe_event_created_at || observedAt)
    : observedAt;
  const caseRecord = buildPaymentRecoveryCaseRecord({
    crmCustomerId: customer.id,
    ...context,
    eventCreatedAt,
    nextReminderAt,
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
    return {
      result: { outcome: 'case_resolved', state: recoveryCase.state },
      recoveryCase,
      customer,
      actionRequired,
      created,
    };
  }
  if (!config.stripe.paymentRecoveryEnabled) {
    return {
      result: { outcome: 'case_open_recovery_disabled' },
      recoveryCase,
      customer,
      actionRequired,
      created,
    };
  }
  if (customer.status !== 'active') {
    return {
      result: { outcome: 'case_open_customer_suppressed' },
      recoveryCase,
      customer,
      actionRequired,
      created,
    };
  }

  const scheduled = await scheduleRecoveryChannels({
    database,
    recoveryCase,
    customer,
    stepNumber: 1,
    scheduledFor: now,
    slackScheduledFor: initialSlackTimestamp(now),
  });
  const result = scheduled.channels.length
    ? { outcome: 'messages_scheduled', ...scheduled }
    : { outcome: 'case_open_channels_unavailable' };
  return { result, recoveryCase, customer, actionRequired, created };
}

async function processStripeEventRow(row, dependencies = {}) {
  const stripe = dependencies.stripe || getStripeClient();
  const event = await stripe.events.retrieve(row.id);

  if (event.livemode && !config.stripe.allowLiveEvents) {
    return { outcome: 'ignored_live_event' };
  }

  const context = await loadCanonicalContext(event, stripe);
  if (!context) return { outcome: 'ignored_without_invoice' };
  const persisted = await persistRecoveryContext({
    context,
    eventType: event.type,
    observedAt: event.created,
    dependencies,
  });
  return persisted.result;
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

async function reconcilePaymentRecoveryCases(dependencies = {}) {
  if (!config.stripe.reconciliationEnabled) {
    return {
      enabled: false,
      checked: 0,
      resolved: 0,
      actionable: 0,
      discovered: 0,
      failed: 0,
    };
  }
  const database = dependencies.db || db;
  const stripe = dependencies.stripe || getStripeClient();
  const limit = positiveInteger(config.stripe.reconciliationCaseLimit, 25);
  const openCases = await database.getOpenPaymentRecoveryCases(limit);
  const knownInvoiceIds = new Set(openCases.map(recoveryCase => recoveryCase.stripe_invoice_id));
  let checked = 0;
  let resolved = 0;
  let actionable = 0;
  let discovered = 0;
  let failed = 0;

  for (const recoveryCase of openCases) {
    try {
      const context = await loadInvoiceContext(recoveryCase.stripe_invoice_id, stripe);
      if (context.invoice.livemode && !config.stripe.allowLiveEvents) continue;
      const persisted = await persistRecoveryContext({
        context,
        eventType: 'reconciliation.open_case',
        observedAt: new Date(),
        allowCreate: false,
        dependencies,
      });
      checked++;
      if (persisted.recoveryCase?.state === 'open' && persisted.actionRequired) actionable++;
      if (persisted.result.outcome === 'case_resolved') resolved++;
      if (persisted.recoveryCase) {
        await database.markPaymentRecoveryCaseReconciled(persisted.recoveryCase.id);
      }
    } catch (error) {
      failed++;
      logger.error(
        `Payment recovery reconciliation failed [invoice=${recoveryCase.stripe_invoice_id}]: ${error.message}`
      );
    }
  }

  const lookbackHours = positiveInteger(config.stripe.reconciliationLookbackHours, 48);
  const createdAfter = Math.floor(Date.now() / 1000) - (lookbackHours * 60 * 60);
  const recent = await stripe.invoices.list({
    status: 'open',
    created: { gte: createdAfter },
    limit: Math.min(limit * 4, 100),
  });
  for (const invoice of recent.data || []) {
    if (knownInvoiceIds.has(invoice.id)) continue;
    if (invoice.livemode && !config.stripe.allowLiveEvents) continue;
    try {
      const existing = await database.getPaymentRecoveryCaseByInvoiceId(invoice.id);
      if (existing?.state === 'open') continue;
      const context = await loadInvoiceContext(invoice.id, stripe);
      if (!requiresCustomerAction(context)) continue;
      const persisted = await persistRecoveryContext({
        context,
        eventType: 'invoice.payment_action_required',
        observedAt: context.invoice.created || new Date(),
        allowCreate: true,
        dependencies,
      });
      if (
        persisted.recoveryCase?.state === 'open' &&
        (persisted.created || existing?.state !== 'open')
      ) {
        discovered++;
      }
      if (persisted.recoveryCase?.state === 'open') actionable++;
      if (persisted.recoveryCase) {
        await database.markPaymentRecoveryCaseReconciled(persisted.recoveryCase.id);
      }
    } catch (error) {
      failed++;
      logger.error(`Payment recovery discovery failed [invoice=${invoice.id}]: ${error.message}`);
    }
  }

  return { enabled: true, checked, resolved, actionable, discovered, failed };
}

async function scheduleDuePaymentRecoveryReminders(dependencies = {}) {
  if (!config.paymentRecoveryReminders.enabled) {
    return { enabled: false, due: 0, scheduled: 0, failed: 0 };
  }
  const database = dependencies.db || db;
  const stripe = dependencies.stripe || getStripeClient();
  const limit = positiveInteger(config.paymentRecoveryReminders.caseLimit, 25);
  const dueCases = await database.getDuePaymentRecoveryReminderCases(limit);
  let scheduled = 0;
  let failed = 0;

  for (const dueCase of dueCases) {
    try {
      const context = await loadInvoiceContext(dueCase.stripe_invoice_id, stripe);
      if (context.invoice.livemode && !config.stripe.allowLiveEvents) continue;
      const persisted = await persistRecoveryContext({
        context,
        eventType: 'reconciliation.reminder_due',
        observedAt: new Date(),
        allowCreate: false,
        dependencies,
      });
      if (persisted.recoveryCase?.state !== 'open' || !persisted.actionRequired) continue;
      if (persisted.customer.status === 'active') {
        const result = await scheduleRecoveryChannels({
          database,
          recoveryCase: persisted.recoveryCase,
          customer: persisted.customer,
          stepNumber: 2,
          scheduledFor: dependencies.now ? new Date(dependencies.now) : new Date(),
        });
        scheduled += result.channels.length - result.duplicates.length;
      }
      await database.setPaymentRecoveryNextReminder(persisted.recoveryCase.id, null);
      await database.markPaymentRecoveryCaseReconciled(persisted.recoveryCase.id);
    } catch (error) {
      failed++;
      logger.error(`Payment recovery reminder scheduling failed [case=${dueCase.id}]: ${error.message}`);
    }
  }
  return { enabled: true, due: dueCases.length, scheduled, failed };
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
  const due = await database.getDuePaymentRecoveryMessages(100, 'email');

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
        reminder: message.step_number > 1,
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

function isAllowedSlackUser(userId) {
  return config.slack.userAllowlist.includes(String(userId || '').toUpperCase());
}

async function deliverDueSlackMessages(dependencies = {}) {
  if (!config.slack.enabled) {
    return { enabled: false, due: 0, sent: 0, failed: 0, blocked: 0 };
  }
  const database = dependencies.db || db;
  const stripe = dependencies.stripe || getStripeClient();
  const slack = dependencies.slack || slackClient;
  const due = await database.getDuePaymentRecoveryMessages(100, 'slack');

  if (config.slack.dryRun) {
    return { enabled: true, dryRun: true, due: due.length, sent: 0, failed: 0, blocked: 0 };
  }

  let sent = 0;
  let failed = 0;
  let blocked = 0;
  for (const message of due) {
    const customer = message.recovery_case?.customer;
    if (
      !customer ||
      customer.status !== 'active' ||
      !customer.slack_enabled ||
      customer.slack_team_id !== config.slack.teamId ||
      !isAllowedSlackUser(customer.slack_user_id)
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

      const text = renderPaymentActionSlack({
        customerName: customer.name,
        amountRemaining: invoice.amount_remaining,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        reminder: message.step_number > 1,
      });
      const result = await slack.sendDirectMessage(customer.slack_user_id, text);
      await database.markPaymentRecoveryMessageSent(message.id, result.messageId);
      sent++;
    } catch (error) {
      failed++;
      await database.markPaymentRecoveryMessageFailed(message.id, error.message);
      logger.error(`Slack recovery message failed [message=${message.id}]: ${error.message}`);
    }
  }
  return { enabled: true, dryRun: false, due: due.length, sent, failed, blocked };
}

async function deliverRecoveryFailureAlerts(dependencies = {}) {
  if (!config.slack.failureAlertsEnabled) {
    return { enabled: false, due: 0, sent: 0, failed: 0 };
  }
  const database = dependencies.db || db;
  const slack = dependencies.slack || slackClient;
  const due = await database.getExhaustedPaymentRecoveryMessages(100);
  if (!config.slack.failureAlertChannelId) {
    return { enabled: true, configured: false, due: due.length, sent: 0, failed: 0 };
  }
  if (config.slack.failureAlertsDryRun) {
    return { enabled: true, configured: true, dryRun: true, due: due.length, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const message of due) {
    const claimed = await database.claimPaymentRecoveryFailureAlert(message.id);
    if (!claimed) continue;
    try {
      const text = renderRecoveryFailureAlert(message);
      const result = await slack.sendChannelMessage(config.slack.failureAlertChannelId, text);
      await database.markPaymentRecoveryFailureAlertSent(message.id, result.messageId);
      sent++;
    } catch (error) {
      failed++;
      await database.markPaymentRecoveryFailureAlertFailed(message.id, error.message);
      logger.error(`Payment recovery failure alert failed [message=${message.id}]: ${error.message}`);
    }
  }
  return {
    enabled: true,
    configured: true,
    dryRun: false,
    due: due.length,
    sent,
    failed,
  };
}

async function runPaymentRecoveryCycle(dependencies = {}) {
  const events = await processPendingStripeEvents(dependencies);
  const reconciliation = await reconcilePaymentRecoveryCases(dependencies);
  const reminders = await scheduleDuePaymentRecoveryReminders(dependencies);
  const email = await deliverDueTransactionalEmails(dependencies);
  const slack = await deliverDueSlackMessages(dependencies);
  const alerts = await deliverRecoveryFailureAlerts(dependencies);
  return { events, reconciliation, reminders, email, slack, alerts };
}

module.exports = {
  loadInvoiceContext,
  loadCanonicalContext,
  requiresCustomerAction,
  isRecoverySignal,
  processStripeEventRow,
  processPendingStripeEvents,
  reconcilePaymentRecoveryCases,
  scheduleDuePaymentRecoveryReminders,
  deliverDueTransactionalEmails,
  deliverDueSlackMessages,
  deliverRecoveryFailureAlerts,
  runPaymentRecoveryCycle,
};
