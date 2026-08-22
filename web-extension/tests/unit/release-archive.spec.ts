import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDeterministicZip,
  createZipFromDirectory,
  crc32,
  normalizeArchivePath,
  readZipEntries,
  toDosDateTime
} from '../../scripts/release/archive'
import { sha256 } from '../../scripts/release/hash'

const SOURCE_DATE_EPOCH = 1_700_000_000

function replaceArchiveName(zip: Buffer, original: string, replacement: string): Buffer {
  const originalBytes = Buffer.from(original)
  const replacementBytes = Buffer.from(replacement)
  if (originalBytes.byteLength !== replacementBytes.byteLength) {
    throw new Error('ZIP name replacement fixtures must have equal byte lengths')
  }
  const result = Buffer.from(zip)
  let offset = 0
  let replacements = 0
  while ((offset = result.indexOf(originalBytes, offset)) !== -1) {
    replacementBytes.copy(result, offset)
    offset += replacementBytes.byteLength
    replacements += 1
  }
  if (replacements !== 2) throw new Error(`Expected local and central names for ${original}`)
  return result
}

describe('deterministic release archive', () => {
  it('normalizes order, timestamp, mode, and file bytes', () => {
    const first = createDeterministicZip(
      [
        { path: 'z.txt', data: Buffer.from('z') },
        { path: 'a/file.txt', data: Buffer.from('alpha') }
      ],
      SOURCE_DATE_EPOCH
    )
    const second = createDeterministicZip(
      [
        { path: 'a/file.txt', data: Buffer.from('alpha') },
        { path: 'z.txt', data: Buffer.from('z') }
      ],
      SOURCE_DATE_EPOCH
    )

    expect(sha256(first)).toBe(sha256(second))
    const expectedTime = toDosDateTime(SOURCE_DATE_EPOCH)
    expect(readZipEntries(first)).toEqual([
      expect.objectContaining({
        path: 'a/file.txt',
        data: Buffer.from('alpha'),
        mode: 0o100644,
        dosDate: expectedTime.date,
        dosTime: expectedTime.time
      }),
      expect.objectContaining({
        path: 'z.txt',
        data: Buffer.from('z'),
        mode: 0o100644,
        dosDate: expectedTime.date,
        dosTime: expectedTime.time
      })
    ])
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('rejects unsafe paths, duplicates, invalid dates, and tampering', () => {
    for (const value of [
      '',
      '/absolute',
      '../escape',
      'a//b',
      'a\\b',
      'a\0b',
      '.hidden',
      'a/.hidden',
      'C:/escape',
      'C:escape',
      'dir/file:stream',
      'CON',
      'aux.txt',
      'trailing.',
      'trailing ',
      'e\u0301.txt'
    ]) {
      expect(() => normalizeArchivePath(value)).toThrow(/archive path|Archive path/)
    }
    expect(() =>
      createDeterministicZip(
        [
          { path: 'same.txt', data: Buffer.from('one') },
          { path: 'same.txt', data: Buffer.from('two') }
        ],
        SOURCE_DATE_EPOCH
      )
    ).toThrow(/Duplicate/)
    expect(() =>
      createDeterministicZip(
        [
          { path: 'folder', data: Buffer.from('file') },
          { path: 'folder/nested.txt', data: Buffer.from('nested') }
        ],
        SOURCE_DATE_EPOCH
      )
    ).toThrow(/Overlapping/)
    expect(() =>
      createDeterministicZip(
        [
          { path: 'Manifest.json', data: Buffer.from('one') },
          { path: 'manifest.json', data: Buffer.from('two') }
        ],
        SOURCE_DATE_EPOCH
      )
    ).toThrow(/aliased/)
    for (const [first, second] of [
      ['σ.txt', 'ς.txt'],
      ['S.txt', 'ſ.txt']
    ] as const) {
      expect(() =>
        createDeterministicZip(
          [
            { path: first, data: Buffer.from('one') },
            { path: second, data: Buffer.from('two') }
          ],
          SOURCE_DATE_EPOCH
        )
      ).toThrow(/aliased/)
    }
    expect(() =>
      createDeterministicZip(
        Array.from({ length: 4_097 }, (_, index) => ({
          path: `entry-${index}.txt`,
          data: Buffer.from('x')
        })),
        SOURCE_DATE_EPOCH
      )
    ).toThrow(/more than 4096/)
    expect(() => toDosDateTime(-1)).toThrow(/non-negative/)

    const zip = createDeterministicZip(
      [{ path: 'file.txt', data: Buffer.from('content') }],
      SOURCE_DATE_EPOCH
    )
    const tampered = Buffer.from(zip)
    const dataOffset = 30 + Buffer.byteLength('file.txt')
    const firstByte = tampered[dataOffset]
    if (firstByte === undefined) throw new Error('ZIP fixture data is missing')
    tampered[dataOffset] = firstByte ^ 0xff
    expect(() => readZipEntries(tampered)).toThrow(/CRC/)
    expect(() => readZipEntries(Buffer.concat([zip, Buffer.from('trailing')]))).toThrow(/trailing/)
  })

  it('rejects Unicode case-fold aliases while reading external ZIPs', () => {
    const cases = [
      {
        placeholders: ['α.txt', 'β.txt'],
        aliases: ['σ.txt', 'ς.txt']
      },
      {
        placeholders: ['A.txt', 'é.txt'],
        aliases: ['S.txt', 'ſ.txt']
      }
    ] as const
    for (const { placeholders, aliases } of cases) {
      let zip = createDeterministicZip(
        placeholders.map((entry, index) => ({ path: entry, data: Buffer.from(String(index)) })),
        SOURCE_DATE_EPOCH
      )
      zip = replaceArchiveName(zip, placeholders[0], aliases[0])
      zip = replaceArchiveName(zip, placeholders[1], aliases[1])
      expect(() => readZipEntries(zip)).toThrow(/aliased/)
    }
  })

  it('rejects inconsistent local headers, overlapping entry ranges, and central-directory gaps', () => {
    const zip = createDeterministicZip(
      [
        { path: 'a.txt', data: Buffer.from('x') },
        { path: 'b.txt', data: Buffer.from('x') }
      ],
      SOURCE_DATE_EPOCH
    )
    const endOffset = zip.byteLength - 22
    const centralOffset = zip.readUInt32LE(endOffset + 16)
    const firstNameLength = zip.readUInt16LE(centralOffset + 28)
    const secondCentralOffset = centralOffset + 46 + firstNameLength
    const secondLocalOffset = zip.readUInt32LE(secondCentralOffset + 42)

    const localHeaderMismatch = Buffer.from(zip)
    localHeaderMismatch.writeUInt16LE(8, secondLocalOffset + 8)
    expect(() => readZipEntries(localHeaderMismatch)).toThrow(/Local header metadata differs/)

    const overlapping = Buffer.from(zip)
    const firstLocalOffset = zip.readUInt32LE(centralOffset + 42)
    overlapping.writeUInt32LE(firstLocalOffset, secondCentralOffset + 42)
    expect(() => readZipEntries(overlapping)).toThrow(/local entry order|local entries overlap/)

    const centralGap = Buffer.concat([
      zip.subarray(0, endOffset),
      Buffer.from([0]),
      zip.subarray(endOffset)
    ])
    expect(() => readZipEntries(centralGap)).toThrow(/immediately precede/)

    const nonCanonicalFlags = Buffer.from(zip)
    nonCanonicalFlags.writeUInt16LE(0x0808, centralOffset + 8)
    expect(() => readZipEntries(nonCanonicalFlags)).toThrow(/UTF-8 file-name flag/)

    const nonCanonicalMode = Buffer.from(zip)
    nonCanonicalMode.writeUInt32LE((0o100755 << 16) >>> 0, centralOffset + 38)
    expect(() => readZipEntries(nonCanonicalMode)).toThrow(/stored without extras or comments/)
  })

  it('packages regular directory files and rejects hidden files, maps, and symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-archive-'))
    const input = path.join(root, 'input')
    await mkdir(path.join(input, 'nested'), { recursive: true })
    await writeFile(path.join(input, 'manifest.json'), '{}')
    await writeFile(path.join(input, 'nested', 'entry.js'), 'export {}')
    const output = path.join(root, 'out.zip')
    await createZipFromDirectory(input, output, SOURCE_DATE_EPOCH)
    expect(readZipEntries(await readFile(output)).map((entry) => entry.path)).toEqual([
      'manifest.json',
      'nested/entry.js'
    ])

    await writeFile(path.join(input, '.hidden'), 'hidden')
    await expect(createZipFromDirectory(input, output, SOURCE_DATE_EPOCH)).rejects.toThrow(/Hidden/)
    await writeFile(path.join(input, 'debug.map'), '{}')
    await expect(createZipFromDirectory(input, output, SOURCE_DATE_EPOCH)).rejects.toThrow(
      /Hidden|Source map/
    )
    await symlink(path.join(input, 'manifest.json'), path.join(input, 'manifest-link.json'))
    await expect(createZipFromDirectory(input, output, SOURCE_DATE_EPOCH)).rejects.toThrow(
      /Hidden|Source map|symlink/
    )

    const linkedInput = path.join(root, 'linked-input')
    await symlink(input, linkedInput)
    await expect(createZipFromDirectory(linkedInput, output, SOURCE_DATE_EPOCH)).rejects.toThrow(
      /plain directory/
    )
  })
})
