import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { artifactFileName, resolveReleaseProfile, type ReleaseProfile } from '../../src/release'
import { createCompatibilityReport, createCompatibilityReportHtml } from '../compatibility-report'
import { createZipFromDirectory } from './archive'
import {
  inspectExtensionArchive,
  type ArtifactInspection,
  type ReleaseBrowser
} from './artifact-inspection'
import { captureCommand, runCommand } from './command'
import {
  collectRuntimeDependencyGraph,
  assertRuntimeLicensePolicy,
  createSpdxDocument,
  createThirdPartyLicenseReport
} from './dependency-evidence'
import {
  createGateResults,
  createProvenance,
  createReleaseManifest,
  createTestSummary,
  type ArtifactEvidence,
  type ReleaseGateResult
} from './evidence'
import { sha256, sha256File } from './hash'
import { assertReleaseToolchain, readWebExtensionPackage } from './package-metadata'
import { stableJson } from './stable-json'

export type ReleaseBundleOptions = Readonly<{
  cwd: string
  channel: string
  sequence: number
  sourceDateEpoch: number
  outputDirectory: string
  allowDirty: boolean
  gateOverrides: readonly ReleaseGateResult[]
}>

export type ReleaseBundleResult = Readonly<{
  outputDirectory: string
  profile: ReleaseProfile
  commitSha: string
  sourceTreeClean: boolean
  artifacts: readonly ArtifactEvidence[]
  files: readonly string[]
}>

const OUTPUTS: readonly Readonly<{
  browser: ReleaseBrowser
  outputDirectory: string
}>[] = [
  { browser: 'chrome', outputDirectory: '.output/chrome-mv3' },
  { browser: 'firefox', outputDirectory: '.output/firefox-mv3' }
]

function assertSourceDateEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer')
  }
}

function assertSafeOutputDirectory(cwd: string, outputDirectory: string): string {
  const resolvedCwd = path.resolve(cwd)
  const resolvedOutput = path.resolve(cwd, outputDirectory)
  const relative = path.relative(resolvedCwd, resolvedOutput)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Release output directory must be a child of web-extension/')
  }
  const firstSegment = relative.split(path.sep)[0]
  if (firstSegment !== '.release') {
    throw new Error('Release output directory must be under web-extension/.release/')
  }
  return resolvedOutput
}

async function optionalMetadata(
  filePath: string
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function ensurePlainDirectory(directory: string): Promise<void> {
  const existing = await optionalMetadata(directory)
  if (existing === null) {
    await mkdir(directory)
    return
  }
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error(`Release path component must be a plain directory: ${directory}`)
  }
}

async function assertPlainDirectoryIfPresent(directory: string): Promise<void> {
  const existing = await optionalMetadata(directory)
  if (existing === null) return
  if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error(`Release path component must be a plain directory: ${directory}`)
  }
}

async function assertPlainDirectory(directory: string): Promise<void> {
  const existing = await optionalMetadata(directory)
  if (existing === null || existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error(`Release path component must be an existing plain directory: ${directory}`)
  }
}

export async function prepareReleaseOutputDirectory(
  cwd: string,
  outputDirectory: string
): Promise<string> {
  const resolvedOutput = assertSafeOutputDirectory(cwd, outputDirectory)
  const releaseRoot = path.resolve(cwd, '.release')
  const relativeToRoot = path.relative(releaseRoot, resolvedOutput)
  if (relativeToRoot === '' || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Release output must be a child directory of web-extension/.release/')
  }

  await ensurePlainDirectory(releaseRoot)
  const parentSegments = relativeToRoot.split(path.sep).slice(0, -1)
  let current = releaseRoot
  for (const segment of parentSegments) {
    current = path.join(current, segment)
    await ensurePlainDirectory(current)
  }

  const existingOutput = await optionalMetadata(resolvedOutput)
  if (
    existingOutput !== null &&
    (existingOutput.isSymbolicLink() || !existingOutput.isDirectory())
  ) {
    throw new Error(`Release output must be a plain directory when it exists: ${resolvedOutput}`)
  }
  return resolvedOutput
}

