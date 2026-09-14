-- Remove the legacy policies that exposed outreach data to any client holding
-- the anon key. The server-side service role bypasses RLS and remains able to
-- operate the acquisition engine.

DROP POLICY IF EXISTS "Enable all access" ON mailboxes;
DROP POLICY IF EXISTS "Enable all access" ON prospects;
DROP POLICY IF EXISTS "Enable all access" ON campaigns;
DROP POLICY IF EXISTS "Enable all access" ON campaign_steps;
DROP POLICY IF EXISTS "Enable all access" ON outreach_sends;
DROP POLICY IF EXISTS "Enable all access" ON prospect_replies;
DROP POLICY IF EXISTS "Enable all access" ON skipped_apollo_ids;

ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE skipped_apollo_ids ENABLE ROW LEVEL SECURITY;
