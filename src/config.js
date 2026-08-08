require('./env');

function getSupabaseKeyRole(key) {
  if (String(key || '').startsWith('sb_secret_')) return 'secret-key';
  if (String(key || '').startsWith('sb_publishable_')) return 'publishable-key';
  try {
    const payload = JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString());
    return payload.role || 'unknown';
  } catch {
    return 'unknown';
  }
}

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabaseKeyRole = getSupabaseKeyRole(supabaseKey);

module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: supabaseKey,
    keyRole: supabaseKeyRole,
    isServerKey: supabaseKeyRole === 'service_role' || supabaseKeyRole === 'secret-key',
  },
  yandex: {
    email:    process.env.YANDEX_EMAIL,
    password: process.env.YANDEX_PASSWORD,
    smtpHost: process.env.YANDEX_SMTP_HOST || 'smtp.yandex.com',
    imapHost: process.env.YANDEX_IMAP_HOST || 'imap.yandex.com',
  },
  outreachEnabled: String(process.env.OUTREACH_ENABLED || 'false').toLowerCase() === 'true',
  dailySendLimit: parseInt(process.env.DAILY_SEND_LIMIT || '60', 10),
  dailyNewLeadLimit: parseInt(process.env.DAILY_NEW_LEAD_LIMIT || '30', 10),
  sendsPerCycle: parseInt(process.env.SENDS_PER_CYCLE || '2', 10),
  sendTimezone:   process.env.SEND_TIMEZONE || 'Asia/Kolkata',
  sendStartHour:  parseInt(process.env.SEND_START_HOUR || '9', 10),
  sendEndHour:    parseInt(process.env.SEND_END_HOUR || '18', 10),
  replyLookbackDays: parseInt(process.env.REPLY_LOOKBACK_DAYS || '30', 10),
  localCampaignName: process.env.LOCAL_CAMPAIGN_NAME || 'Epsi Test v1 - Local',
  cronSecret:     process.env.CRON_SECRET,
  env:            process.env.NODE_ENV  || 'development',
  logLevel:       process.env.LOG_LEVEL || 'info',
};
