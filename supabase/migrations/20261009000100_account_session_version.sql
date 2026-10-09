-- Version account sessions so password changes invalidate previously issued JWTs.
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
