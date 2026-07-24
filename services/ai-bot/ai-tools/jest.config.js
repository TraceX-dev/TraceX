module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ['./src'],
  moduleNameMapper: {
    '^typebox$': '<rootDir>/jest.typebox.js',
    '^typebox/schema$': '<rootDir>/jest.typebox-schema.js'
  },
  coverageReporters: ['text-summary', 'html']
}
