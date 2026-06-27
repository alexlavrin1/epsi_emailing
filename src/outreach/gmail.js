const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

function createTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
      user: config.yandex.email,
      pass: config.yandex.password,
    },
  });
}

async function sendEmail(_token, fromEmail, to, subject, body) {
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: fromEmail,
    to,
    subject,
    text: body,
  });
  logger.info(`Email sent to ${to}`, { messageId: info.messageId });
  return {
    gmailId:      info.messageId,
    rfcMessageId: info.messageId,
    threadId:     info.messageId,
  };
}

async function sendReply(_token, fromEmail, toEmail, _threadId, inReplyToMsgId, originalSubject, body) {
  const transporter = createTransporter();
  const subject = `Re: ${originalSubject.replace(/^(Re:\s+)+/i, '')}`;

  const info = await transporter.sendMail({
    from:    fromEmail,
    to:      toEmail,
    subject,
    text:    body,
    headers: {
      'In-Reply-To': inReplyToMsgId,
      'References':  inReplyToMsgId,
    },
  });

  logger.info(`Reply sent to ${toEmail}`, { messageId: info.messageId });
  return info;
}

// Reply detection requires IMAP — not yet implemented. Stubs keep the engine running.
async function getThreadMessages() { return []; }
async function getMessageBody()    { return { subject: '', body: '', receivedAt: new Date() }; }
async function getUserEmail()      { return config.yandex.email; }

module.exports = { sendEmail, sendReply, getThreadMessages, getMessageBody, getUserEmail };
