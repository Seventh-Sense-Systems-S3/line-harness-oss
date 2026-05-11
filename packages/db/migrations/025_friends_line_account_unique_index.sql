-- Prevent duplicate (line_account_id, line_user_id) pairs.
-- Partial index: rows with NULL line_account_id are excluded (pre-multi-account legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS friends_line_account_user_unique
  ON friends(line_account_id, line_user_id)
  WHERE line_account_id IS NOT NULL;
