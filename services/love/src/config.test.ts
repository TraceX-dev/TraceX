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

const originalEnv = { ...process.env }

function loadConfig (): { RecordingEnabled: boolean, TranscriptionEnabled: boolean } {
  return require('./config').default
}

beforeEach(() => {
  jest.resetModules()
  process.env = {
    ...originalEnv,
    ACCOUNTS_URL: 'http://account:3000',
    LIVEKIT_PROJECT: 'test',
    LIVEKIT_HOST: 'http://livekit:7880',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
    SECRET: 'secret'
  }
  delete process.env.RECORDING_ENABLED
  delete process.env.TRANSCRIPTION_ENABLED
})

afterEach(() => {
  process.env = originalEnv
  jest.resetModules()
})

describe('love feature switches', () => {
  it('enables recording and transcription by default', () => {
    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(true)
    expect(config.TranscriptionEnabled).toBe(true)
  })

  it.each(['false', 'FALSE', '0', 'no', 'off'])('disables features when set to %s', (value) => {
    process.env.RECORDING_ENABLED = value
    process.env.TRANSCRIPTION_ENABLED = value

    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(false)
    expect(config.TranscriptionEnabled).toBe(false)
  })

  it('switches features independently', () => {
    process.env.RECORDING_ENABLED = 'false'

    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(false)
    expect(config.TranscriptionEnabled).toBe(true)
  })

  it('keeps features enabled for true or empty values', () => {
    process.env.RECORDING_ENABLED = 'true'
    process.env.TRANSCRIPTION_ENABLED = ''

    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(true)
    expect(config.TranscriptionEnabled).toBe(true)
  })

  it.each(['true', 'TRUE', '1', 'yes', 'on'])('keeps features enabled when set to %s', (value) => {
    process.env.RECORDING_ENABLED = value
    process.env.TRANSCRIPTION_ENABLED = value

    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(true)
    expect(config.TranscriptionEnabled).toBe(true)
  })

  it('falls back to the default and warns on an unrecognized value', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.RECORDING_ENABLED = 'flase'

    const config = loadConfig()

    expect(config.RecordingEnabled).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RECORDING_ENABLED'))
    warn.mockRestore()
  })
})
