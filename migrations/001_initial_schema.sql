-- ============================================================
-- Playlab Rostering Middleware — PostgreSQL Schema v1.0
-- ============================================================
-- Run in order. Each migration is idempotent.
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- fuzzy matching for dedup

-- ── Enums ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE data_source AS ENUM ('clever','classlink','oneroster','manual','jit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entity_status AS ENUM ('active','tobedeleted','deprovisioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM (
    'pending','synced','conflict','error','deprovisioned','jit_provisioned','skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE org_type AS ENUM (
    'district','school','department','public_entity','private_entity'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE canonical_role AS ENUM (
    'student','teacher','administrator','districtAdmin','sysAdmin','orgAdmin','learner','staff'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE playlab_role AS ENUM (
    'student','teacher','schoolAdmin','districtAdmin','orgAdmin','platformAdmin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE age_group AS ENUM ('under13','13to17','18plus','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Organizations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  canonical_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_version      TEXT NOT NULL DEFAULT '1.0',
  external_id         TEXT NOT NULL,
  external_id_alts    JSONB NOT NULL DEFAULT '[]',
  source              data_source NOT NULL,

  org_type            org_type NOT NULL,
  entity_category     TEXT NOT NULL DEFAULT 'public',
  name                TEXT NOT NULL,
  identifier          TEXT,

  nces_district_id    TEXT,
  nces_school_id      TEXT,
  state_id            TEXT,
  country_code        CHAR(2) NOT NULL DEFAULT 'US',
  region_code         TEXT,

  parent_canonical_id UUID REFERENCES organizations(canonical_id),
  child_canonical_ids UUID[] NOT NULL DEFAULT '{}',

  address             JSONB NOT NULL DEFAULT '{}',
  phone               TEXT,
  website             TEXT,

  locale              TEXT NOT NULL DEFAULT 'en-US',
  timezone            TEXT NOT NULL DEFAULT 'America/New_York',

  playlab_org_id      TEXT,
  playlab_sync_state  sync_status NOT NULL DEFAULT 'pending',

  compliance_profile  JSONB NOT NULL DEFAULT '{}',

  status              entity_status NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at      TIMESTAMPTZ,
  source_raw_hash     TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_source_external
  ON organizations(source, external_id);

CREATE INDEX IF NOT EXISTS idx_org_nces_district ON organizations(nces_district_id)
  WHERE nces_district_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_nces_school ON organizations(nces_school_id)
  WHERE nces_school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_state_id ON organizations(state_id)
  WHERE state_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_name_trgm ON organizations
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_org_playlab_id ON organizations(playlab_org_id)
  WHERE playlab_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_status ON organizations(status);

-- ── Users ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  canonical_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_version      TEXT NOT NULL DEFAULT '1.0',
  external_id         TEXT NOT NULL,
  external_id_alts    JSONB NOT NULL DEFAULT '[]',
  source              data_source NOT NULL,

  given_name          TEXT NOT NULL,
  middle_name         TEXT,
  family_name         TEXT NOT NULL,
  preferred_first_name TEXT,
  preferred_last_name  TEXT,

  email               TEXT,
  username            TEXT,
  phone               TEXT,

  roles               JSONB NOT NULL DEFAULT '[]',
  primary_role        canonical_role NOT NULL,

  student_data        JSONB,   -- null for non-students

  org_canonical_ids   UUID[] NOT NULL DEFAULT '{}',
  class_canonical_ids UUID[] NOT NULL DEFAULT '{}',

  sso_identities      JSONB NOT NULL DEFAULT '[]',

  pii_minimized       BOOLEAN NOT NULL DEFAULT FALSE,
  ferpa_protected     BOOLEAN NOT NULL DEFAULT FALSE,
  coppa_applies       BOOLEAN NOT NULL DEFAULT FALSE,

  playlab_user_id     TEXT,
  playlab_role        playlab_role NOT NULL DEFAULT 'student',
  playlab_sync_state  sync_status NOT NULL DEFAULT 'pending',

  status              entity_status NOT NULL DEFAULT 'active',
  enabled_user        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at      TIMESTAMPTZ,
  source_raw_hash     TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_source_external
  ON users(source, external_id);

CREATE INDEX IF NOT EXISTS idx_user_email ON users(email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_primary_role ON users(primary_role);

CREATE INDEX IF NOT EXISTS idx_user_playlab_id ON users(playlab_user_id)
  WHERE playlab_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_user_coppa ON users(coppa_applies)
  WHERE coppa_applies = TRUE;

-- GIN index for searching external_id_alts JSON array
CREATE INDEX IF NOT EXISTS idx_user_external_id_alts ON users USING GIN (external_id_alts);

-- Full-text search on names (for dedup)
CREATE INDEX IF NOT EXISTS idx_user_given_name_trgm ON users
  USING GIN (given_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_user_family_name_trgm ON users
  USING GIN (family_name gin_trgm_ops);

-- ── Classes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS classes (
  canonical_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_version             TEXT NOT NULL DEFAULT '1.0',
  external_id                TEXT NOT NULL,
  external_id_alts           JSONB NOT NULL DEFAULT '[]',
  source                     data_source NOT NULL,

  org_canonical_id           UUID NOT NULL REFERENCES organizations(canonical_id),
  course_canonical_id        UUID,
  academic_session_canonical_id UUID,

  title                      TEXT NOT NULL,
  class_code                 TEXT,
  class_type                 TEXT NOT NULL DEFAULT 'scheduled',
  location                   TEXT,

  periods                    TEXT[] NOT NULL DEFAULT '{}',
  grades                     TEXT[] NOT NULL DEFAULT '{}',
  subjects                   TEXT[] NOT NULL DEFAULT '{}',
  subject_codes              TEXT[] NOT NULL DEFAULT '{}',

  teacher_canonical_ids      UUID[] NOT NULL DEFAULT '{}',
  student_canonical_ids      UUID[] NOT NULL DEFAULT '{}',

  playlab_class_id           TEXT,
  playlab_sync_state         sync_status NOT NULL DEFAULT 'pending',

  status                     entity_status NOT NULL DEFAULT 'active',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at             TIMESTAMPTZ,
  source_raw_hash            TEXT NOT NULL,
  metadata                   JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_class_source_external
  ON classes(source, external_id);

CREATE INDEX IF NOT EXISTS idx_class_org ON classes(org_canonical_id);
CREATE INDEX IF NOT EXISTS idx_class_playlab_id ON classes(playlab_class_id)
  WHERE playlab_class_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_class_status ON classes(status);

-- ── Enrollments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS enrollments (
  canonical_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_version     TEXT NOT NULL DEFAULT '1.0',
  external_id        TEXT,   -- null for Clever-derived
  source             data_source NOT NULL,

  user_canonical_id  UUID NOT NULL REFERENCES users(canonical_id),
  class_canonical_id UUID NOT NULL REFERENCES classes(canonical_id),
  org_canonical_id   UUID NOT NULL REFERENCES organizations(canonical_id),

  role               TEXT NOT NULL DEFAULT 'student',
  primary_enrollment BOOLEAN NOT NULL DEFAULT TRUE,
  begin_date         DATE,
  end_date           DATE,

  status             entity_status NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_user_class
  ON enrollments(user_canonical_id, class_canonical_id, role);

CREATE INDEX IF NOT EXISTS idx_enrollment_class ON enrollments(class_canonical_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_user  ON enrollments(user_canonical_id);

-- ── Academic Sessions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academic_sessions (
  canonical_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schema_version            TEXT NOT NULL DEFAULT '1.0',
  external_id               TEXT NOT NULL,
  external_id_alts          JSONB NOT NULL DEFAULT '[]',
  source                    data_source NOT NULL,

  org_canonical_id          UUID NOT NULL REFERENCES organizations(canonical_id),
  parent_session_canonical_id UUID REFERENCES academic_sessions(canonical_id),

  title                     TEXT NOT NULL,
  session_type              TEXT NOT NULL DEFAULT 'term',
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  school_year               INTEGER NOT NULL,

  status                    entity_status NOT NULL DEFAULT 'active',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                  JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_source_external
  ON academic_sessions(source, external_id);

CREATE INDEX IF NOT EXISTS idx_session_org ON academic_sessions(org_canonical_id);
CREATE INDEX IF NOT EXISTS idx_session_year ON academic_sessions(school_year);

-- ── Sync State ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_states (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_id        UUID NOT NULL,
  entity_type         TEXT NOT NULL,
  source              data_source NOT NULL,
  external_id         TEXT NOT NULL,

  playlab_id          TEXT,
  sync_status         sync_status NOT NULL DEFAULT 'pending',
  sync_attempts       INTEGER NOT NULL DEFAULT 0,
  last_synced_at      TIMESTAMPTZ,
  last_error          TEXT,

  source_raw_hash     TEXT NOT NULL DEFAULT '',
  conflict_fields     TEXT[] NOT NULL DEFAULT '{}',
  conflict_sources    TEXT[] NOT NULL DEFAULT '{}',
  conflict_resolution TEXT,

  audit_log           JSONB NOT NULL DEFAULT '[]',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_syncstate_canonical
  ON sync_states(canonical_id, source);

CREATE INDEX IF NOT EXISTS idx_syncstate_status ON sync_states(sync_status);
CREATE INDEX IF NOT EXISTS idx_syncstate_entity ON sync_states(entity_type, sync_status);
CREATE INDEX IF NOT EXISTS idx_syncstate_playlab_id ON sync_states(playlab_id)
  WHERE playlab_id IS NOT NULL;

-- ── Conflicts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflicts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_id   UUID NOT NULL,
  entity_type    TEXT NOT NULL,
  field          TEXT NOT NULL,
  source_a       data_source NOT NULL,
  value_a        JSONB,
  source_b       data_source NOT NULL,
  value_b        JSONB,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  resolution     TEXT,
  resolved_value JSONB
);

CREATE INDEX IF NOT EXISTS idx_conflict_canonical ON conflicts(canonical_id);
CREATE INDEX IF NOT EXISTS idx_conflict_unresolved ON conflicts(canonical_id)
  WHERE resolved_at IS NULL;

-- ── Deduplication Candidates ──────────────────────────────────

CREATE TABLE IF NOT EXISTS dedup_candidates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type     TEXT NOT NULL,
  canonical_id_a  UUID NOT NULL,
  canonical_id_b  UUID NOT NULL,
  match_keys      TEXT[] NOT NULL DEFAULT '{}',
  confidence      NUMERIC(4,3) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dedup_pair
  ON dedup_candidates(LEAST(canonical_id_a::TEXT, canonical_id_b::TEXT),
                      GREATEST(canonical_id_a::TEXT, canonical_id_b::TEXT));

-- ── Connector Credentials (encrypted at application layer) ────

CREATE TABLE IF NOT EXISTS connector_credentials (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  district_id     TEXT NOT NULL,
  source          data_source NOT NULL,
  access_token    TEXT,       -- AES-256 encrypted
  token_expiry    TIMESTAMPTZ,
  client_id       TEXT,       -- AES-256 encrypted
  client_secret   TEXT,       -- AES-256 encrypted
  endpoint_url    TEXT,
  extra_params    JSONB NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credentials_district_source
  ON connector_credentials(district_id, source);

-- ── Updated_at trigger ────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN VALUES ('organizations'),('users'),('classes'),('enrollments'),
                    ('academic_sessions'),('sync_states'),('connector_credentials')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trig_updated_at ON %I;
       CREATE TRIGGER trig_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      tbl, tbl
    );
  END LOOP;
END $$;
