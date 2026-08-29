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
  hostedInvoiceUrl,
  stepNumber = 1,
}) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const greeting = firstName(customerName) ? `Hi ${firstName(customerName)},` : 'Hi,';
  if (stepNumber >= 5) {
    return {
      subject: 'EpsiFlow: Your card will be blocked in 3 days',
      body: [
        greeting,
        '',
        'We still have not received the EpsiFlow top-up payment or a reply from you.',
        '',
        'This is a three-day notice. If the payment is not completed and we do not hear from you within three days, we will block the EpsiFlow card until the account is funded.',
        '',
        'You can complete the payment securely here:',
        hostedInvoiceUrl,
        '',
        'If you are experiencing an issue or no longer wish to continue, please reply so we can help.',
        '',
        'Best regards,',
        'Alex Lavrin',
      ].join('\n'),
    };
  }
  if (stepNumber === 4) {
    return {
      subject: 'EpsiFlow: Please respond to avoid card interruption',
      body: [
        greeting,
        '',
        'We have not yet received the EpsiFlow top-up payment or heard back from you.',
        '',
        'If we do not receive the payment or a reply, we will need to block the EpsiFlow card until the account is funded.',
        '',
        'Please use the secure payment link below, or reply and let us know what is preventing you from completing the payment:',
        hostedInvoiceUrl,
        '',
        'Best regards,',
        'Alex Lavrin',
      ].join('\n'),
    };
  }
  if (stepNumber === 3) {
    return {
      subject: 'Can we help with your EpsiFlow payment?',
      body: [
        greeting,
        '',
        'I wanted to check in and understand what is preventing you from completing the EpsiFlow top-up.',
        '',
        'Are you having trouble with 3D Secure, the payment link, or is there something else we can help with?',
        '',
        'You can complete the payment securely here:',
        hostedInvoiceUrl,
        '',
        'Please reply and let me know what issue you are facing. I will be happy to help.',
        '',
        'Best regards,',
        'Alex Lavrin',
      ].join('\n'),
    };
  }
  if (stepNumber === 2) {
    return {
      subject: 'Reminder: EpsiFlow payment action required',
      body: [
        greeting,
        '',
        'I am following up on my previous email because the payment for your EpsiFlow invoice is still incomplete.',
        '',
        'Please use the secure link below to complete the required 3D Secure authentication:',
        hostedInvoiceUrl,
        '',
        'If you have already completed the payment or need help, please reply and let me know.',
        '',
        'Best regards,',
        'Alex Lavrin',
      ].join('\n'),
    };
  }
  return {
    subject: 'EpsiFlow: Invoice payment incomplete',
    body: [
      greeting,
      '',
      'Hope you are doing well.',
      '',
      'The payment status for your EpsiFlow invoice is incomplete because Stripe requires 3D Secure authentication.',
      '',
      'Please use the secure link below to open the invoice and verify your payment:',
      hostedInvoiceUrl,
      '',
      'If you have any questions, feel free to contact me.',
      '',
      'Best regards,',
      'Alex Lavrin',
    ].join('\n'),
  };
}

function renderPaymentActionSlack({
  customerName,
  hostedInvoiceUrl,
  stepNumber = 1,
}) {
  return renderPaymentActionEmail({ customerName, hostedInvoiceUrl, stepNumber }).body;
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
  stepNumber = 1,
}) {
  if (!isTrustedHostedInvoiceUrl(hostedInvoiceUrl)) {
    throw new Error('Refusing to render an untrusted hosted invoice URL');
  }
  const amount = formatAmount(amountRemaining, currency);
  const customer = customerName || customerEmail || 'Unknown customer';
  const customerMessage = renderPaymentActionSlack({ customerName, hostedInvoiceUrl, stepNumber });
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
      'This is an internal alert.',
    ].join('\n'),
    slackText: [
      ':warning: *Customer payment requires authentication*',
      details,
      '',
      '*Copy/paste message for the customer:*',
      '──────────',
      customerMessage,
      '──────────',
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
