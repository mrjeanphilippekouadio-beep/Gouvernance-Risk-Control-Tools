-- Agent ops tooling (Telegram Q&A loop, Phase B) — not tenant business
-- data, so deliberately no tenant_id: this supports a Claude Code
-- session asking the Product Owner for a decision mid-task, not a GRC
-- domain object subject to the usual tenant-isolation rules.

CREATE TABLE agent_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question     text NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ANSWERED')),
  answer       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);

-- Tracks the Telegram getUpdates offset so telegramPoll.ts never
-- re-processes (or misses) a message across separate script runs.
CREATE TABLE agent_bot_state (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
