-- EPSI Fund Cold Outreach — Database Schema
-- Run this once in your Supabase SQL editor before starting.

-- ─────────────────────────────────────────────────────────────────────────────
-- mailboxes — sending Gmail accounts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailboxes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  oauth_token  TEXT NOT NULL,
  display_name VARCHAR(255),
  signature    TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON mailboxes FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- prospects — the people you're reaching out to
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_id    VARCHAR(255) UNIQUE,
  email        VARCHAR(255) UNIQUE NOT NULL,
  first_name   VARCHAR(100),
  last_name    VARCHAR(100),
  company      VARCHAR(255),
  title        VARCHAR(255),
  linkedin_url TEXT,
  -- 'active' | 'unsubscribed' | 'bounced'
  status       VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_email  ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON prospects FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- campaigns — a named outreach campaign linked to a sending mailbox
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  from_mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT,
  -- 'active' | 'paused' | 'completed'
  status          VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON campaigns FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- campaign_steps — the email sequence (step 1 = initial, step 2+ = follow-ups)
-- ─────────────────────────────────────────────────────────────────────────────
-- delay_days: days after the PREVIOUS step to send (step 1 delay_days is ignored).
-- Templates support: {{firstName}}, {{lastName}}, {{company}}, {{senderName}}, {{signature}}
CREATE TABLE IF NOT EXISTS campaign_steps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number      INTEGER NOT NULL,
  delay_days       INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT NOT NULL,
  body_template    TEXT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id);

ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON campaign_steps FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- outreach_sends — one row per prospect × campaign × step
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach_sends (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  prospect_id      UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  step_number      INTEGER NOT NULL,
  -- 'scheduled' | 'sent' | 'replied' | 'bounced' | 'stopped'
  status           VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  next_send_at     TIMESTAMP,
  sent_at          TIMESTAMP,
  replied_at       TIMESTAMP,
  gmail_thread_id  TEXT,
  gmail_message_id TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, prospect_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_outreach_sends_due      ON outreach_sends(next_send_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_outreach_sends_thread   ON outreach_sends(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_prospect ON outreach_sends(prospect_id);

ALTER TABLE outreach_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON outreach_sends FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- prospect_replies — stores reply content when a prospect responds
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_send_id UUID REFERENCES outreach_sends(id),
  campaign_id      UUID REFERENCES campaigns(id),
  prospect_id      UUID REFERENCES prospects(id),
  gmail_message_id TEXT UNIQUE,
  subject          TEXT,
  body             TEXT,
  received_at      TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE prospect_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON prospect_replies FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- skipped_apollo_ids — Apollo contacts we already tried and skipped
-- (no email returned after enrichment). Prevents re-spending credits.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skipped_apollo_ids (
  apollo_id  VARCHAR(255) PRIMARY KEY,
  reason     VARCHAR(100) NOT NULL DEFAULT 'no_email',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE skipped_apollo_ids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON skipped_apollo_ids FOR ALL USING (true);
