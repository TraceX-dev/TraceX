//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@hcengineering/integration$': '<rootDir>/../../plugins/integration/src',
    '^@hcengineering/model-integration$': '<rootDir>/../../models/integration/src',
    '^@hcengineering/model-calendar$': '<rootDir>/../../models/calendar/src',
    '^@hcengineering/model-server-calendar$': '<rootDir>/../../models/server-calendar/src',
    '^@hcengineering/model-server-card$': '<rootDir>/../../models/server-card/src',
    '^@hcengineering/model-server-chunter$': '<rootDir>/../../models/server-chunter/src',
    '^@hcengineering/model-server-contact$': '<rootDir>/../../models/server-contact/src',
    '^@hcengineering/model-server-controlled-documents$': '<rootDir>/../../models/server-controlled-documents/src',
    '^@hcengineering/model-server-process$': '<rootDir>/../../models/server-process/src',
    '^@hcengineering/model-server-time$': '<rootDir>/../../models/server-time/src',
    '^@hcengineering/server-calendar$': '<rootDir>/../../server-plugins/calendar/src',
    '^@hcengineering/server-card$': '<rootDir>/../../server-plugins/card/src',
    '^@hcengineering/server-chunter$': '<rootDir>/../../server-plugins/chunter/src',
    '^@hcengineering/server-contact$': '<rootDir>/../../server-plugins/contact/src',
    '^@hcengineering/server-controlled-documents$': '<rootDir>/../../server-plugins/controlled-documents/src',
    '^@hcengineering/server-process$': '<rootDir>/../../server-plugins/process/src',
    '^@hcengineering/server-time$': '<rootDir>/../../server-plugins/time/src',
    '^@hcengineering/server-calendar-resources$': '<rootDir>/../../server-plugins/calendar-resources/src',
    '^@hcengineering/server-card-resources$': '<rootDir>/../../server-plugins/card-resources/src',
    '^@hcengineering/server-chunter-resources$': '<rootDir>/../../server-plugins/chunter-resources/src',
    '^@hcengineering/server-contact-resources$': '<rootDir>/../../server-plugins/contact-resources/src',
    '^@hcengineering/server-controlled-documents-resources$': '<rootDir>/../../server-plugins/controlled-documents-resources/src',
    '^@hcengineering/server-document-resources$': '<rootDir>/../../server-plugins/document-resources/src',
    '^@hcengineering/server-process-resources$': '<rootDir>/../../server-plugins/process-resources/src',
    '^@hcengineering/server-time-resources$': '<rootDir>/../../server-plugins/time-resources/src',
    '^@hcengineering/server-tracker-resources$': '<rootDir>/../../server-plugins/tracker-resources/src'
  },
  roots: ['./src'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)']
}
