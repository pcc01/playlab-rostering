import { ComplianceProfile } from '../types/canonical';

const US_PROFILE: ComplianceProfile = {
  studentPrivacyLaws: ['FERPA', 'PPRA'],
  minorProtectionLaws: ['COPPA', 'CIPA'],
  regionalPrivacyLaws: ['CCPA'],
  aiGovernanceLaws: ['NIST_AI_RMF'],
  dataResidencyRegion: 'us-east-1',
  gdprApplies: false, euAiActApplies: false,
  dataRetentionYears: 7, countryCode: 'US',
};
const EU_PROFILE: ComplianceProfile = {
  studentPrivacyLaws: ['GDPR'],
  minorProtectionLaws: ['GDPR_Art8'],
  regionalPrivacyLaws: ['GDPR'],
  aiGovernanceLaws: ['EU_AI_Act', 'UNESCO_AI_Ethics'],
  dataResidencyRegion: 'eu-west-1',
  gdprApplies: true, euAiActApplies: true,
  dataRetentionYears: 3, countryCode: 'EU',
};
const UK_PROFILE: ComplianceProfile = {
  studentPrivacyLaws: ['UK_GDPR'],
  minorProtectionLaws: ['AADC', 'UK_GDPR'],
  regionalPrivacyLaws: ['UK_GDPR'],
  aiGovernanceLaws: ['AISI', 'UNESCO_AI_Ethics'],
  dataResidencyRegion: 'eu-west-2',
  gdprApplies: true, euAiActApplies: false,
  dataRetentionYears: 3, countryCode: 'GB',
};
const AU_PROFILE: ComplianceProfile = {
  studentPrivacyLaws: ['APPs'],
  minorProtectionLaws: ['NCC', 'APPs'],
  regionalPrivacyLaws: ['APPs'],
  aiGovernanceLaws: ['UNESCO_AI_Ethics'],
  dataResidencyRegion: 'ap-southeast-2',
  gdprApplies: false, euAiActApplies: false,
  dataRetentionYears: 7, countryCode: 'AU',
};
const CA_PROFILE: ComplianceProfile = {
  studentPrivacyLaws: ['PIPEDA', 'FIPPA'],
  minorProtectionLaws: ['PIPEDA'],
  regionalPrivacyLaws: ['PIPEDA'],
  aiGovernanceLaws: ['UNESCO_AI_Ethics'],
  dataResidencyRegion: 'ca-central-1',
  gdprApplies: false, euAiActApplies: false,
  dataRetentionYears: 7, countryCode: 'CA',
};

const DEFAULT_PROFILE: ComplianceProfile = { ...US_PROFILE };

export const getComplianceProfile = (countryCode: string, regionCode?: string | null): ComplianceProfile => {
  const cc = (countryCode ?? 'US').toUpperCase();
  const EU_MEMBERS = ['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'];
  if (cc === 'US') {
    const prof = { ...US_PROFILE, countryCode: 'US', regionCode };
    if (regionCode === 'CA') prof.regionalPrivacyLaws = ['CCPA'];
    return prof;
  }
  if (EU_MEMBERS.includes(cc)) return { ...EU_PROFILE, countryCode: cc };
  if (cc === 'GB') return UK_PROFILE;
  if (cc === 'AU') return AU_PROFILE;
  if (cc === 'CA') return CA_PROFILE;
  return { ...DEFAULT_PROFILE, countryCode: cc };
};