function sourceDateIso(sourceDateEpoch: number): string {
  const value = new Date(sourceDateEpoch * 1_000)
  if (!Number.isFinite(value.getTime())) throw new Error('SOURCE_DATE_EPOCH is out of range')
  return value.toISOString()
}

async function gitState(cwd: string): Promise<Readonly<{ commitSha: string; clean: boolean }>> {
  const [commitSha, status] = await Promise.all([
    captureCommand('git', ['rev-parse', 'HEAD'], cwd),
    captureCommand('git', ['status', '--porcelain', '--untracked-files=normal'], cwd)
  ])
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Cannot resolve a full Git commit SHA')
  return { commitSha, clean: status.length === 0 }
}

function buildEnvironment(
  profile: ReleaseProfile,
  commitSha: string,
  sourceDateEpoch: number
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: '1',
    H5PLAYER_RELEASE_CHANNEL: profile.channel,
    H5PLAYER_RELEASE_SEQUENCE: String(profile.sequence),
    NO_UPDATE_NOTIFIER: '1',
    SOURCE_DATE_EPOCH: String(sourceDateEpoch),
    VITE_BUILD_SHA: commitSha
  }
}

async function buildOutputs(
  cwd: string,
  profile: ReleaseProfile,
  commitSha: string,
  sourceDateEpoch: number
): Promise<void> {
  const environment = buildEnvironment(profile, commitSha, sourceDateEpoch)
  await assertPlainDirectoryIfPresent(path.join(cwd, '.output'))
  for (const output of OUTPUTS) {
    const outputPath = path.join(cwd, output.outputDirectory)
    await assertPlainDirectoryIfPresent(outputPath)
    await rm(outputPath, { recursive: true, force: true })
    await runCommand(
      'corepack',
      ['pnpm@11.21.0', 'exec', 'wxt', 'build', '-b', output.browser],
      cwd,
      environment
    )
    await assertPlainDirectory(outputPath)
  }
}

function releaseBuilderId(): string {
  const repository = process.env['GITHUB_REPOSITORY']
  const runId = process.env['GITHUB_RUN_ID']
  if (repository && runId) return `https://github.com/${repository}/actions/runs/${runId}`
  return 'local://h5player-webext-release'
}

async function writeStableJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, stableJson(value), 'utf8')
}

async function fileEvidence(
  outputDirectory: string,
  files: readonly string[]
): Promise<Readonly<{ file: string; sha256: string; size: number }>[]> {
  return Promise.all(
    [...files].sort().map(async (file) => {
      const content = await readFile(path.join(outputDirectory, file))
      return Object.freeze({ file, sha256: sha256(content), size: content.byteLength })
    })
  )
}

function assertInspection(inspection: ArtifactInspection, file: string): void {
  if (inspection.passed) return
  const details = inspection.violations
    .map((violation) => `${violation.code}:${violation.path}:${violation.message}`)
    .join('; ')
  throw new Error(`Release artifact inspection failed for ${file}: ${details}`)
}

