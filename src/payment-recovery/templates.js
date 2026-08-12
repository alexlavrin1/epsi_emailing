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

function renderPaymentActionEmail({ customerName, amountRemaining, currency, hostedInvoiceUrl }) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)},` : 'Hi,';
  return {
    subject: `Action needed to complete your ${amount} payment`,
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

function renderPaymentActionSlack({ customerName, amountRemaining, currency, hostedInvoiceUrl }) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)} — ` : '';
  return `${greeting}your ${amount} payment to EpsiFlow is waiting for your bank's authentication. Complete it securely through Stripe: ${hostedInvoiceUrl}\n\nIf you already completed it, no action is needed.`;
}

module.exports = {
  isTrustedHostedInvoiceUrl,
  formatAmount,
  renderPaymentActionEmail,
  renderPaymentActionSlack,
};
