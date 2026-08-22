import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { artifactFileName, resolveReleaseProfile, type ReleaseProfile } from '../../src/release'
import { inspectExtensionArchive, type ReleaseBrowser } from './artifact-inspection'
import {
  assertReleaseMetadata,
  assertSha256,
  RELEASE_EVIDENCE_FILES,
  verifyEvidenceContracts
} from './evidence-verification'
import { sha256 } from './hash'
import { stableJson } from './stable-json'

export type ReleaseBundleVerification = Readonly<{
  schemaVersion: 1
  outputDirectory: string
  checkedFiles: number
  passed: true
}>

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseProfile(value: unknown): ReleaseProfile {
  const record = asRecord(value, 'release manifest profile')
  if (
    typeof record['packageVersion'] !== 'string' ||
    typeof record['channel'] !== 'string' ||
    typeof record['sequence'] !== 'number'
  ) {
    throw new Error('release manifest profile is incomplete')
  }
  const expected = resolveReleaseProfile({
    packageVersion: record['packageVersion'],
    channel: record['channel'],
    sequence: record['sequence']
  })
  if (stableJson(record) !== stableJson(expected)) {
    throw new Error('release manifest profile does not match the version policy')
  }
  return expected
}

function parseChecksums(source: string): Map<string, string> {
  const checksums = new Map<string, string>()
  let previousFile: string | undefined
  for (const line of source.trimEnd().split('\n')) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line)
    if (!match || match[1] === undefined || match[2] === undefined) {
      throw new Error(`Invalid checksum line: ${line}`)
    }
    if (checksums.has(match[2])) throw new Error(`Duplicate checksum entry: ${match[2]}`)
    if (previousFile !== undefined && previousFile.localeCompare(match[2], 'en') >= 0) {
      throw new Error('Checksum entries must use canonical file-name order')
    }
    checksums.set(match[2], match[1])
    previousFile = match[2]
  }
  return checksums
}

function artifactBrowser(file: string): ReleaseBrowser {
  if (file.endsWith('-chrome.zip')) return 'chrome'
  if (file.endsWith('-firefox.zip')) return 'firefox'
  throw new Error(`Unknown release artifact target: ${file}`)
}

export async function verifyReleaseBundle(
  outputDirectory: string
): Promise<ReleaseBundleVerification> {
  const resolvedOutput = path.resolve(outputDirectory)
  const outputMetadata = await lstat(resolvedOutput)
  if (outputMetadata.isSymbolicLink() || !outputMetadata.isDirectory()) {
    throw new Error('Release bundle path must be a plain directory')
  }
  const directoryEntries = await readdir(resolvedOutput, { withFileTypes: true })
  for (const entry of directoryEntries) {
    const metadata = await lstat(path.join(resolvedOutput, entry.name))
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Release bundle may contain regular files only: ${entry.name}`)
    }
  }
  const actualFiles = directoryEntries.map((entry) => entry.name).sort()
  const checksumSource = await readFile(path.join(resolvedOutput, 'checksums.txt'), 'utf8')
  const checksums = parseChecksums(checksumSource)
  const expectedFiles = [...checksums.keys(), 'checksums.txt'].sort()
  if (actualFiles.join('\n') !== expectedFiles.join('\n')) {
    throw new Error('Release bundle files differ from checksums.txt')
  }
  for (const [file, expected] of checksums) {
    const actual = sha256(await readFile(path.join(resolvedOutput, file)))
    if (actual !== expected) throw new Error(`Checksum mismatch: ${file}`)
  }

  const releaseManifest = asRecord(
    JSON.parse(
      await readFile(path.join(resolvedOutput, 'release-manifest.json'), 'utf8')
    ) as unknown,
    'release manifest'
  )
  if (releaseManifest['schemaVersion'] !== 1) throw new Error('Unsupported release manifest schema')
  const profile = parseProfile(releaseManifest['profile'])
  const metadata = assertReleaseMetadata(releaseManifest)
  const canonicalFiles = [
    ...RELEASE_EVIDENCE_FILES,
    artifactFileName(profile, 'chrome'),
    artifactFileName(profile, 'firefox'),
    'checksums.txt',
    'release-manifest.json'
  ].sort()
  if (actualFiles.join('\n') !== canonicalFiles.join('\n')) {
    throw new Error('Release bundle differs from the canonical nine-file contract')
  }

  const artifacts = releaseManifest['artifacts']
  if (!Array.isArray(artifacts) || artifacts.length !== 2) {
    throw new Error('release manifest must contain two browser artifacts')
  }
  const browsers = new Set<ReleaseBrowser>()
  const artifactEvidence: { file: string; sha256: string }[] = []
  for (const artifactValue of artifacts) {
    const artifact = asRecord(artifactValue, 'release artifact')
    if (
      typeof artifact['file'] !== 'string' ||
      typeof artifact['sha256'] !== 'string' ||
      typeof artifact['size'] !== 'number'
    ) {
      throw new Error('release artifact metadata is incomplete')
    }
    assertSha256(artifact['sha256'], `release artifact ${artifact['file']}`)
    if (!Number.isSafeInteger(artifact['size']) || artifact['size'] <= 0) {
      throw new Error(`release artifact size is invalid: ${artifact['file']}`)
    }
    const browser = artifactBrowser(artifact['file'])
    if (artifact['file'] !== artifactFileName(profile, browser)) {
      throw new Error(`release artifact name does not match the profile: ${artifact['file']}`)
    }
    if (artifact['browser'] !== browser) {
      throw new Error(`release artifact browser metadata mismatch: ${artifact['file']}`)
    }
    if (browsers.has(browser)) throw new Error(`Duplicate release artifact browser: ${browser}`)
    browsers.add(browser)
    const zip = await readFile(path.join(resolvedOutput, artifact['file']))
    if (zip.byteLength !== artifact['size'] || sha256(zip) !== artifact['sha256']) {
      throw new Error(`release manifest artifact digest mismatch: ${artifact['file']}`)
    }
    const inspection = inspectExtensionArchive({
      zip,
      browser,
      profile,
      sourceDateEpoch: metadata.sourceDateEpoch
    })
    if (!inspection.passed) {
      throw new Error(`release artifact inspection failed: ${artifact['file']}`)
    }
    if (stableJson(artifact['inspection']) !== stableJson(inspection)) {
      throw new Error(`release manifest inspection evidence mismatch: ${artifact['file']}`)
    }
    artifactEvidence.push({ file: artifact['file'], sha256: artifact['sha256'] })
  }
  if (!browsers.has('chrome') || !browsers.has('firefox')) {
    throw new Error('release bundle must contain Chrome and Firefox artifacts')
  }
  await verifyEvidenceContracts(
    resolvedOutput,
    releaseManifest,
    profile,
    metadata,
    artifactEvidence
  )
  return Object.freeze({
    schemaVersion: 1,
    outputDirectory: resolvedOutput,
    checkedFiles: actualFiles.length,
    passed: true
  })
}
