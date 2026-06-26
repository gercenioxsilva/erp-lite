ALTER TABLE users
  ADD COLUMN password_reset_token  VARCHAR(255),
  ADD COLUMN password_reset_expires TIMESTAMPTZ;

CREATE INDEX idx_users_reset_token ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;
