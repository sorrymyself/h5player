import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const UTF8_FILE_NAME_FLAG = 0x0800
const ZIP_VERSION_NEEDED = 20
const ZIP_VERSION_MADE_BY_UNIX = (3 << 8) | 30
const REGULAR_FILE_MODE = 0o100644
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff
const MIN_ZIP_YEAR = 1980
const MAX_ZIP_YEAR = 2107
const MAX_RELEASE_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_RELEASE_ARCHIVE_ENTRIES = 4_096
const MAX_RELEASE_ENTRY_BYTES = 16 * 1024 * 1024
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/

export type ArchiveInput = Readonly<{
  path: string
  data: Uint8Array
}>

export type ArchiveEntry = Readonly<{
  path: string
  data: Uint8Array
  crc32: number
  compressedSize: number
  uncompressedSize: number
  mode: number
  dosDate: number
  dosTime: number
}>

type PreparedEntry = ArchiveEntry &
  Readonly<{
    name: Buffer
    localOffset: number
  }>

let crcTable: Uint32Array | undefined

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

export function crc32(data: Uint8Array): number {
  const table = crcTable ?? (crcTable = createCrcTable())
  let value = 0xffffffff
  for (const byte of data) {
    const tableValue = table[(value ^ byte) & 0xff]
    if (tableValue === undefined) throw new Error('CRC32 table lookup failed')
    value = tableValue ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

export function normalizeArchivePath(value: string): string {
  if (value.length === 0 || value.includes('\0') || value.includes('\\')) {
    throw new Error(`Unsafe archive path: ${value}`)
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Archive path must be relative: ${value}`)
  }
  const normalized = path.posix.normalize(value)
  const segments = normalized.split('/')
  if (
    normalized !== value ||
    normalized === '.' ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        segment !== segment.normalize('NFC') ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        hasWindowsForbiddenCharacter(segment) ||
        WINDOWS_RESERVED_NAME.test(segment)
    )
  ) {
    throw new Error(`Unsafe archive path: ${value}`)
  }
  if (Buffer.byteLength(normalized) > MAX_UINT16) {
    throw new Error(`Archive path is too long: ${value}`)
  }
  return normalized
}

function archiveAliasKey(value: string): string {
  return value.normalize('NFC').toUpperCase().normalize('NFC')
}

function hasWindowsForbiddenCharacter(value: string): boolean {
  return (
    WINDOWS_FORBIDDEN_CHARACTER.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)
  )
}

function decodeArchivePath(value: Uint8Array): string {
  const bytes = Buffer.from(value)
  const decoded = bytes.toString('utf8')
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) {
    throw new Error('Archive path must be valid UTF-8')
  }
  return normalizeArchivePath(decoded)
}

function assertUniqueArchivePath(
  archivePath: string,
  seenPaths: Set<string>,
  seenAncestors: Set<string>,
  seenAliases: Set<string>,
  seenAliasAncestors: Set<string>
): void {
  const alias = archiveAliasKey(archivePath)
  if (seenPaths.has(archivePath) || seenAliases.has(alias)) {
    throw new Error(`Duplicate or aliased archive path: ${archivePath}`)
  }
  if (seenAncestors.has(archivePath) || seenAliasAncestors.has(alias)) {
    throw new Error(`Overlapping archive path: ${archivePath}`)
  }

  const segments = archivePath.split('/')
  let ancestor = ''
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment === undefined) throw new Error(`Unsafe archive path: ${archivePath}`)
    ancestor = ancestor.length === 0 ? segment : `${ancestor}/${segment}`
    const ancestorAlias = archiveAliasKey(ancestor)
    if (seenPaths.has(ancestor) || seenAliases.has(ancestorAlias)) {
      throw new Error(`Overlapping archive paths: ${ancestor} and ${archivePath}`)
    }
    seenAncestors.add(ancestor)
    seenAliasAncestors.add(ancestorAlias)
  }
  seenPaths.add(archivePath)
  seenAliases.add(alias)
}

export function toDosDateTime(sourceDateEpoch: number): Readonly<{ date: number; time: number }> {
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer')
  }
  const timestamp = new Date(sourceDateEpoch * 1_000)
  if (!Number.isFinite(timestamp.getTime())) throw new Error('SOURCE_DATE_EPOCH is out of range')
  const year = Math.max(MIN_ZIP_YEAR, timestamp.getUTCFullYear())
  if (year > MAX_ZIP_YEAR) throw new Error(`ZIP timestamp cannot exceed ${MAX_ZIP_YEAR}`)
  const month =
    year === MIN_ZIP_YEAR && timestamp.getUTCFullYear() < MIN_ZIP_YEAR
      ? 1
      : timestamp.getUTCMonth() + 1
  const day =
    year === MIN_ZIP_YEAR && timestamp.getUTCFullYear() < MIN_ZIP_YEAR ? 1 : timestamp.getUTCDate()
  const hours =
    year === MIN_ZIP_YEAR && timestamp.getUTCFullYear() < MIN_ZIP_YEAR ? 0 : timestamp.getUTCHours()
  const minutes =
    year === MIN_ZIP_YEAR && timestamp.getUTCFullYear() < MIN_ZIP_YEAR
      ? 0
      : timestamp.getUTCMinutes()
  const seconds =
    year === MIN_ZIP_YEAR && timestamp.getUTCFullYear() < MIN_ZIP_YEAR
      ? 0
      : timestamp.getUTCSeconds()
  return {
    date: ((year - MIN_ZIP_YEAR) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2)
  }
}

function assertZip32Size(size: number, label: string): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UINT32) {
    throw new Error(`${label} exceeds the ZIP32 limit`)
  }
}

function prepareEntries(inputs: readonly ArchiveInput[], sourceDateEpoch: number): PreparedEntry[] {
  if (inputs.length > MAX_RELEASE_ARCHIVE_ENTRIES) {
    throw new Error(`Archive contains more than ${MAX_RELEASE_ARCHIVE_ENTRIES} files`)
  }
  const { date, time } = toDosDateTime(sourceDateEpoch)
  const seenPaths = new Set<string>()
  const seenAncestors = new Set<string>()
  const seenAliases = new Set<string>()
  const seenAliasAncestors = new Set<string>()
  let localOffset = 0
  return [...inputs]
    .map((input) => ({ path: normalizeArchivePath(input.path), data: Buffer.from(input.data) }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    .map((input) => {
      assertUniqueArchivePath(input.path, seenPaths, seenAncestors, seenAliases, seenAliasAncestors)
      const name = Buffer.from(input.path, 'utf8')
      assertZip32Size(input.data.byteLength, `Archive entry ${input.path}`)
      if (input.data.byteLength > MAX_RELEASE_ENTRY_BYTES) {
        throw new Error(`Archive entry exceeds the release size limit: ${input.path}`)
      }
      const entry: PreparedEntry = {
        path: input.path,
        data: input.data,
        name,
        crc32: crc32(input.data),
        compressedSize: input.data.byteLength,
        uncompressedSize: input.data.byteLength,
        mode: REGULAR_FILE_MODE,
        dosDate: date,
        dosTime: time,
        localOffset
      }
      localOffset += 30 + name.byteLength + input.data.byteLength
      assertZip32Size(localOffset, 'Archive local data')
      return entry
    })
}

function localHeader(entry: PreparedEntry): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0)
  header.writeUInt16LE(ZIP_VERSION_NEEDED, 4)
  header.writeUInt16LE(UTF8_FILE_NAME_FLAG, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(entry.dosTime, 10)
  header.writeUInt16LE(entry.dosDate, 12)
  header.writeUInt32LE(entry.crc32, 14)
  header.writeUInt32LE(entry.compressedSize, 18)
  header.writeUInt32LE(entry.uncompressedSize, 22)
  header.writeUInt16LE(entry.name.byteLength, 26)
  header.writeUInt16LE(0, 28)
  return header
}

function centralHeader(entry: PreparedEntry): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER_SIGNATURE, 0)
  header.writeUInt16LE(ZIP_VERSION_MADE_BY_UNIX, 4)
  header.writeUInt16LE(ZIP_VERSION_NEEDED, 6)
  header.writeUInt16LE(UTF8_FILE_NAME_FLAG, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(entry.dosTime, 12)
  header.writeUInt16LE(entry.dosDate, 14)
  header.writeUInt32LE(entry.crc32, 16)
  header.writeUInt32LE(entry.compressedSize, 20)
  header.writeUInt32LE(entry.uncompressedSize, 24)
  header.writeUInt16LE(entry.name.byteLength, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE((entry.mode << 16) >>> 0, 38)
  header.writeUInt32LE(entry.localOffset, 42)
  return header
}

export function createDeterministicZip(
  inputs: readonly ArchiveInput[],
  sourceDateEpoch: number
): Buffer {
  const entries = prepareEntries(inputs, sourceDateEpoch)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  for (const entry of entries) {
    localParts.push(localHeader(entry), entry.name, Buffer.from(entry.data))
    centralParts.push(centralHeader(entry), entry.name)
  }
  const localSize = localParts.reduce((total, part) => total + part.byteLength, 0)
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0)
  assertZip32Size(localSize, 'Archive local data')
  assertZip32Size(centralSize, 'Archive central directory')
  if (localSize + centralSize + 22 > MAX_RELEASE_ARCHIVE_BYTES) {
    throw new Error('Archive exceeds the release size limit')
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(localSize, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const minimumOffset = Math.max(0, zip.byteLength - (MAX_UINT16 + 22))
  for (let offset = zip.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  throw new Error('ZIP end-of-central-directory record is missing')
}

function assertBufferRange(buffer: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.byteLength) {
    throw new Error(`${label} exceeds archive bounds`)
  }
}

export function readZipEntries(value: Uint8Array): ArchiveEntry[] {
  const zip = Buffer.from(value)
  if (zip.byteLength > MAX_RELEASE_ARCHIVE_BYTES) {
    throw new Error('ZIP exceeds the release size limit')
  }
  const endOffset = findEndOfCentralDirectory(zip)
  const diskNumber = zip.readUInt16LE(endOffset + 4)
  const centralDirectoryDisk = zip.readUInt16LE(endOffset + 6)
  const entriesOnDisk = zip.readUInt16LE(endOffset + 8)
  const entryCount = zip.readUInt16LE(endOffset + 10)
  const centralSize = zip.readUInt32LE(endOffset + 12)
  const centralOffset = zip.readUInt32LE(endOffset + 16)
  const commentLength = zip.readUInt16LE(endOffset + 20)
  if (commentLength !== 0 || endOffset + 22 !== zip.byteLength) {
    throw new Error('ZIP comments and trailing bytes are forbidden')
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Multi-disk ZIP archives are forbidden')
  }
  if (entryCount > MAX_RELEASE_ARCHIVE_ENTRIES) {
    throw new Error(`ZIP contains more than ${MAX_RELEASE_ARCHIVE_ENTRIES} files`)
  }
  assertBufferRange(zip, centralOffset, centralSize, 'Central directory')
  if (centralOffset + centralSize !== endOffset) {
    throw new Error('Central directory must immediately precede the end record')
  }

  const entries: ArchiveEntry[] = []
  const seenPaths = new Set<string>()
  const seenAncestors = new Set<string>()
  const seenAliases = new Set<string>()
  const seenAliasAncestors = new Set<string>()
  let expectedLocalOffset = 0
  let previousPath: string | undefined
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    assertBufferRange(zip, offset, 46, 'Central directory header')
    if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      throw new Error('Invalid central directory signature')
    }
    const versionMadeBy = zip.readUInt16LE(offset + 4)
    const versionNeeded = zip.readUInt16LE(offset + 6)
    const flags = zip.readUInt16LE(offset + 8)
    const compression = zip.readUInt16LE(offset + 10)
    const dosTime = zip.readUInt16LE(offset + 12)
    const dosDate = zip.readUInt16LE(offset + 14)
    const expectedCrc = zip.readUInt32LE(offset + 16)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const uncompressedSize = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const entryCommentLength = zip.readUInt16LE(offset + 32)
    const diskStart = zip.readUInt16LE(offset + 34)
    const internalAttributes = zip.readUInt16LE(offset + 36)
    const externalAttributes = zip.readUInt32LE(offset + 38)
    const localOffset = zip.readUInt32LE(offset + 42)
    if (versionMadeBy !== ZIP_VERSION_MADE_BY_UNIX || versionNeeded !== ZIP_VERSION_NEEDED) {
      throw new Error('ZIP entry version metadata is not canonical')
    }
    if (flags !== UTF8_FILE_NAME_FLAG) {
      throw new Error('ZIP entries must use only the UTF-8 file-name flag')
    }
    if (
      compression !== 0 ||
      extraLength !== 0 ||
      entryCommentLength !== 0 ||
      diskStart !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== (REGULAR_FILE_MODE << 16) >>> 0
    ) {
      throw new Error('ZIP entries must be stored without extras or comments')
    }
    assertBufferRange(zip, offset + 46, nameLength, 'Central directory file name')
    const centralName = Buffer.from(zip.subarray(offset + 46, offset + 46 + nameLength))
    const entryPath = decodeArchivePath(centralName)
    assertUniqueArchivePath(entryPath, seenPaths, seenAncestors, seenAliases, seenAliasAncestors)
    if (previousPath !== undefined && previousPath.localeCompare(entryPath, 'en') >= 0) {
      throw new Error('ZIP central directory paths must use canonical order')
    }
    previousPath = entryPath
    if (localOffset !== expectedLocalOffset) {
      throw new Error(`ZIP local entry order or layout differs for ${entryPath}`)
    }

    assertBufferRange(zip, localOffset, 30, `Local header for ${entryPath}`)
    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Invalid local header for ${entryPath}`)
    }
    const localVersionNeeded = zip.readUInt16LE(localOffset + 4)
    const localFlags = zip.readUInt16LE(localOffset + 6)
    const localCompression = zip.readUInt16LE(localOffset + 8)
    const localTime = zip.readUInt16LE(localOffset + 10)
    const localDate = zip.readUInt16LE(localOffset + 12)
    const localCrc = zip.readUInt32LE(localOffset + 14)
    const localCompressedSize = zip.readUInt32LE(localOffset + 18)
    const localUncompressedSize = zip.readUInt32LE(localOffset + 22)
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    if (
      localFlags !== flags ||
      localVersionNeeded !== versionNeeded ||
      localCompression !== compression ||
      localTime !== dosTime ||
      localDate !== dosDate ||
      localCrc !== expectedCrc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localExtraLength !== 0 ||
      localNameLength !== nameLength
    ) {
      throw new Error(`Local header metadata differs for ${entryPath}`)
    }
    const dataOffset = localOffset + 30 + localNameLength
    assertBufferRange(zip, dataOffset, compressedSize, `Entry data for ${entryPath}`)
    const dataEnd = dataOffset + compressedSize
    if (dataEnd > centralOffset)
      throw new Error(`Entry data overlaps central directory: ${entryPath}`)
    if (compressedSize > MAX_RELEASE_ENTRY_BYTES || uncompressedSize > MAX_RELEASE_ENTRY_BYTES) {
      throw new Error(`ZIP entry exceeds the release size limit: ${entryPath}`)
    }
    expectedLocalOffset = dataEnd
    const data = Buffer.from(zip.subarray(dataOffset, dataOffset + compressedSize))
    if (compressedSize !== uncompressedSize || crc32(data) !== expectedCrc) {
      throw new Error(`CRC or size mismatch for ${entryPath}`)
    }
    const localName = zip.subarray(localOffset + 30, dataOffset)
    if (!Buffer.from(localName).equals(centralName)) {
      throw new Error(`Local and central names differ for ${entryPath}`)
    }

    entries.push({
      path: entryPath,
      data,
      crc32: expectedCrc,
      compressedSize,
      uncompressedSize,
      mode: externalAttributes >>> 16,
      dosDate,
      dosTime
    })
    offset += 46 + nameLength
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('Central directory size does not match its entries')
  }
  if (expectedLocalOffset !== centralOffset) {
    throw new Error('ZIP local entries must exactly fill the local data region')
  }
  return entries
}

