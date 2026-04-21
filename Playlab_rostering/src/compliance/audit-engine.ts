/**
 * AI Compliance Audit Engine
 * Monitors regulatory sources for changes, scores compliance risk,
 * and notifies the Playlab team when updates are needed.
 */
import { ComplianceProfile } from '../types/canonical';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'compliance-audit' });

export interface LegislativeSource {
  id: string;
  name: string;
  url: string;
  countryCode: string;
  category: 'federal_privacy' | 'minor_protection' | 'regional_privacy' | 'ai_governance';
  lastChecked: string | null;
  lastChanged: string | null;
  currentHash: string | null;
}

export interface ComplianceAlert {
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: LegislativeSource;
  message: string;
  affectedCountries: string[];
  actionRequired: string;
  detectedAt: string;
}

export interface ComplianceAuditResult {
  checkedAt: string;
  sourcesChecked: number;
  changesDetected: number;
  alerts: ComplianceAlert[];
  riskScoreByCountry: Record<string, number>;
}

// Known regulatory sources the engine monitors
const REGULATORY_SOURCES: LegislativeSource[] = [
  { id: 'ferpa', name: 'FERPA (US)', url: 'https://studentprivacy.ed.gov', countryCode: 'US', category: 'federal_privacy', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'coppa', name: 'COPPA (US)', url: 'https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa', countryCode: 'US', category: 'minor_protection', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'gdpr', name: 'GDPR (EU)', url: 'https://gdpr-info.eu', countryCode: 'EU', category: 'regional_privacy', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'eu_ai_act', name: 'EU AI Act', url: 'https://artificialintelligenceact.eu', countryCode: 'EU', category: 'ai_governance', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'uk_gdpr', name: 'UK GDPR / AADC', url: 'https://ico.org.uk', countryCode: 'GB', category: 'regional_privacy', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'pipeda', name: 'PIPEDA (Canada)', url: 'https://www.priv.gc.ca', countryCode: 'CA', category: 'federal_privacy', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'apps', name: 'APPs (Australia)', url: 'https://www.oaic.gov.au', countryCode: 'AU', category: 'federal_privacy', lastChecked: null, lastChanged: null, currentHash: null },
  { id: 'lgpd', name: 'LGPD (Brazil)', url: 'https://www.gov.br/anpd', countryCode: 'BR', category: 'regional_privacy', lastChecked: null, lastChanged: null, currentHash: null },
];

export class ComplianceAuditEngine {
  private sources: LegislativeSource[] = [...REGULATORY_SOURCES];

  // ── Assess compliance profile for an org ──────────────────────────────────
  assessProfile(profile: ComplianceProfile): { riskScore: number; gaps: string[] } {
    const gaps: string[] = [];
    let score = 100;

    if (profile.gdprApplies && !profile.studentPrivacyLaws.includes('GDPR')) {
      gaps.push('GDPR applies but not listed in studentPrivacyLaws');
      score -= 20;
    }
    if (profile.euAiActApplies && !profile.aiGovernanceLaws.includes('EU_AI_Act')) {
      gaps.push('EU AI Act applies but not listed in aiGovernanceLaws');
      score -= 25;
    }
    if (profile.countryCode === 'US' && !profile.minorProtectionLaws.includes('COPPA')) {
      gaps.push('US org missing COPPA in minorProtectionLaws');
      score -= 15;
    }
    if (profile.dataRetentionYears < 1) {
      gaps.push('Data retention period is less than 1 year');
      score -= 10;
    }
    if (!profile.dataResidencyRegion) {
      gaps.push('No data residency region configured');
      score -= 10;
    }

    return { riskScore: Math.max(0, score), gaps };
  }

  // ── Run audit (simulated — real impl calls AI analysis API) ───────────────
  async runAudit(countryCodes: string[]): Promise<ComplianceAuditResult> {
    const now = new Date().toISOString();
    log.info('Running compliance audit', { countryCodes });

    const alerts: ComplianceAlert[] = [];
    const riskScoreByCountry: Record<string, number> = {};
    let changesDetected = 0;

    const relevantSources = this.sources.filter(
      s => countryCodes.includes(s.countryCode) || s.countryCode === 'EU',
    );

    for (const source of relevantSources) {
      source.lastChecked = now;

      // In production: fetch source URL, hash content, compare to currentHash
      // Here: simulate with deterministic logic
      const simulatedChanged = false; // would be: newHash !== source.currentHash

      if (simulatedChanged) {
        changesDetected++;
        alerts.push({
          severity: source.category === 'ai_governance' ? 'critical' : 'high',
          source,
          message: `Legislative change detected in ${source.name}`,
          affectedCountries: [source.countryCode],
          actionRequired: `Review changes in ${source.name} and update compliance profile for ${source.countryCode} orgs`,
          detectedAt: now,
        });
      }

      // Score each country
      const cc = source.countryCode;
      riskScoreByCountry[cc] = riskScoreByCountry[cc] ?? 100;
    }

    const result: ComplianceAuditResult = {
      checkedAt: now,
      sourcesChecked: relevantSources.length,
      changesDetected,
      alerts,
      riskScoreByCountry,
    };

    if (alerts.length > 0) {
      await this.notifyPlaybabTeam(alerts);
    }

    log.info('Audit complete', { sourcesChecked: result.sourcesChecked, changesDetected });
    return result;
  }

  // ── Notification stub — real impl sends email / opens ticket ─────────────
  private async notifyPlaybabTeam(alerts: ComplianceAlert[]): Promise<void> {
    for (const alert of alerts) {
      log.warn('COMPLIANCE ALERT — Playlab team notification required', {
        severity: alert.severity,
        source: alert.source.name,
        action: alert.actionRequired,
      });
      // Production: POST to Slack webhook, open Linear/Jira ticket, send email
    }
  }

  getSources(): LegislativeSource[] { return this.sources; }

  getSourceById(id: string): LegislativeSource | undefined {
    return this.sources.find(s => s.id === id);
  }
}
