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
  stripe: {
    restrictedKey: process.env.STRIPE_RESTRICTED_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    apiVersion: process.env.STRIPE_API_VERSION || '2022-11-15',
    eventIngestionEnabled:
      String(process.env.STRIPE_EVENT_INGESTION_ENABLED || 'false').toLowerCase() === 'true',
    eventProcessingEnabled:
      String(process.env.STRIPE_EVENT_PROCESSING_ENABLED || 'false').toLowerCase() === 'true',
    paymentRecoveryEnabled:
      String(process.env.STRIPE_PAYMENT_RECOVERY_ENABLED || 'false').toLowerCase() === 'true',
    allowLiveEvents:
      String(process.env.STRIPE_ALLOW_LIVE_EVENTS || 'false').toLowerCase() === 'true',
    reconciliationEnabled:
      String(process.env.STRIPE_RECONCILIATION_ENABLED || 'false').toLowerCase() === 'true',
    reconciliationLookbackHours:
      parseInt(process.env.STRIPE_RECONCILIATION_LOOKBACK_HOURS || '48', 10),
    reconciliationCaseLimit:
      parseInt(process.env.STRIPE_RECONCILIATION_CASE_LIMIT || '25', 10),
    clientSubscriptionReconciliationEnabled:
      String(process.env.STRIPE_CLIENT_SUBSCRIPTION_RECONCILIATION_ENABLED || 'true').toLowerCase() !== 'false',
    clientSubscriptionWebhookEnabled:
      String(process.env.STRIPE_CLIENT_SUBSCRIPTION_WEBHOOK_ENABLED || 'true').toLowerCase() !== 'false',
    clientSubscriptionReconciliationMinutes:
      parseInt(process.env.STRIPE_CLIENT_SUBSCRIPTION_RECONCILIATION_MINUTES || '360', 10),
    clientSubscriptionReconciliationLimit:
      parseInt(process.env.STRIPE_CLIENT_SUBSCRIPTION_RECONCILIATION_LIMIT || '5', 10),
  },
  paymentRecoveryReminders: {
    enabled:
      String(process.env.PAYMENT_RECOVERY_REMINDERS_ENABLED || 'false').toLowerCase() === 'true',
    finalDelayHours:
      parseInt(process.env.PAYMENT_RECOVERY_FINAL_REMINDER_HOURS || '8', 10),
    finalDelayMinutes: process.env.PAYMENT_RECOVERY_FINAL_REMINDER_MINUTES
      ? parseInt(process.env.PAYMENT_RECOVERY_FINAL_REMINDER_MINUTES, 10)
      : null,
    slackInitialDelayMinutes:
      parseInt(process.env.PAYMENT_RECOVERY_SLACK_INITIAL_DELAY_MINUTES || '20', 10),
    caseLimit:
      parseInt(process.env.PAYMENT_RECOVERY_REMINDER_CASE_LIMIT || '25', 10),
  },
  paymentRecoveryInternalAlerts: {
    enabled:
      String(process.env.PAYMENT_RECOVERY_INTERNAL_ALERTS_ENABLED || 'false').toLowerCase() === 'true',
    dryRun:
      String(process.env.PAYMENT_RECOVERY_INTERNAL_ALERTS_DRY_RUN || 'true').toLowerCase() !== 'false',
    email: process.env.PAYMENT_RECOVERY_INTERNAL_EMAIL || process.env.YANDEX_EMAIL,
    slackChannelId:
      process.env.PAYMENT_RECOVERY_INTERNAL_SLACK_CHANNEL_ID || process.env.SLACK_FAILURE_ALERT_CHANNEL_ID,
  },
  transactionalEmail: {
    enabled:
      String(process.env.TRANSACTIONAL_EMAIL_ENABLED || 'false').toLowerCase() === 'true',
    dryRun:
      String(process.env.TRANSACTIONAL_EMAIL_DRY_RUN || 'true').toLowerCase() !== 'false',
    allowlist: String(process.env.TRANSACTIONAL_EMAIL_ALLOWLIST || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
    maxAttempts: parseInt(process.env.TRANSACTIONAL_EMAIL_MAX_ATTEMPTS || '3', 10),
  },
  clientSuccessEmail: {
    enabled: String(process.env.CLIENT_SUCCESS_EMAIL_DELIVERY_ENABLED || 'false').toLowerCase() === 'true',
    dryRun: String(process.env.CLIENT_SUCCESS_EMAIL_DELIVERY_DRY_RUN || 'true').toLowerCase() !== 'false',
    allowlist: String(process.env.CLIENT_SUCCESS_EMAIL_DELIVERY_ALLOWLIST || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
    limit: parseInt(process.env.CLIENT_SUCCESS_EMAIL_DELIVERY_LIMIT || '10', 10),
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    teamId: process.env.SLACK_TEAM_ID,
    enabled: String(process.env.SLACK_DELIVERY_ENABLED || 'false').toLowerCase() === 'true',
    dryRun: String(process.env.SLACK_DELIVERY_DRY_RUN || 'true').toLowerCase() !== 'false',
    userAllowlist: String(process.env.SLACK_USER_ALLOWLIST || '')
      .split(',')
      .map(id => id.trim().toUpperCase())
      .filter(Boolean),
    maxAttempts: parseInt(process.env.SLACK_MAX_ATTEMPTS || '3', 10),
    failureAlertsEnabled:
      String(process.env.SLACK_FAILURE_ALERTS_ENABLED || 'false').toLowerCase() === 'true',
    failureAlertsDryRun:
      String(process.env.SLACK_FAILURE_ALERTS_DRY_RUN || 'true').toLowerCase() !== 'false',
    failureAlertChannelId: process.env.SLACK_FAILURE_ALERT_CHANNEL_ID,
    failureAlertMaxAttempts:
      parseInt(process.env.SLACK_FAILURE_ALERT_MAX_ATTEMPTS || '3', 10),
  },
  aiGateway: {
    apiKey: process.env.AI_GATEWAY_API_KEY,
    oidcToken: process.env.VERCEL_OIDC_TOKEN,
    authToken: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
    clientSuccessAgentEnabled: String(process.env.CLIENT_SUCCESS_AGENT_ENABLED || 'false').toLowerCase() === 'true',
    clientSuccessModel: process.env.AI_GATEWAY_CLIENT_SUCCESS_MODEL || 'openai/gpt-5.6-luna',
    reasoningEffort: process.env.AI_GATEWAY_REASONING_EFFORT || 'medium',
    clientSuccessAgentLimit: parseInt(process.env.CLIENT_SUCCESS_AGENT_LIMIT || '1', 10),
    clientSuccessMaxContextChars: parseInt(process.env.CLIENT_SUCCESS_MAX_CONTEXT_CHARS || '300000', 10),
    clientSuccessMaxOutputTokens: parseInt(process.env.CLIENT_SUCCESS_MAX_OUTPUT_TOKENS || '1400', 10),
    clientSuccessTimeoutMs: parseInt(process.env.CLIENT_SUCCESS_AGENT_TIMEOUT_MS || '45000', 10),
  },
  outreachEnabled: String(process.env.OUTREACH_ENABLED || 'false').toLowerCase() === 'true',
  dailySendLimit: parseInt(process.env.DAILY_SEND_LIMIT || '60', 10),
  dailyNewLeadLimit: parseInt(process.env.DAILY_NEW_LEAD_LIMIT || '30', 10),
  sendsPerCycle: parseInt(process.env.SENDS_PER_CYCLE || '2', 10),
  sendTimezone:   process.env.SEND_TIMEZONE || 'Asia/Kolkata',
  sendStartHour:  parseInt(process.env.SEND_START_HOUR || '9', 10),
  sendEndHour:    parseInt(process.env.SEND_END_HOUR || '18', 10),
  replyLookbackDays: parseInt(process.env.REPLY_LOOKBACK_DAYS || '30', 10),
  clientCorrespondenceLookbackDays: parseInt(process.env.CLIENT_CORRESPONDENCE_LOOKBACK_DAYS || '90', 10),
  clientSuccessAutomationEnabled: String(process.env.CLIENT_SUCCESS_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true',
  clientSuccessAutomationLimit: parseInt(process.env.CLIENT_SUCCESS_AUTOMATION_LIMIT || '10', 10),
  clientInitialCorrespondenceLookbackDays: parseInt(process.env.CLIENT_INITIAL_CORRESPONDENCE_LOOKBACK_DAYS || '730', 10),
  localCampaignName: process.env.LOCAL_CAMPAIGN_NAME || 'Epsi Test v1 - Local',
  cronSecret:     process.env.CRON_SECRET,
  env:            process.env.NODE_ENV  || 'development',
  logLevel:       process.env.LOG_LEVEL || 'info',
};
