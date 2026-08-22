import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ReleaseProfile } from '../../src/release'
import { createCompatibilityReport, createCompatibilityReportHtml } from '../compatibility-report'
import {
  assertRuntimeLicensePolicy,
  collectRuntimeDependencyGraph,
  createSpdxDocument,
  createThirdPartyLicenseReport
} from './dependency-evidence'
import { RELEASE_GATE_IDS } from './evidence'
import { sha256, sha256File } from './hash'
import {
  assertReleaseToolchain,
  readWebExtensionPackage,
  RELEASE_TOOLCHAIN
} from './package-metadata'
import { stableJson } from './stable-json'

export const RELEASE_EVIDENCE_FILES = [
  'compatibility-report.html',
  'provenance.json',
  'sbom.spdx.json',
  'test-summary.json',
  'third-party-licenses.txt'
] as const

const GATE_STATUSES = ['passed', 'failed', 'not-run', 'external-pending'] as const

export type VerifiedReleaseMetadata = Readonly<{
  commitSha: string
  lockfileSha256: string
  sourceDate: string
  sourceDateEpoch: number
  sourceTreeClean: boolean
  gates: readonly Record<string, unknown>[]
}>

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseSourceDateEpoch(value: string): number {
  const milliseconds = Date.parse(value)
  const epoch = milliseconds / 1_000
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds % 1_000 !== 0 ||
    !Number.isSafeInteger(epoch) ||
    epoch < 0 ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error('release manifest build.sourceDate is invalid')
  }
  return epoch
}

function parseGates(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== RELEASE_GATE_IDS.length) {
    throw new Error('release gates must contain every canonical gate exactly once')
  }
  return value.map((entry, index) => {
    const gate = asRecord(entry, 'release gate')
    const expectedId = RELEASE_GATE_IDS[index]
    if (
      gate['id'] !== expectedId ||
      !GATE_STATUSES.includes(gate['status'] as (typeof GATE_STATUSES)[number]) ||
      typeof gate['evidence'] !== 'string' ||
      gate['evidence'].length === 0
    ) {
      throw new Error(`release gate is invalid or out of order: ${String(expectedId)}`)
    }
    return gate
  })
}

async function readJsonRecord(filePath: string, label: string): Promise<Record<string, unknown>> {
  return asRecord(JSON.parse(await readFile(filePath, 'utf8')) as unknown, label)
}

