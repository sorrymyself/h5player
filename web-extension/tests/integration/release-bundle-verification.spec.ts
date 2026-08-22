import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveReleaseProfile } from '../../src/release'
import {
  createCompatibilityReport,
  createCompatibilityReportHtml
} from '../../scripts/compatibility-report'
import { createDeterministicZip } from '../../scripts/release/archive'
import {
  collectRuntimeDependencyGraph,
  createSpdxDocument,
  createThirdPartyLicenseReport
} from '../../scripts/release/dependency-evidence'
import {
  inspectExtensionArchive,
  type ReleaseBrowser
} from '../../scripts/release/artifact-inspection'
import {
  createGateResults,
  createProvenance,
  createReleaseManifest,
  createTestSummary,
  type ArtifactEvidence
} from '../../scripts/release/evidence'
import { sha256, sha256File } from '../../scripts/release/hash'
import { readWebExtensionPackage } from '../../scripts/release/package-metadata'
import { stableJson } from '../../scripts/release/stable-json'
import { verifyReleaseBundle } from '../../scripts/release/verify-bundle'

const SOURCE_DATE_EPOCH = 1_787_011_200
const SOURCE_DATE_ISO = new Date(SOURCE_DATE_EPOCH * 1_000).toISOString()
const COMMIT_SHA = 'a'.repeat(40)

let dependencyEvidencePromise:
  | Promise<{
      packageMetadata: Awaited<ReturnType<typeof readWebExtensionPackage>>
      graph: Awaited<ReturnType<typeof collectRuntimeDependencyGraph>>
      lockfileSha256: string
    }>
  | undefined

function dependencyEvidence() {
  dependencyEvidencePromise ??= (async () => {
    const packageMetadata = await readWebExtensionPackage()
    const [graph, lockfileSha256] = await Promise.all([
      collectRuntimeDependencyGraph(packageMetadata),
      sha256File(path.resolve('pnpm-lock.yaml'))
    ])
    return { packageMetadata, graph, lockfileSha256 }
  })()
  return dependencyEvidencePromise
}

function extensionManifest(
  browser: ReleaseBrowser,
  profile: ReturnType<typeof resolveReleaseProfile>
) {
  return {
    manifest_version: 3,
    name: profile.manifestName,
    description: profile.manifestDescription,
    version: profile.manifestVersion,
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions: ['<all_urls>'],
    action: { default_popup: 'popup.html', default_title: 'H5Player' },
    options_ui: { open_in_tab: true, page: 'options.html' },
    browser_specific_settings: {
      gecko: {
        id: 'h5player-webext@example.invalid',
        strict_min_version: '142.0',
        data_collection_permissions: { required: ['none'] }
      }
    },
    background:
      browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    content_scripts: []
  }
}

function extensionZip(browser: ReleaseBrowser, profile: ReturnType<typeof resolveReleaseProfile>) {
  return createDeterministicZip(
    [
      { path: 'background.js', data: Buffer.from('export {}') },
      { path: 'content-scripts/content.js', data: Buffer.from('export {}') },
      { path: 'content-scripts/page-main.js', data: Buffer.from('export {}') },
      {
        path: 'manifest.json',
        data: Buffer.from(JSON.stringify(extensionManifest(browser, profile)))
      },
      { path: 'options.html', data: Buffer.from('<!doctype html>') },
      { path: 'popup.html', data: Buffer.from('<!doctype html>') }
    ],
    SOURCE_DATE_EPOCH
  )
}

async function fileEvidence(directory: string, files: readonly string[]) {
  return Promise.all(
    [...files].sort().map(async (file) => {
      const content = await readFile(path.join(directory, file))
      return { file, sha256: sha256(content), size: content.byteLength }
    })
  )
}

async function rewriteChecksums(directory: string): Promise<void> {
  const files = (await readdir(directory)).filter((file) => file !== 'checksums.txt').sort()
  const evidence = await fileEvidence(directory, files)
  await writeFile(
    path.join(directory, 'checksums.txt'),
    `${evidence.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`
  )
}

async function updateEvidenceMetadata(directory: string, file: string): Promise<void> {
  const manifestPath = path.join(directory, 'release-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    evidenceFiles: Array<{ file: string; sha256: string; size: number }>
  }
  const content = await readFile(path.join(directory, file))
  const entry = manifest.evidenceFiles.find((candidate) => candidate.file === file)
  if (!entry) throw new Error(`Missing evidence fixture: ${file}`)
  entry.sha256 = sha256(content)
  entry.size = content.byteLength
  await writeFile(manifestPath, stableJson(manifest))
  await rewriteChecksums(directory)
}

