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
    
ALTER TABLE users
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS bio VARCHAR(190) NOT NULL DEFAULT '';

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS attachments JSONB
NOT NULL DEFAULT '[]'::jsonb;

-- ==========================================
-- CARGOS DO KHORRA
-- ==========================================

CREATE TABLE IF NOT EXISTS roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    name VARCHAR(32) NOT NULL UNIQUE,

    position INTEGER NOT NULL UNIQUE,

    scope VARCHAR(20) NOT NULL DEFAULT 'server'
        CHECK (scope = 'server'),

    is_owner BOOLEAN NOT NULL DEFAULT FALSE,

    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Apenas um cargo pode ser o cargo protegido do Dono.
CREATE UNIQUE INDEX IF NOT EXISTS roles_single_owner_idx
    ON roles (is_owner)
    WHERE is_owner = TRUE;


-- ==========================================
-- CARGO DE CADA USUÁRIO
-- ==========================================

CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,

    role_id BIGINT NOT NULL
        REFERENCES roles(id) ON DELETE RESTRICT,

    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx
    ON user_roles(role_id);


-- ==========================================
-- CARGOS PADRÃO
-- ==========================================

INSERT INTO roles (name, position, is_owner, permissions)
VALUES
(
    'Membro',
    1,
    FALSE,
    '{"view_channels": true, "send_messages": true}'::jsonb
),
(
    'Moderador',
    2,
    FALSE,
    '{"view_channels": true, "send_messages": true, "manage_messages": true, "mute_members": true}'::jsonb
),
(
    'Administrador',
    3,
    FALSE,
    '{"view_channels": true, "send_messages": true, "manage_messages": true, "mute_members": true, "manage_roles": true, "manage_channels": true}'::jsonb
),
(
    'Dono',
    4,
    TRUE,
    '{"*": true}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS status VARCHAR(20)
NOT NULL DEFAULT 'online'
CHECK (status IN (
    'online',
    'ausente',
    'ocupado',
    'invisivel'
));

-- ==========================================
-- CANAIS DO KHORRA
-- ==========================================

CREATE TABLE IF NOT EXISTS channels (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    server_id BIGINT NOT NULL
        REFERENCES servers(id) ON DELETE CASCADE,

    name VARCHAR(64) NOT NULL,

    type VARCHAR(20) NOT NULL DEFAULT 'text'
        CHECK (type IN ('text', 'voice')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT channels_server_name_unique
        UNIQUE (server_id, name)
);

CREATE INDEX IF NOT EXISTS channels_server_id_idx
    ON channels(server_id);


-- ==========================================
-- MENSAGENS DO KHORRA
-- ==========================================

CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    channel_id BIGINT NOT NULL
        REFERENCES channels(id) ON DELETE CASCADE,

    user_id BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    content TEXT NOT NULL DEFAULT '',

    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_content_or_attachments
        CHECK (
            LENGTH(TRIM(content)) > 0
            OR attachments <> '[]'::jsonb
        )
);

CREATE INDEX IF NOT EXISTS messages_channel_created_idx
    ON messages(channel_id, created_at DESC);


