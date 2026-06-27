require('dotenv').config();

module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },
  yandex: {
    email:    process.env.YANDEX_EMAIL,
    password: process.env.YANDEX_PASSWORD,
  },
  dailySendLimit: parseInt(process.env.DAILY_SEND_LIMIT || '40', 10),
  sendTimezone:   process.env.SEND_TIMEZONE || 'Asia/Kolkata',
  cronSecret:     process.env.CRON_SECRET,
  env:            process.env.NODE_ENV  || 'development',
  logLevel:       process.env.LOG_LEVEL || 'info',
};
