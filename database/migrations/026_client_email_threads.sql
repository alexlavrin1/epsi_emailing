-- Group existing-client correspondence by privacy-safe email thread keys.
BEGIN;

ALTER TABLE client_email_messages
  ADD COLUMN IF NOT EXISTS thread_key TEXT;

-- Give already-synced messages a temporary subject-based grouping. The next
-- mailbox cycle replaces these with hashes derived from References/In-Reply-To.
UPDATE client_email_messages
SET thread_key = MD5(
  'legacy-subject:' || LOWER(
    REGEXP_REPLACE(COALESCE(NULLIF(trim(subject), ''), id::TEXT), '^(\s*(re|fw|fwd)(\[[0-9]+\])?:\s*)+', '', 'i')
  )
)
WHERE thread_key IS NULL;

ALTER TABLE client_email_messages
  ALTER COLUMN thread_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_email_messages_thread_key_format'
  ) THEN
    ALTER TABLE client_email_messages
      ADD CONSTRAINT client_email_messages_thread_key_format
      CHECK (thread_key ~ '^[a-f0-9]{32}([a-f0-9]{32})?$');
  END IF;
END; $$;

CREATE INDEX IF NOT EXISTS idx_client_email_messages_thread_time
  ON client_email_messages (client_app_id, thread_key, occurred_at DESC);

COMMIT;
