module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts'],
  globals: { 'ts-jest': { diagnostics: false } },
  testTimeout: 15000,
};
