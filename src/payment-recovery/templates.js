function isTrustedHostedInvoiceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'invoice.stripe.com';
  } catch {
    return false;
  }
}

function formatAmount(amountMinor, currency) {
  const formatter = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: String(currency).toUpperCase(),
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(Number(amountMinor) / (10 ** fractionDigits));
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || null;
}

function renderPaymentActionEmail({
  customerName,
  amountRemaining,
  currency,
  hostedInvoiceUrl,
  reminder = false,
}) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)},` : 'Hi,';
  return {
    subject: `${reminder ? 'Reminder: action' : 'Action'} needed to complete your ${amount} payment`,
    body: [
      greeting,
      '',
      `Your ${amount} payment to EpsiFlow is waiting for your bank's authentication.`,
      '',
      'Please complete it using this secure Stripe page:',
      hostedInvoiceUrl,
      '',
      'If you have already completed the payment, no action is needed.',
      '',
      'Best,',
      'EpsiFlow',
    ].join('\n'),
  };
}

function renderPaymentActionSlack({
  customerName,
  amountRemaining,
  currency,
  hostedInvoiceUrl,
  reminder = false,
}) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)} — ` : '';
  const prefix = reminder ? 'Reminder — ' : '';
  return `${greeting}${prefix}your ${amount} payment to EpsiFlow is waiting for your bank's authentication. Complete it securely through Stripe: ${hostedInvoiceUrl}\n\nIf you already completed it, no action is needed.`;
}

function renderRecoveryFailureAlert(message) {
  const recoveryCase = message.recovery_case || {};
  const error = String(message.last_error || 'No provider error recorded').slice(0, 500);
  return [
    ':warning: Payment-recovery delivery exhausted its retry limit.',
    `Channel: ${message.channel}`,
    `Invoice: ${recoveryCase.stripe_invoice_id || 'unknown'}`,
    `Message: ${message.id}`,
    `Attempts: ${message.attempt_count}`,
    `Last error: ${error}`,
  ].join('\n');
}

function renderInternalPaymentRecoveryAlert({
  customerName,
  customerEmail,
  invoiceId,
  amountRemaining,
  currency,
  hostedInvoiceUrl,
}) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const customer = customerName || customerEmail || 'Unknown customer';
  const details = [
    `Customer: ${customer}`,
    customerEmail && customerEmail !== customer ? `Email: ${customerEmail}` : null,
    `Amount: ${amount}`,
    `Invoice: ${invoiceId}`,
    '',
    'Stripe requires the customer to complete authentication:',
    hostedInvoiceUrl,
  ].filter(value => value !== null).join('\n');
  return {
    subject: `Payment action required: ${customer} (${amount})`,
    emailBody: [
      'A customer payment requires authentication.',
      '',
      details,
      '',
      'This alert is internal. No customer message was sent.',
    ].join('\n'),
    slackText: [
      ':warning: *Customer payment requires authentication*',
      details,
      '',
      '_Internal alert — no customer message was sent._',
    ].join('\n'),
  };
}

module.exports = {
  isTrustedHostedInvoiceUrl,
  formatAmount,
  renderPaymentActionEmail,
  renderPaymentActionSlack,
  renderRecoveryFailureAlert,
  renderInternalPaymentRecoveryAlert,
};