export async function createReleaseBundle(
  options: ReleaseBundleOptions
): Promise<ReleaseBundleResult> {
  assertSourceDateEpoch(options.sourceDateEpoch)
  const cwd = path.resolve(options.cwd)
  const outputDirectory = await prepareReleaseOutputDirectory(cwd, options.outputDirectory)
  const packageMetadata = await readWebExtensionPackage(cwd)
  assertReleaseToolchain(packageMetadata)
  const profile = resolveReleaseProfile({
    packageVersion: packageMetadata.version,
    channel: options.channel,
    sequence: options.sequence
  })
  const source = await gitState(cwd)
  if (!source.clean && !options.allowDirty) {
    throw new Error('Release bundles require a clean Git worktree; --allow-dirty is local-only')
  }

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  await buildOutputs(cwd, profile, source.commitSha, options.sourceDateEpoch)

  const artifacts: ArtifactEvidence[] = []
  for (const output of OUTPUTS) {
    const file = artifactFileName(profile, output.browser)
    const artifactPath = path.join(outputDirectory, file)
    await createZipFromDirectory(
      path.join(cwd, output.outputDirectory),
      artifactPath,
      options.sourceDateEpoch
    )
    const zip = await readFile(artifactPath)
    const inspection = inspectExtensionArchive({
      zip,
      browser: output.browser,
      profile,
      sourceDateEpoch: options.sourceDateEpoch
    })
    assertInspection(inspection, file)
    artifacts.push(
      Object.freeze({
        browser: output.browser,
        file,
        sha256: sha256(zip),
        size: zip.byteLength,
        inspection
      })
    )
  }

  const generatedAt = sourceDateIso(options.sourceDateEpoch)
  const lockfilePath = path.join(cwd, 'pnpm-lock.yaml')
  const lockfileSha256 = await sha256File(lockfilePath)
  const compatibility = await createCompatibilityReport(options.sourceDateEpoch * 1_000, cwd)
  const missingFixtures = compatibility.entries.filter((entry) => !entry.fixturePresent)
  if (missingFixtures.length > 0) {
    throw new Error(
      `Compatibility fixtures missing: ${missingFixtures.map((entry) => entry.id).join(', ')}`
    )
  }
  const graph = await collectRuntimeDependencyGraph(packageMetadata, cwd)
  assertRuntimeLicensePolicy(graph)
  const gates = createGateResults(options.gateOverrides)
  const evidenceContents = new Map<string, string>()
  evidenceContents.set(
    'sbom.spdx.json',
    stableJson(
      createSpdxDocument({
        packageMetadata,
        profile,
        graph,
        sourceDateIso: generatedAt,
        lockfileSha256
      })
    )
  )
  evidenceContents.set('third-party-licenses.txt', createThirdPartyLicenseReport(graph))
  evidenceContents.set(
    'test-summary.json',
    stableJson(
      createTestSummary({
        profile,
        sourceDateIso: generatedAt,
        commitSha: source.commitSha,
        sourceTreeClean: source.clean,
        gates
      })
    )
  )
  evidenceContents.set('compatibility-report.html', createCompatibilityReportHtml(compatibility))
  evidenceContents.set(
    'provenance.json',
    stableJson(
      createProvenance({
        profile,
        sourceDateIso: generatedAt,
        commitSha: source.commitSha,
        lockfileSha256,
        artifacts,
        builderId: releaseBuilderId(),
        sourceTreeClean: source.clean
      })
    )
  )
  for (const [file, content] of evidenceContents) {
    await writeFile(path.join(outputDirectory, file), content, 'utf8')
  }

  const preliminaryEvidence = await fileEvidence(outputDirectory, [...evidenceContents.keys()])
  await writeStableJson(
    path.join(outputDirectory, 'release-manifest.json'),
    createReleaseManifest({
      profile,
      sourceDateIso: generatedAt,
      commitSha: source.commitSha,
      sourceTreeClean: source.clean,
      nodeVersion: process.version,
      packageManager: packageMetadata.packageManager,
      wxtVersion: packageMetadata.devDependencies['wxt'] ?? 'NOASSERTION',
      lockfileSha256,
      artifacts,
      evidenceFiles: preliminaryEvidence,
      compatibility,
      gates
    })
  )

  const checksumFiles = [
    ...artifacts.map((artifact) => artifact.file),
    ...evidenceContents.keys(),
    'release-manifest.json'
  ]
  const checksums = await fileEvidence(outputDirectory, checksumFiles)
  await writeFile(
    path.join(outputDirectory, 'checksums.txt'),
    `${checksums.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
    'utf8'
  )

  return Object.freeze({
    outputDirectory,
    profile,
    commitSha: source.commitSha,
    sourceTreeClean: source.clean,
    artifacts: Object.freeze(artifacts),
    files: Object.freeze([...checksumFiles, 'checksums.txt'].sort())
  })
}