async function createBundleFixture(
  options: Readonly<{
    channel?: 'beta' | 'stable'
    sourceTreeClean?: boolean
    allGatesPassed?: boolean
  }> = {}
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-bundle-'))
  const { packageMetadata, graph, lockfileSha256 } = await dependencyEvidence()
  const channel = options.channel ?? 'beta'
  const sourceTreeClean = options.sourceTreeClean ?? true
  const profile = resolveReleaseProfile({
    packageVersion: packageMetadata.version,
    channel,
    sequence: channel === 'stable' ? 0 : 1
  })
  const artifacts: ArtifactEvidence[] = []
  for (const browser of ['chrome', 'firefox'] as const) {
    const file = `h5player-webext-${profile.releaseVersion}-${browser}.zip`
    const zip = extensionZip(browser, profile)
    const inspection = inspectExtensionArchive({
      zip,
      browser,
      profile,
      sourceDateEpoch: SOURCE_DATE_EPOCH
    })
    artifacts.push({ browser, file, sha256: sha256(zip), size: zip.byteLength, inspection })
    await writeFile(path.join(directory, file), zip)
  }

  const compatibility = await createCompatibilityReport(SOURCE_DATE_EPOCH * 1_000)
  const gates = createGateResults([]).map((gate) =>
    options.allGatesPassed
      ? { ...gate, status: 'passed' as const, evidence: 'verified fixture evidence' }
      : gate
  )
  const evidence = new Map<string, string>()
  evidence.set(
    'sbom.spdx.json',
    stableJson(
      createSpdxDocument({
        packageMetadata,
        profile,
        graph,
        sourceDateIso: SOURCE_DATE_ISO,
        lockfileSha256
      })
    )
  )
  evidence.set('third-party-licenses.txt', createThirdPartyLicenseReport(graph))
  evidence.set(
    'test-summary.json',
    stableJson(
      createTestSummary({
        profile,
        sourceDateIso: SOURCE_DATE_ISO,
        commitSha: COMMIT_SHA,
        sourceTreeClean,
        gates
      })
    )
  )
  evidence.set('compatibility-report.html', createCompatibilityReportHtml(compatibility))
  evidence.set(
    'provenance.json',
    stableJson(
      createProvenance({
        profile,
        sourceDateIso: SOURCE_DATE_ISO,
        commitSha: COMMIT_SHA,
        lockfileSha256,
        artifacts,
        builderId: 'local://fixture',
        sourceTreeClean
      })
    )
  )
  for (const [file, content] of evidence) {
    await writeFile(path.join(directory, file), content)
  }

  const evidenceFiles = await fileEvidence(directory, [...evidence.keys()])
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    stableJson(
      createReleaseManifest({
        profile,
        sourceDateIso: SOURCE_DATE_ISO,
        commitSha: COMMIT_SHA,
        sourceTreeClean,
        nodeVersion: 'v24.13.0',
        packageManager: 'pnpm@11.21.0',
        wxtVersion: '0.21.3',
        lockfileSha256,
        artifacts,
        evidenceFiles,
        compatibility,
        gates
      })
    )
  )
  await rewriteChecksums(directory)
  return directory
}

