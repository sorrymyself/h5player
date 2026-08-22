import { describe, expect, it } from 'vitest'
import {
  assertRuntimeLicensePolicy,
  collectRuntimeDependencyGraph,
  createSpdxDocument,
  createThirdPartyLicenseReport
} from '../../scripts/release/dependency-evidence'
import { sha256File } from '../../scripts/release/hash'
import { readWebExtensionPackage } from '../../scripts/release/package-metadata'
import { resolveReleaseProfile } from '../../src/release'

describe('release dependency evidence', () => {
  it('builds a deterministic runtime dependency closure and SPDX document', async () => {
    const packageMetadata = await readWebExtensionPackage()
    const graph = await collectRuntimeDependencyGraph(packageMetadata)
    expect(graph.rootDependencies).toEqual(
      expect.arrayContaining(['vue@3.5.41', 'vue-router@5.2.0', 'zod@4.4.3'])
    )
    expect(graph.packages.length).toBeGreaterThan(10)
    expect(graph.packages.every((dependency) => dependency.license !== 'NOASSERTION')).toBe(true)
    expect(() => assertRuntimeLicensePolicy(graph)).not.toThrow()

    const profile = resolveReleaseProfile({
      packageVersion: packageMetadata.version,
      channel: 'beta',
      sequence: 1
    })
    const spdx = createSpdxDocument({
      packageMetadata,
      profile,
      graph,
      sourceDateIso: '2026-08-11T00:00:00.000Z',
      lockfileSha256: await sha256File('pnpm-lock.yaml')
    })
    expect(spdx).toMatchObject({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      name: `h5player-webext-${profile.releaseVersion}`
    })
    expect(createThirdPartyLicenseReport(graph)).toContain('vue@3.5.41\nLicense: MIT')
  })

  it('rejects runtime licenses outside the reviewed allowlist', () => {
    expect(() =>
      assertRuntimeLicensePolicy({
        rootDependencies: ['unreviewed@1.0.0'],
        packages: [
          {
            key: 'unreviewed@1.0.0',
            spdxId: 'SPDXRef-Unreviewed',
            name: 'unreviewed',
            version: '1.0.0',
            license: 'NOASSERTION',
            homepage: null,
            repository: null,
            dependencies: []
          }
        ]
      })
    ).toThrow(/license review required/)
  })
})
