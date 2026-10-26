CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_username_unique UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS users_created_at_idx
    ON users (created_at DESC);