describe('release bundle verification', () => {
  it('accepts a complete, internally consistent nine-file bundle', async () => {
    const directory = await createBundleFixture()
    await expect(verifyReleaseBundle(directory)).resolves.toMatchObject({
      checkedFiles: 9,
      passed: true
    })
  }, 15_000)

  it('rejects missing canonical evidence even when checksums are rewritten', async () => {
    const directory = await createBundleFixture()
    await rm(path.join(directory, 'sbom.spdx.json'))
    await rewriteChecksums(directory)
    await expect(verifyReleaseBundle(directory)).rejects.toThrow(/canonical nine-file contract/)
  })

  it('rejects a symlink used as the bundle directory', async () => {
    const directory = await createBundleFixture()
    const root = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-link-'))
    const linkedDirectory = path.join(root, 'bundle')
    await symlink(directory, linkedDirectory)
    await expect(verifyReleaseBundle(linkedDirectory)).rejects.toThrow(/plain directory/)
  })

  it('rejects semantic evidence drift after all affected digests are rewritten', async () => {
    const directory = await createBundleFixture()
    const summaryPath = path.join(directory, 'test-summary.json')
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>
    summary['candidate'] = '9.9.9-stable'
    await writeFile(summaryPath, stableJson(summary))
    await updateEvidenceMetadata(directory, 'test-summary.json')
    await expect(verifyReleaseBundle(directory)).rejects.toThrow(/test summary differs/)
  })

  it('rejects non-canonical source dates and mismatched artifact browser metadata', async () => {
    const sourceDateDirectory = await createBundleFixture()
    const sourceDateManifestPath = path.join(sourceDateDirectory, 'release-manifest.json')
    const sourceDateManifest = JSON.parse(await readFile(sourceDateManifestPath, 'utf8')) as {
      build: { sourceDate: string }
    }
    sourceDateManifest.build.sourceDate = '2026-08-11T08:00:00+08:00'
    await writeFile(sourceDateManifestPath, stableJson(sourceDateManifest))
    await rewriteChecksums(sourceDateDirectory)
    await expect(verifyReleaseBundle(sourceDateDirectory)).rejects.toThrow(/sourceDate is invalid/)

    const browserDirectory = await createBundleFixture()
    const browserManifestPath = path.join(browserDirectory, 'release-manifest.json')
    const browserManifest = JSON.parse(await readFile(browserManifestPath, 'utf8')) as {
      artifacts: Array<{ browser: string }>
    }
    const firstArtifact = browserManifest.artifacts[0]
    if (!firstArtifact) throw new Error('Missing artifact fixture')
    firstArtifact.browser = firstArtifact.browser === 'chrome' ? 'firefox' : 'chrome'
    await writeFile(browserManifestPath, stableJson(browserManifest))
    await rewriteChecksums(browserDirectory)
    await expect(verifyReleaseBundle(browserDirectory)).rejects.toThrow(/browser metadata mismatch/)
  })

  it('rejects contradictory compatibility evidence after all digests are rewritten', async () => {
    const directory = await createBundleFixture()
    const compatibilityPath = path.join(directory, 'compatibility-report.html')
    const compatibility = await readFile(compatibilityPath, 'utf8')
    await writeFile(compatibilityPath, `${compatibility}<p>Live smoke: verified.</p>\n`)
    await updateEvidenceMetadata(directory, 'compatibility-report.html')
    await expect(verifyReleaseBundle(directory)).rejects.toThrow(/compatibility report differs/)
  })

  it('keeps a dirty Stable bundle at NO-GO even when every gate claims passed', async () => {
    const directory = await createBundleFixture({
      channel: 'stable',
      sourceTreeClean: false,
      allGatesPassed: true
    })
    const summaryPath = path.join(directory, 'test-summary.json')
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>
    expect(summary).toMatchObject({ stableEligible: false, stableDecision: 'NO-GO' })
    await expect(verifyReleaseBundle(directory)).resolves.toMatchObject({ passed: true })

    summary['stableEligible'] = true
    summary['stableDecision'] = 'review-required'
    await writeFile(summaryPath, stableJson(summary))
    await updateEvidenceMetadata(directory, 'test-summary.json')
    await expect(verifyReleaseBundle(directory)).rejects.toThrow(/test summary differs/)
  }, 10_000)

  it('rejects stripped SBOM and license closure after all digests are rewritten', async () => {
    const sbomDirectory = await createBundleFixture()
    const sbomPath = path.join(sbomDirectory, 'sbom.spdx.json')
    const sbom = JSON.parse(await readFile(sbomPath, 'utf8')) as {
      packages: Array<{ SPDXID?: string }>
      relationships: unknown[]
    }
    sbom.packages = sbom.packages.filter(
      (entry) => entry.SPDXID === 'SPDXRef-Package-H5Player-WebExtension'
    )
    sbom.relationships = []
    await writeFile(sbomPath, stableJson(sbom))
    await updateEvidenceMetadata(sbomDirectory, 'sbom.spdx.json')
    await expect(verifyReleaseBundle(sbomDirectory)).rejects.toThrow(/SBOM dependency closure/)

    const licenseDirectory = await createBundleFixture()
    await writeFile(
      path.join(licenseDirectory, 'third-party-licenses.txt'),
      'H5Player Web Extension — Third-Party License Inventory\n'
    )
    await updateEvidenceMetadata(licenseDirectory, 'third-party-licenses.txt')
    await expect(verifyReleaseBundle(licenseDirectory)).rejects.toThrow(/license inventory/)
  })

  it('rejects forged stored inspection evidence and non-canonical checksum order', async () => {
    const directory = await createBundleFixture()
    const manifestPath = path.join(directory, 'release-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      artifacts: Array<{ inspection: { entryCount: number } }>
    }
    const firstArtifact = manifest.artifacts[0]
    if (!firstArtifact) throw new Error('Missing artifact fixture')
    firstArtifact.inspection.entryCount += 1
    await writeFile(manifestPath, stableJson(manifest))
    await rewriteChecksums(directory)
    await expect(verifyReleaseBundle(directory)).rejects.toThrow(/inspection evidence mismatch/)

    const cleanDirectory = await createBundleFixture()
    const checksumPath = path.join(cleanDirectory, 'checksums.txt')
    const lines = (await readFile(checksumPath, 'utf8')).trimEnd().split('\n').reverse()
    await writeFile(checksumPath, `${lines.join('\n')}\n`)
    await expect(verifyReleaseBundle(cleanDirectory)).rejects.toThrow(/canonical file-name order/)
  })
})
