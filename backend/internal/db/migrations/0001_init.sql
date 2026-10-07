CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    display_name  text NOT NULL,
    password_hash text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE cases (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE,
    title       text NOT NULL,
    content     jsonb NOT NULL,
    sealed      boolean NOT NULL DEFAULT false, -- bundled with the server; editor hides it
    published   boolean NOT NULL DEFAULT false,
    version     integer NOT NULL DEFAULT 1,
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id       uuid NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
    case_version  integer NOT NULL,
    name          text NOT NULL,
    invite_code   text NOT NULL UNIQUE,
    owner_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'solved', 'failed')),
    state         jsonb NOT NULL,
    attempts_used integer NOT NULL DEFAULT 0,
    max_attempts  integer NOT NULL DEFAULT 3,
    draft         jsonb NOT NULL DEFAULT '{}'::jsonb, -- shared accusation draft: {answers:{}, signed:[]}
    result        jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz
);
CREATE INDEX teams_case_idx ON teams (case_id);

CREATE TABLE team_members (
    team_id   uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    color     text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

-- Everything that happened, in order: the case log and scene history.
CREATE TABLE team_events (
    id         bigserial PRIMARY KEY,
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    kind       text NOT NULL,
    payload    jsonb NOT NULL,
    clock      integer NOT NULL DEFAULT 0, -- in-game minutes since start
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_events_team_idx ON team_events (team_id, id);

CREATE TABLE notes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_team_idx ON notes (team_id);

CREATE TABLE board_items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    ref_kind   text NOT NULL CHECK (ref_kind IN ('doc', 'person', 'loc', 'note', 'text')),
    ref_id     text NOT NULL DEFAULT '',
    label      text NOT NULL DEFAULT '',
    x          double precision NOT NULL,
    y          double precision NOT NULL,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_items_team_idx ON board_items (team_id);

CREATE TABLE board_links (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    from_item  uuid NOT NULL REFERENCES board_items (id) ON DELETE CASCADE,
    to_item    uuid NOT NULL REFERENCES board_items (id) ON DELETE CASCADE,
    label      text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (from_item, to_item)
);
CREATE INDEX board_links_team_idx ON board_links (team_id);

CREATE TABLE chat_messages (
    id         bigserial PRIMARY KEY,
    team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_team_idx ON chat_messages (team_id, id);

CREATE TABLE accusations (
    id               bigserial PRIMARY KEY,
    team_id          uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    attempt          integer NOT NULL,
    answers          jsonb NOT NULL,
    required_correct integer NOT NULL,
    required_total   integer NOT NULL,
    points           integer NOT NULL,
    passed           boolean NOT NULL,
    submitted_by     uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, attempt)
);
