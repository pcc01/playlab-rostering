import { getComplianceProfile } from '../../src/utils/compliance';
import { ComplianceAuditEngine } from '../../src/compliance/audit-engine';
import { normalizeCleverDistrict } from '../../src/normalizers/clever';
import { cleverDistrict } from '../fixtures/clever';

describe('getComplianceProfile', () => {
  it('returns US profile with FERPA and COPPA for US org', () => {
    const p = getComplianceProfile('US');
    expect(p.studentPrivacyLaws).toContain('FERPA');
    expect(p.minorProtectionLaws).toContain('COPPA');
    expect(p.minorProtectionLaws).toContain('CIPA');
    expect(p.gdprApplies).toBe(false);
    expect(p.dataResidencyRegion).toBe('us-east-1');
    expect(p.dataRetentionYears).toBe(7);
  });

  it('adds CCPA for California orgs', () => {
    const p = getComplianceProfile('US', 'CA');
    expect(p.regionalPrivacyLaws).toContain('CCPA');
  });

  it('returns EU profile with GDPR and EU AI Act for German org', () => {
    const p = getComplianceProfile('DE');
    expect(p.gdprApplies).toBe(true);
    expect(p.euAiActApplies).toBe(true);
    expect(p.studentPrivacyLaws).toContain('GDPR');
    expect(p.minorProtectionLaws).toContain('GDPR_Art8');
    expect(p.dataResidencyRegion).toBe('eu-west-1');
    expect(p.dataRetentionYears).toBe(3);
  });

  it('returns UK profile with AADC', () => {
    const p = getComplianceProfile('GB');
    expect(p.minorProtectionLaws).toContain('AADC');
    expect(p.gdprApplies).toBe(true);
    expect(p.euAiActApplies).toBe(false); // UK no longer in EU AI Act
    expect(p.aiGovernanceLaws).toContain('AISI');
  });

  it('returns Australian profile with APPs and NCC', () => {
    const p = getComplianceProfile('AU');
    expect(p.studentPrivacyLaws).toContain('APPs');
    expect(p.minorProtectionLaws).toContain('NCC');
    expect(p.dataResidencyRegion).toBe('ap-southeast-2');
  });

  it('returns Canadian profile with PIPEDA', () => {
    const p = getComplianceProfile('CA');
    expect(p.studentPrivacyLaws).toContain('PIPEDA');
  });

  it('defaults to US profile for unknown country', () => {
    const p = getComplianceProfile('ZZ');
    expect(p.studentPrivacyLaws).toContain('FERPA');
  });
});

describe('ComplianceAuditEngine', () => {
  const engine = new ComplianceAuditEngine();

  it('assesses a compliant US profile as low risk', () => {
    const profile = getComplianceProfile('US');
    const { riskScore, gaps } = engine.assessProfile(profile);
    expect(riskScore).toBeGreaterThanOrEqual(70);
    expect(gaps).toHaveLength(0);
  });

  it('detects missing GDPR when gdprApplies=true', () => {
    const profile = getComplianceProfile('DE');
    profile.studentPrivacyLaws = []; // simulate misconfiguration
    const { riskScore, gaps } = engine.assessProfile(profile);
    expect(gaps.some(g => g.includes('GDPR'))).toBe(true);
    expect(riskScore).toBeLessThan(100);
  });

  it('detects missing EU AI Act when euAiActApplies=true', () => {
    const profile = getComplianceProfile('FR');
    profile.aiGovernanceLaws = [];
    const { gaps } = engine.assessProfile(profile);
    expect(gaps.some(g => g.includes('EU AI Act'))).toBe(true);
  });

  it('penalises missing data residency region', () => {
    const profile = getComplianceProfile('US');
    profile.dataResidencyRegion = '';
    const { riskScore } = engine.assessProfile(profile);
    expect(riskScore).toBeLessThan(100);
  });

  it('lists all expected regulatory sources', () => {
    const sources = engine.getSources();
    const ids = sources.map(s => s.id);
    expect(ids).toContain('ferpa');
    expect(ids).toContain('gdpr');
    expect(ids).toContain('eu_ai_act');
    expect(ids).toContain('coppa');
    expect(ids).toContain('uk_gdpr');
  });

  it('runs an audit and returns structured results', async () => {
    const result = await engine.runAudit(['US', 'DE', 'GB']);
    expect(result.checkedAt).toBeTruthy();
    expect(result.sourcesChecked).toBeGreaterThan(0);
    expect(result.alerts).toBeInstanceOf(Array);
    expect(result.riskScoreByCountry).toBeDefined();
  });

  it('attaches correct complianceProfile to a Clever district', () => {
    const { entity } = normalizeCleverDistrict(cleverDistrict);
    expect(entity.complianceProfile.studentPrivacyLaws).toContain('FERPA');
    expect(entity.complianceProfile.countryCode).toBe('US');
  });
});
