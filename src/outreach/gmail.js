const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('../config');
const logger = require('../utils/logger');

function createTransporter() {
  return nodemailer.createTransport({
    host: config.yandex.smtpHost,
    port: 465,
    secure: true,
    auth: {
      user: config.yandex.email,
      pass: config.yandex.password,
    },
  });
}

function buildFrom(fromEmail, displayName) {
  return displayName ? { name: displayName, address: fromEmail } : fromEmail;
}

function buildHeaders(fromEmail) {
  const unsubscribeAddress = `mailto:${fromEmail}?subject=unsubscribe`;
  return {
    'List-Unsubscribe': `<${unsubscribeAddress}>`,
  };
}

async function sendEmail(_token, fromEmail, to, subject, body, options = {}) {
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: buildFrom(fromEmail, options.displayName),
    replyTo: fromEmail,
    to,
    subject,
    text: body,
    headers: buildHeaders(fromEmail),
  });
  logger.info(`Email sent to ${to}`, { messageId: info.messageId });
  return {
    gmailId:      info.messageId,
    rfcMessageId: info.messageId,
    threadId:     info.messageId,
  };
}

async function sendReply(_token, fromEmail, toEmail, _threadId, inReplyToMsgId, originalSubject, body, options = {}) {
  const transporter = createTransporter();
  const subject = `Re: ${originalSubject.replace(/^(Re:\s+)+/i, '')}`;

  const info = await transporter.sendMail({
    from:    buildFrom(fromEmail, options.displayName),
    replyTo: fromEmail,
    to:      toEmail,
    subject,
    text:    body,
    headers: {
      ...buildHeaders(fromEmail),
      'In-Reply-To': inReplyToMsgId,
      'References':  inReplyToMsgId,
    },
  });

  logger.info(`Reply sent to ${toEmail}`, { messageId: info.messageId });
  return info;
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function firstAddress(list) {
  return normalizeAddress(Array.isArray(list) ? list[0]?.address : null);
}

function isBounceSender(from, subject) {
  return /(?:mailer-daemon|postmaster)/i.test(from) ||
    /(?:undeliver|delivery[ -](?:status|failure)|mail delivery failed|returned mail|failure notice)/i.test(subject || '');
}

function isUnsubscribeReply(subject, text) {
  if (/\bunsubscribe\b/i.test(subject || '')) return true;
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('>'));
  return /^(?:please\s+)?unsubscribe(?:\s+me)?[.!]?$/i.test(firstLine || '');
}

/**
 * Read recent INBOX messages once per cycle and return only messages relevant
 * to prospects with active outreach. The mailbox is opened read-only and no
 * message flags are changed.
 */
async function findRecentInboundMessages(prospectEmails, since) {
  const targets = new Set(prospectEmails.map(normalizeAddress).filter(Boolean));
  if (!targets.size) return [];

  const client = new ImapFlow({
    host: config.yandex.imapHost,
    port: 993,
    secure: true,
    auth: { user: config.yandex.email, pass: config.yandex.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = await client.search({ since }, { uid: true });
      if (!uids || !uids.length) return [];

      // Cap each cycle so a very large inbox cannot exhaust a serverless run.
      const recentUids = uids.slice(-500);
      const messages = await client.fetchAll(
        recentUids,
        { uid: true, envelope: true },
        { uid: true }
      );

      const results = [];
      for (const message of messages) {
        const from = firstAddress(message.envelope?.from);
        const subject = message.envelope?.subject || '';
        const directProspect = targets.has(from) ? from : null;
        const bounce = isBounceSender(from, subject);
        if (!directProspect && !bounce) continue;

        const sourceMessage = await client.fetchOne(
          String(message.uid),
          { source: true },
          { uid: true }
        );
        if (!sourceMessage?.source) continue;
        const parsed = await simpleParser(sourceMessage.source);
        const text = parsed.text || '';
        let bouncedProspect = null;
        if (bounce) {
          const haystack = `${text}\n${sourceMessage.source.toString('utf8')}`.toLowerCase();
          bouncedProspect = [...targets].find(email => haystack.includes(email)) || null;
        }

        if (!directProspect && !bouncedProspect) continue;
        results.push({
          messageId: message.envelope?.messageId || `imap-uid-${message.uid}`,
          from: directProspect || from,
          prospectEmail: directProspect || bouncedProspect,
          subject,
          text,
          receivedAt: message.envelope?.date || new Date(),
          type: bouncedProspect ? 'bounce' : (isUnsubscribeReply(subject, text) ? 'unsubscribe' : 'reply'),
        });
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}

async function getUserEmail()      { return config.yandex.email; }

module.exports = {
  sendEmail,
  sendReply,
  findRecentInboundMessages,
  getUserEmail,
  // Exported for unit tests; not part of the sending interface.
  isBounceSender,
  isUnsubscribeReply,
};
