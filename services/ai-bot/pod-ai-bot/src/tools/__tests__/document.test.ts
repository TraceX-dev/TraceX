import { Readable } from 'stream'

import { readDriveFile } from '../document'
import { pdfToMarkdown } from '../pdf'

jest.mock('../pdf', () => {
  return {
    pdfToMarkdown: jest.fn(),
    stream2buffer: async (stream: Readable) =>
      await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        stream.on('end', () => {
          resolve(Buffer.concat(chunks))
        })
        stream.on('error', reject)
      })
  }
})

describe('document tools', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns an error when PDF markdown extraction is unavailable', async () => {
    ;(pdfToMarkdown as jest.Mock).mockResolvedValue(undefined)

    const fileContent = Buffer.from('pdf bytes')
    const ops: any = {
      ctx: { warn: jest.fn() },
      wsIds: {},
      getClient: jest.fn(async () => ({
        findOne: jest.fn(async () => ({
          _id: 'version-1',
          file: 'blob-1',
          title: 'ISO 13485V.2016 EN.pdf',
          type: 'application/pdf'
        }))
      })),
      storage: {
        get: jest.fn(async () => Readable.from([fileContent]))
      }
    }

    const result = await readDriveFile(ops, {
      _id: 'file-1',
      file: 'version-1',
      title: 'ISO 13485V.2016 EN.pdf'
    } as any)

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'content_read_failed',
        message: 'Could not read PDF content from Drive file "ISO 13485V.2016 EN.pdf".'
      }
    })
    expect(ops.storage.get).not.toHaveBeenCalled()
  })
})
