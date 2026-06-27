console.error('Gmail OAuth is no longer used. Yandex SMTP is configured via YANDEX_EMAIL + YANDEX_PASSWORD in .env');
console.error('To register your mailbox in the database run: npm run setup:mailbox');
process.exit(1);
