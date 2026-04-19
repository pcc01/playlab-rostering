/**
 * Database migration — creates all tables for the canonical store.
 * Run once: ts-node scripts/migrate.ts
 */
import { logger } from '../src/utils/logger';
const log = logger.child({ module: 'migrate' });

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '001_create_external_id_index',
    sql: `CREATE TABLE IF NOT EXISTS external_id_index (
      id          BIGSERIAL PRIMARY KEY,
      canonical_id  UUID NOT NULL,
      entity_type   TEXT NOT NULL,
      source        TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      id_type       TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (source, external_id, entity_type)
    );
    CREATE INDEX IF NOT EXISTS idx_ext_canonical ON external_id_index(canonical_id);`,
  },
  {
    name: '002_create_canonical_organizations',
    sql: `CREATE TABLE IF NOT EXISTS canonical_organizations (
      canonical_id  UUID PRIMARY KEY,
      entity_type   TEXT NOT NULL DEFAULT 'organization',
      source        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_org_nces_district ON canonical_organizations((data->>'ncesDistrictId'));
    CREATE INDEX IF NOT EXISTS idx_org_nces_school   ON canonical_organizations((data->>'ncesSchoolId'));
    CREATE INDEX IF NOT EXISTS idx_org_state_id      ON canonical_organizations((data->>'stateId'));
    CREATE INDEX IF NOT EXISTS idx_org_status        ON canonical_organizations(status);`,
  },
  {
    name: '003_create_canonical_users',
    sql: `CREATE TABLE IF NOT EXISTS canonical_users (
      canonical_id  UUID PRIMARY KEY,
      entity_type   TEXT NOT NULL DEFAULT 'user',
      source        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      primary_role  TEXT NOT NULL,
      ferpa_protected BOOLEAN NOT NULL DEFAULT false,
      coppa_applies   BOOLEAN NOT NULL DEFAULT false,
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_user_email    ON canonical_users((lower(data->>'email')));
    CREATE INDEX IF NOT EXISTS idx_user_status   ON canonical_users(status);
    CREATE INDEX IF NOT EXISTS idx_user_role     ON canonical_users(primary_role);
    CREATE INDEX IF NOT EXISTS idx_user_ext_ids  ON canonical_users USING GIN((data->'externalIdAlts'));`,
  },
  {
    name: '004_create_canonical_classes',
    sql: `CREATE TABLE IF NOT EXISTS canonical_classes (
      canonical_id  UUID PRIMARY KEY,
      entity_type   TEXT NOT NULL DEFAULT 'class',
      source        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      org_canonical_id UUID,
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_class_org ON canonical_classes(org_canonical_id);`,
  },
  {
    name: '005_create_canonical_sessions',
    sql: `CREATE TABLE IF NOT EXISTS canonical_sessions (
      canonical_id  UUID PRIMARY KEY,
      entity_type   TEXT NOT NULL DEFAULT 'academicSession',
      source        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      data          JSONB NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );`,
  },
  {
    name: '006_create_canonical_enrollments',
    sql: `CREATE TABLE IF NOT EXISTS canonical_enrollments (
      canonical_id       UUID PRIMARY KEY,
      user_canonical_id  UUID NOT NULL,
      class_canonical_id UUID NOT NULL,
      org_canonical_id   UUID NOT NULL,
      role               TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'active',
      data               JSONB NOT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_enr_user  ON canonical_enrollments(user_canonical_id);
    CREATE INDEX IF NOT EXISTS idx_enr_class ON canonical_enrollments(class_canonical_id);`,
  },
  {
    name: '007_create_sync_state',
    sql: `CREATE TABLE IF NOT EXISTS sync_state (
      canonical_id     UUID NOT NULL,
      entity_type      TEXT NOT NULL,
      source           TEXT NOT NULL,
      external_id      TEXT NOT NULL,
      playlab_id       TEXT,
      sync_status      TEXT NOT NULL DEFAULT 'pending',
      sync_attempts    INT  NOT NULL DEFAULT 0,
      last_synced_at   TIMESTAMPTZ,
      last_error       TEXT,
      source_raw_hash  TEXT,
      conflict_fields  TEXT[],
      audit_log        JSONB NOT NULL DEFAULT '[]',
      PRIMARY KEY (canonical_id, source)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_state(sync_status);`,
  },
  {
    name: '008_create_schema_migrations',
    sql: `CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );`,
  },
];

async function migrate() {
  let Pool: typeof import('pg').Pool;
  try { Pool = require('pg').Pool; }
  catch { log.error('pg package not installed — run: npm install pg'); process.exit(1); }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Ensure migrations table exists first
    await pool.query(MIGRATIONS.find(m => m.name === '008_create_schema_migrations')!.sql);

    for (const m of MIGRATIONS) {
      const { rows } = await pool.query('SELECT name FROM schema_migrations WHERE name = $1', [m.name]);
      if (rows.length) { log.info(`Skip (already applied): ${m.name}`); continue; }
      log.info(`Applying: ${m.name}`);
      await pool.query(m.sql);
      await pool.query('INSERT INTO schema_migrations(name) VALUES($1)', [m.name]);
      log.info(`Applied: ${m.name}`);
    }
    log.info('All migrations complete');
  } finally { await pool.end(); }
}

migrate().catch(e => { console.error(e); process.exit(1); });
