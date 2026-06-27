require('dotenv').config();

module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },
  gmail: {
    clientId:    process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/auth/callback',
  },
  dailySendLimit: parseInt(process.env.DAILY_SEND_LIMIT || '50', 10),
  sendTimezone: process.env.SEND_TIMEZONE || 'Europe/Amsterdam',
  env:      process.env.NODE_ENV  || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
};
