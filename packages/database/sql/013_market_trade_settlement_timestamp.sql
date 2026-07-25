BEGIN;

ALTER TABLE market_trades
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

UPDATE market_trades
SET settled_at=created_at
WHERE settled_at IS NULL;

ALTER TABLE market_trades
  ALTER COLUMN settled_at SET DEFAULT now(),
  ALTER COLUMN settled_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS market_trades_settled_time_idx
  ON market_trades (settled_at DESC);

COMMIT;
