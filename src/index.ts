/**
 * Playlab Rostering Middleware — Main entry point
 *
 * Wires together: source connectors → ingest pipeline → canonical store → Playlab sync worker
 *
 * Usage:
 *   Full sync:   SOURCE=clever ts-node src/index.ts
 *   Delta sync:  SOURCE=clever DELTA=true LAST_EVENT_ID=evt-123 ts-node src/index.ts
 *   All sources: SOURCE=all ts-node src/index.ts
 */
import { logger } from './utils/logger';
import { InMemoryStore } from './db/store';
import { CleverConnector } from './connectors/clever';
import { ClassLinkConnector } from './connectors/classlink';
import { OneRosterConnector } from './connectors/oneroster';
import { IngestPipeline, IngestResult } from './pipeline/ingest';
import { SyncWorker } from './sync/sync-worker';
import { PlaybabClient } from './sync/playlab-client';
import { ComplianceAuditEngine } from './compliance/audit-engine';
import { SourceConnector } from './types/canonical';

const log = logger.child({ module: 'main' });

// ── Configuration from environment ──────────────────────────────────────────
const cfg = {
  source:        process.env.SOURCE         ?? 'clever',
  delta:         process.env.DELTA          === 'true',
  lastEventId:   process.env.LAST_EVENT_ID  ?? '',
  dryRun:        process.env.DRY_RUN        === 'true',
  // Clever
  cleverDistrictToken: process.env.CLEVER_DISTRICT_TOKEN ?? '',
  cleverClientId:      process.env.CLEVER_CLIENT_ID      ?? '',
  cleverClientSecret:  process.env.CLEVER_CLIENT_SECRET  ?? '',
  // ClassLink
  classlinkClientId:     process.env.CLASSLINK_CLIENT_ID     ?? '',
  classlinkClientSecret: process.env.CLASSLINK_CLIENT_SECRET ?? '',
  classlinkAppId:        process.env.CLASSLINK_APP_ID        ?? '',
  // OneRoster
  orBaseUrl:      process.env.OR_BASE_URL      ?? '',
  orClientId:     process.env.OR_CLIENT_ID     ?? '',
  orClientSecret: process.env.OR_CLIENT_SECRET ?? '',
  orTokenUrl:     process.env.OR_TOKEN_URL     ?? '',
  // Playlab
  playbabBaseUrl: process.env.PLAYLAB_BASE_URL ?? 'https://api.playlab.ai',
  playbabApiKey:  process.env.PLAYLAB_API_KEY  ?? '',
};

// ── Build connectors ──────────────────────────────────────────────────────────
function buildConnectors(): SourceConnector[] {
  const connectors: SourceConnector[] = [];

  if (cfg.source === 'clever' || cfg.source === 'all') {
    if (!cfg.cleverDistrictToken) { log.warn('CLEVER_DISTRICT_TOKEN not set — skipping Clever'); }
    else connectors.push(new CleverConnector({ clientId: cfg.cleverClientId, clientSecret: cfg.cleverClientSecret, baseUrl: 'https://api.clever.com', districtToken: cfg.cleverDistrictToken }));
  }

  if (cfg.source === 'classlink' || cfg.source === 'all') {
    if (!cfg.classlinkClientId) { log.warn('CLASSLINK_CLIENT_ID not set — skipping ClassLink'); }
    else connectors.push(new ClassLinkConnector({ clientId: cfg.classlinkClientId, clientSecret: cfg.classlinkClientSecret, baseUrl: '', appId: cfg.classlinkAppId }));
  }

  if (cfg.source === 'oneroster' || cfg.source === 'all') {
    if (!cfg.orBaseUrl) { log.warn('OR_BASE_URL not set — skipping OneRoster direct'); }
    else connectors.push(new OneRosterConnector({ clientId: cfg.orClientId, clientSecret: cfg.orClientSecret, baseUrl: cfg.orBaseUrl, tokenUrl: cfg.orTokenUrl }));
  }

  return connectors;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log.info('Playlab Rostering Middleware starting', { source: cfg.source, delta: cfg.delta, dryRun: cfg.dryRun });

  // 1. Compliance audit (runs weekly in production via cron)
  if (process.env.RUN_COMPLIANCE_AUDIT === 'true') {
    const engine = new ComplianceAuditEngine();
    const audit = await engine.runAudit(['US', 'DE', 'GB', 'AU', 'CA']);
    log.info('Compliance audit complete', { sourcesChecked: audit.sourcesChecked, alerts: audit.alerts.length });
  }

  // 2. Build store (InMemory for now; swap for PostgresStore in production)
  const store = new InMemoryStore();

  // 3. Build connectors and run ingest pipeline
  const connectors = buildConnectors();
  if (!connectors.length) { log.error('No connectors configured — exiting'); process.exit(1); }

  const ingestResults: IngestResult[] = [];
  for (const connector of connectors) {
    const pipeline = new IngestPipeline(connector, store);
    let result: IngestResult;
    if (cfg.delta && cfg.lastEventId) {
      log.info('Running delta sync', { source: connector.sourceName, since: cfg.lastEventId });
      result = await pipeline.runDelta(cfg.lastEventId);
    } else {
      log.info('Running full sync', { source: connector.sourceName });
      result = await pipeline.run({ fullSync: true, dryRun: cfg.dryRun });
    }
    ingestResults.push(result);
    log.info('Ingest result', result);
  }

  // 4. Sync to Playlab
  if (!cfg.dryRun && cfg.playbabApiKey) {
    const client = new PlaybabClient(cfg.playbabBaseUrl, cfg.playbabApiKey);
    const worker = new SyncWorker(store, client);
    const syncResult = await worker.run();
    log.info('Playlab sync result', syncResult);
  } else if (cfg.dryRun) {
    log.info('Dry run — skipping Playlab sync');
  } else {
    log.warn('PLAYLAB_API_KEY not set — skipping Playlab sync');
  }

  // 5. Final report
  const totals = ingestResults.reduce((acc, r) => ({
    created: acc.created + r.created, updated: acc.updated + r.updated,
    conflicts: acc.conflicts + r.conflicts, errors: acc.errors + r.errors,
  }), { created: 0, updated: 0, conflicts: 0, errors: 0 });

  log.info('Run complete', { store: store.stats(), ...totals });

  if (totals.errors > 0) process.exitCode = 1;
}

main().catch(err => { log.error('Fatal error', { error: (err as Error).message }); process.exit(1); });
