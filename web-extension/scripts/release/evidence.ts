import type { CompatibilityReport } from '../compatibility-report'
import type { ArtifactInspection, ReleaseBrowser } from './artifact-inspection'
import type { ReleaseProfile } from '../../src/release'

export const RELEASE_GATE_IDS = [
  'format-lint-typecheck',
  'unit-component-integration',
  'coverage',
  'compatibility-fixtures',
  'security-boundaries',
  'bundle-budget',
  'chromium-e2e',
  'firefox-e2e',
  'churn-30m',
  'legacy-baseline',
  'reproducibility',
  'artifact-install',
  'tier1-live-smoke',
  'browser-version-matrix',
  'headed-permissions',
  'store-signoff',
  'beta-observation'
] as const

export type ReleaseGateId = (typeof RELEASE_GATE_IDS)[number]
export type ReleaseGateStatus = 'passed' | 'failed' | 'not-run' | 'external-pending'

export type ReleaseGateResult = Readonly<{
  id: ReleaseGateId
  status: ReleaseGateStatus
  evidence: string
}>

export type ArtifactEvidence = Readonly<{
  browser: ReleaseBrowser
  file: string
  sha256: string
  size: number
  inspection: ArtifactInspection
}>

const EXTERNAL_GATES = new Set<ReleaseGateId>([
  'tier1-live-smoke',
  'browser-version-matrix',
  'headed-permissions',
  'store-signoff',
  'beta-observation'
])

const STABLE_REQUIRED_GATES = new Set<ReleaseGateId>(RELEASE_GATE_IDS)

export function parseGateResult(value: string): ReleaseGateResult {
  const separator = value.indexOf('=')
  if (separator <= 0) throw new Error(`Gate must use id=status: ${value}`)
  const id = value.slice(0, separator)
  const status = value.slice(separator + 1)
  if (!RELEASE_GATE_IDS.includes(id as ReleaseGateId)) throw new Error(`Unknown gate: ${id}`)
  if (!['passed', 'failed', 'not-run', 'external-pending'].includes(status)) {
    throw new Error(`Unknown gate status: ${status}`)
  }
  return Object.freeze({
    id: id as ReleaseGateId,
    status: status as ReleaseGateStatus,
    evidence: 'self-reported CLI result; verify against CI/manual record before approval'
  })
}

export function createGateResults(overrides: readonly ReleaseGateResult[]): ReleaseGateResult[] {
  const byId = new Map<ReleaseGateId, ReleaseGateResult>()
  for (const result of overrides) {
    if (byId.has(result.id)) throw new Error(`Duplicate release gate: ${result.id}`)
    byId.set(result.id, result)
  }
  return RELEASE_GATE_IDS.map(
    (id) =>
      byId.get(id) ??
      Object.freeze({
        id,
        status: EXTERNAL_GATES.has(id) ? 'external-pending' : 'not-run',
        evidence: EXTERNAL_GATES.has(id)
          ? 'requires real browser/site/store/Beta evidence outside the packager'
          : 'not supplied to the release packager'
      })
  )
}

export function createTestSummary(
  input: Readonly<{
    profile: ReleaseProfile
    sourceDateIso: string
    commitSha: string
    sourceTreeClean: boolean
    gates: readonly ReleaseGateResult[]
  }>
): Readonly<Record<string, unknown>> {
  const stableEligible =
    input.profile.channel === 'stable' &&
    input.sourceTreeClean &&
    input.gates.every((gate) => !STABLE_REQUIRED_GATES.has(gate.id) || gate.status === 'passed')
  return Object.freeze({
    schemaVersion: 1,
    candidate: input.profile.releaseVersion,
    channel: input.profile.channel,
    commitSha: input.commitSha,
    generatedAt: input.sourceDateIso,
    evidenceBoundary:
      'Gate values are packaging inputs. Stable approval requires linked CI, manual, store, and two-candidate records.',
    gates: input.gates,
    stableEligible,
    stableDecision: stableEligible ? 'review-required' : 'NO-GO'
  })
}

export function createProvenance(
  input: Readonly<{
    profile: ReleaseProfile
    sourceDateIso: string
    commitSha: string
    lockfileSha256: string
    artifacts: readonly ArtifactEvidence[]
    builderId: string
    sourceTreeClean: boolean
  }>
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    _type: 'https://in-toto.io/Statement/v1',
    predicateType: 'https://slsa.dev/provenance/v1',
    provenanceTrust: {
      signed: false,
      status: 'unsigned',
      boundary:
        'Repository-generated metadata only; protected CI identity and store signatures are external release evidence.'
    },
    subject: input.artifacts.map((artifact) => ({
      digest: { sha256: artifact.sha256 },
      name: artifact.file
    })),
    predicate: {
      buildDefinition: {
        buildType: 'https://github.com/xxxily/h5player/web-extension/release-bundle/v1',
        externalParameters: {
          channel: input.profile.channel,
          releaseVersion: input.profile.releaseVersion,
          sequence: input.profile.sequence,
          sourceDate: input.sourceDateIso
        },
        internalParameters: {
          sourceTreeClean: input.sourceTreeClean
        },
        resolvedDependencies: [
          {
            digest: { gitCommit: input.commitSha },
            uri: 'git+https://github.com/xxxily/h5player.git'
          },
          {
            digest: { sha256: input.lockfileSha256 },
            uri: 'file:web-extension/pnpm-lock.yaml'
          }
        ]
      },
      runDetails: {
        builder: { id: input.builderId },
        metadata: {
          invocationId: `${input.commitSha}:${input.profile.releaseVersion}`
        }
      }
    }
  })
}

export function createReleaseManifest(
  input: Readonly<{
    profile: ReleaseProfile
    sourceDateIso: string
    commitSha: string
    sourceTreeClean: boolean
    nodeVersion: string
    packageManager: string
    wxtVersion: string
    lockfileSha256: string
    artifacts: readonly ArtifactEvidence[]
    evidenceFiles: readonly Readonly<{ file: string; sha256: string; size: number }>[]
    compatibility: CompatibilityReport
    gates: readonly ReleaseGateResult[]
  }>
): Readonly<Record<string, unknown>> {
  const permissions = {
    optional: [],
    required: ['activeTab', 'scripting', 'storage'],
    optionalHosts: ['<all_urls>'],
    requiredHosts: []
  }
  return Object.freeze({
    schemaVersion: 1,
    artifacts: input.artifacts,
    browsers: input.artifacts.map((artifact) => artifact.browser),
    build: {
      commitSha: input.commitSha,
      lockfileSha256: input.lockfileSha256,
      node: input.nodeVersion,
      packageManager: input.packageManager,
      sourceDate: input.sourceDateIso,
      sourceTreeClean: input.sourceTreeClean,
      wxt: input.wxtVersion
    },
    compatibility: {
      adapterCount: input.compatibility.entries.length,
      evidenceBoundary: input.compatibility.evidenceBoundary,
      liveSmoke: input.compatibility.liveSmoke
    },
    evidenceFiles: input.evidenceFiles,
    gates: input.gates,
    permissions,
    profile: input.profile,
    releaseDecisionBoundary:
      'Artifact generation does not constitute Beta distribution, store approval, or Stable Go.'
  })
}