async function collectDirectory(
  root: string,
  current: string,
  files: ArchiveInput[]
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    if (entry.name.startsWith('.'))
      throw new Error(`Hidden release file is forbidden: ${entry.name}`)
    const absolutePath = path.join(current, entry.name)
    const metadata = await lstat(absolutePath)
    if (metadata.isSymbolicLink()) throw new Error(`Release symlink is forbidden: ${absolutePath}`)
    if (metadata.isDirectory()) {
      await collectDirectory(root, absolutePath, files)
      continue
    }
    if (!metadata.isFile()) throw new Error(`Unsupported release entry: ${absolutePath}`)
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
    if (relativePath.endsWith('.map')) throw new Error(`Source map is forbidden: ${relativePath}`)
    files.push({ path: relativePath, data: await readFile(absolutePath) })
  }
}

export async function createZipFromDirectory(
  inputDirectory: string,
  outputFile: string,
  sourceDateEpoch: number
): Promise<ArchiveEntry[]> {
  const inputMetadata = await lstat(inputDirectory)
  if (inputMetadata.isSymbolicLink() || !inputMetadata.isDirectory()) {
    throw new Error(`Release input must be a plain directory: ${inputDirectory}`)
  }
  const files: ArchiveInput[] = []
  await collectDirectory(path.resolve(inputDirectory), path.resolve(inputDirectory), files)
  const zip = createDeterministicZip(files, sourceDateEpoch)
  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, zip)
  return readZipEntries(zip)
}
