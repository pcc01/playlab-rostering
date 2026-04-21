import { AgeGroup } from '../types/canonical';
export const computeAgeGroup = (dob: string | null, grade: string | null): AgeGroup => {
  if (dob) {
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
    if (age < 13) return 'under13';
    if (age < 18) return '13to17';
    return '18plus';
  }
  // Grade-based proxy when DOB absent
  const gradeNum = parseInt(grade ?? '', 10);
  if (grade === 'PreKindergarten' || grade === 'Kindergarten' || grade === 'InfantToddler' || grade === 'Preschool') return 'under13';
  if (!isNaN(gradeNum)) {
    if (gradeNum <= 6) return 'under13';
    if (gradeNum <= 11) return '13to17';
    return '18plus';
  }
  return 'unknown';
};
export const coppaApplies = (ageGroup: AgeGroup): boolean => ageGroup === 'under13';