export function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`)
  }
}

async function verifyEvidenceMetadata(value: unknown, outputDirectory: string): Promise<void> {
  if (!Array.isArray(value) || value.length !== RELEASE_EVIDENCE_FILES.length) {
    throw new Error('release manifest evidenceFiles is incomplete')
  }
  const actualFiles: string[] = []
  const seenFiles = new Set<string>()
  for (const entryValue of value) {
    const entry = asRecord(entryValue, 'release evidence file')
    if (
      typeof entry['file'] !== 'string' ||
      typeof entry['size'] !== 'number' ||
      !Number.isSafeInteger(entry['size']) ||
      entry['size'] < 0
    ) {
      throw new Error('release evidence file metadata is incomplete')
    }
    if (
      !RELEASE_EVIDENCE_FILES.includes(entry['file'] as (typeof RELEASE_EVIDENCE_FILES)[number]) ||
      seenFiles.has(entry['file'])
    ) {
      throw new Error(`release evidence file is not canonical or is duplicated: ${entry['file']}`)
    }
    seenFiles.add(entry['file'])
    assertSha256(entry['sha256'], `release evidence ${entry['file']}`)
    const content = await readFile(path.join(outputDirectory, entry['file']))
    if (content.byteLength !== entry['size'] || sha256(content) !== entry['sha256']) {
      throw new Error(`release evidence metadata digest mismatch: ${entry['file']}`)
    }
    actualFiles.push(entry['file'])
  }
  if (actualFiles.sort().join('\n') !== [...RELEASE_EVIDENCE_FILES].sort().join('\n')) {
    throw new Error('release manifest evidenceFiles differs from the canonical evidence set')
  }
}

export function assertReleaseMetadata(
  releaseManifest: Record<string, unknown>
): VerifiedReleaseMetadata {
  const build = asRecord(releaseManifest['build'], 'release manifest build')
  const commitSha = build['commitSha']
  const lockfileSha256 = build['lockfileSha256']
  const sourceDate = build['sourceDate']
  if (typeof commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error('release manifest build.commitSha is invalid')
  }
  assertSha256(lockfileSha256, 'release manifest lockfileSha256')
  if (
    typeof sourceDate !== 'string' ||
    typeof build['sourceTreeClean'] !== 'boolean' ||
    build['node'] !== RELEASE_TOOLCHAIN.node ||
    build['packageManager'] !== RELEASE_TOOLCHAIN.packageManager ||
    build['wxt'] !== RELEASE_TOOLCHAIN.wxt
  ) {
    throw new Error('release manifest build metadata is incomplete')
  }
  const permissions = asRecord(releaseManifest['permissions'], 'release manifest permissions')
  if (
    stableJson(permissions) !==
    stableJson({
      optional: [],
      required: ['activeTab', 'scripting', 'storage'],
      optionalHosts: ['<all_urls>'],
      requiredHosts: []
    })
  ) {
    throw new Error('release manifest permission summary is invalid')
  }
  if (stableJson(releaseManifest['browsers']) !== stableJson(['chrome', 'firefox'])) {
    throw new Error('release manifest browser list is invalid')
  }
  const compatibility = asRecord(releaseManifest['compatibility'], 'release manifest compatibility')
  if (
    compatibility['evidenceBoundary'] !== 'sanitized-fixture-only' ||
    compatibility['liveSmoke'] !== 'not-verified' ||
    typeof compatibility['adapterCount'] !== 'number' ||
    !Number.isSafeInteger(compatibility['adapterCount']) ||
    compatibility['adapterCount'] < 0
  ) {
    throw new Error('release manifest compatibility boundary is invalid')
  }
  if (
    releaseManifest['releaseDecisionBoundary'] !==
    'Artifact generation does not constitute Beta distribution, store approval, or Stable Go.'
  ) {
    throw new Error('release manifest decision boundary is missing')
  }
  return {
    commitSha,
    lockfileSha256,
    sourceDate,
    sourceDateEpoch: parseSourceDateEpoch(sourceDate),
    sourceTreeClean: build['sourceTreeClean'],
    gates: parseGates(releaseManifest['gates'])
  }
}

export async function verifyEvidenceContracts(
  outputDirectory: string,
  releaseManifest: Record<string, unknown>,
  profile: ReleaseProfile,
  metadata: VerifiedReleaseMetadata,
  artifacts: readonly Readonly<{ file: string; sha256: string }>[],
  sourceDirectory = process.cwd()
): Promise<void> {
  await verifyEvidenceMetadata(releaseManifest['evidenceFiles'], outputDirectory)

  const testSummary = await readJsonRecord(
    path.join(outputDirectory, 'test-summary.json'),
    'test summary'
  )
  const summaryGates = parseGates(testSummary['gates'])
  const stableEligible =
    profile.channel === 'stable' &&
    metadata.sourceTreeClean &&
    summaryGates.every((gate) => gate['status'] === 'passed')
  if (
    testSummary['schemaVersion'] !== 1 ||
    testSummary['candidate'] !== profile.releaseVersion ||
    testSummary['channel'] !== profile.channel ||
    testSummary['commitSha'] !== metadata.commitSha ||
    testSummary['generatedAt'] !== metadata.sourceDate ||
    testSummary['evidenceBoundary'] !==
      'Gate values are packaging inputs. Stable approval requires linked CI, manual, store, and two-candidate records.' ||
    testSummary['stableEligible'] !== stableEligible ||
    testSummary['stableDecision'] !== (stableEligible ? 'review-required' : 'NO-GO') ||
    stableJson(summaryGates) !== stableJson(metadata.gates)
  ) {
    throw new Error('test summary differs from release manifest or gate policy')
  }

  const compatibilityReport = await createCompatibilityReport(
    metadata.sourceDateEpoch * 1_000,
    sourceDirectory
  )
  const expectedCompatibilityMetadata = {
    adapterCount: compatibilityReport.entries.length,
    evidenceBoundary: compatibilityReport.evidenceBoundary,
    liveSmoke: compatibilityReport.liveSmoke
  }
  if (stableJson(releaseManifest['compatibility']) !== stableJson(expectedCompatibilityMetadata)) {
    throw new Error('release manifest compatibility metadata differs from the adapter baseline')
  }
  const compatibilityHtml = await readFile(
    path.join(outputDirectory, 'compatibility-report.html'),
    'utf8'
  )
  if (compatibilityHtml !== createCompatibilityReportHtml(compatibilityReport)) {
    throw new Error('compatibility report differs from the adapter baseline and evidence boundary')
  }

  const packageMetadata = await readWebExtensionPackage(sourceDirectory)
  assertReleaseToolchain(packageMetadata)
  if (packageMetadata.version !== profile.packageVersion) {
    throw new Error('SPDX package version differs from the release profile')
  }
  const currentLockfileSha256 = await sha256File(path.join(sourceDirectory, 'pnpm-lock.yaml'))
  if (currentLockfileSha256 !== metadata.lockfileSha256) {
    throw new Error('Release bundle lockfile digest differs from the verification checkout')
  }
  const graph = await collectRuntimeDependencyGraph(packageMetadata, sourceDirectory)
  assertRuntimeLicensePolicy(graph)
  const sbom = await readJsonRecord(path.join(outputDirectory, 'sbom.spdx.json'), 'SPDX SBOM')
  const expectedSbom = createSpdxDocument({
    packageMetadata,
    profile,
    graph,
    sourceDateIso: metadata.sourceDate,
    lockfileSha256: metadata.lockfileSha256
  })
  if (stableJson(sbom) !== stableJson(expectedSbom)) {
    throw new Error('SPDX SBOM dependency closure differs from the verification checkout')
  }
  const licenseReport = await readFile(
    path.join(outputDirectory, 'third-party-licenses.txt'),
    'utf8'
  )
  if (licenseReport !== createThirdPartyLicenseReport(graph)) {
    throw new Error('third-party license inventory differs from the runtime dependency closure')
  }

  const provenance = await readJsonRecord(
    path.join(outputDirectory, 'provenance.json'),
    'provenance statement'
  )
  const predicate = asRecord(provenance['predicate'], 'provenance predicate')
  const provenanceTrust = asRecord(provenance['provenanceTrust'], 'provenance trust boundary')
  const buildDefinition = asRecord(predicate['buildDefinition'], 'provenance build definition')
  const externalParameters = asRecord(
    buildDefinition['externalParameters'],
    'provenance external parameters'
  )
  const internalParameters = asRecord(
    buildDefinition['internalParameters'],
    'provenance internal parameters'
  )
  const dependencies = buildDefinition['resolvedDependencies']
  const subjects = provenance['subject']
  const runDetails = asRecord(predicate['runDetails'], 'provenance run details')
  const builder = asRecord(runDetails['builder'], 'provenance builder')
  const runMetadata = asRecord(runDetails['metadata'], 'provenance run metadata')
  const hasSourceDependency =
    Array.isArray(dependencies) &&
    dependencies.some((entry) => {
      const dependency = asRecord(entry, 'provenance dependency')
      const digest = asRecord(dependency['digest'], 'provenance dependency digest')
      return (
        dependency['uri'] === 'git+https://github.com/xxxily/h5player.git' &&
        digest['gitCommit'] === metadata.commitSha
      )
    })
  const hasLockfileDependency =
    Array.isArray(dependencies) &&
    dependencies.some((entry) => {
      const dependency = asRecord(entry, 'provenance dependency')
      const digest = asRecord(dependency['digest'], 'provenance dependency digest')
      return (
        dependency['uri'] === 'file:web-extension/pnpm-lock.yaml' &&
        digest['sha256'] === metadata.lockfileSha256
      )
    })
  if (
    provenance['_type'] !== 'https://in-toto.io/Statement/v1' ||
    provenance['predicateType'] !== 'https://slsa.dev/provenance/v1' ||
    provenanceTrust['signed'] !== false ||
    provenanceTrust['status'] !== 'unsigned' ||
    provenanceTrust['boundary'] !==
      'Repository-generated metadata only; protected CI identity and store signatures are external release evidence.' ||
    buildDefinition['buildType'] !==
      'https://github.com/xxxily/h5player/web-extension/release-bundle/v1' ||
    externalParameters['channel'] !== profile.channel ||
    externalParameters['releaseVersion'] !== profile.releaseVersion ||
    externalParameters['sequence'] !== profile.sequence ||
    externalParameters['sourceDate'] !== metadata.sourceDate ||
    internalParameters['sourceTreeClean'] !== metadata.sourceTreeClean ||
    !hasSourceDependency ||
    !hasLockfileDependency ||
    typeof builder['id'] !== 'string' ||
    builder['id'].length === 0 ||
    runMetadata['startedOn'] !== undefined ||
    runMetadata['finishedOn'] !== undefined ||
    runMetadata['invocationId'] !== `${metadata.commitSha}:${profile.releaseVersion}` ||
    !Array.isArray(subjects) ||
    stableJson(
      subjects.map((entry) => {
        const subject = asRecord(entry, 'provenance subject')
        const digest = asRecord(subject['digest'], 'provenance subject digest')
        return { file: subject['name'], sha256: digest['sha256'] }
      })
    ) !== stableJson(artifacts)
  ) {
    throw new Error('provenance statement differs from release metadata')
  }
}
