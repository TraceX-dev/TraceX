module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ["./src"],
  moduleNameMapper: {
    '^@hcengineering/text$': '<rootDir>/../../foundations/core/packages/text/src/index.ts',
    '^@hcengineering/text-agent$': '<rootDir>/../../foundations/core/packages/text-agent/src/index.ts',
    '^@hcengineering/collaborator-client$': '<rootDir>/../../foundations/core/packages/collaborator-client/src/index.ts'
  },
  coverageReporters: ["text-summary", "html"]
}
