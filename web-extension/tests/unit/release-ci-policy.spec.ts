import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS = [
  '../.github/workflows/web-extension.yml',
  '../.github/workflows/web-extension-nightly.yml',
  '../.github/workflows/web-extension-rc.yml',
  '../.github/actions/setup-web-extension/action.yml'
] as const

describe('release CI policy', () => {
  it('pins remote actions and keeps repository permissions read-only', async () => {
    for (const relativePath of WORKFLOWS) {
      const source = await readFile(path.resolve(relativePath), 'utf8')
      const remoteUses = [...source.matchAll(/uses:\s+([\w-]+\/[\w-]+)@([^\s#]+)/g)]
      for (const match of remoteUses) {
        expect(match[2], `${relativePath}: ${match[1]}`).toMatch(/^[0-9a-f]{40}$/)
      }
      expect(source).not.toMatch(/contents:\s+write/)
      expect(source).not.toMatch(/pull-requests:\s+write/)
      expect(source).not.toMatch(/git\s+push|git\s+tag|publish-browser-extension|web-ext\s+sign/)
      if (relativePath.includes('/workflows/')) {
        expect(source.match(/uses: actions\/checkout@/g)?.length).toBe(
          source.match(/persist-credentials: false/g)?.length
        )
      }
    }
  })

  it('defines separate PR, nightly, and no-publish RC lanes with reproducibility', async () => {
    const [pullRequest, nightly, releaseCandidate, setup] = await Promise.all(
      WORKFLOWS.map((file) => readFile(path.resolve(file), 'utf8'))
    )
    expect(pullRequest).toContain('Package and inspect both browsers')
    expect(pullRequest).toContain('firefox-e2e:')
    expect(pullRequest).toContain("'.github/workflows/web-extension-nightly.yml'")
    expect(pullRequest).toContain("'.github/workflows/web-extension-rc.yml'")
    expect(nightly).toContain('schedule:')
    expect(nightly).toContain('release:reproducibility')
    expect(releaseCandidate).toContain('RC Evidence (No Publish)')
    expect(releaseCandidate).toContain('source_date_epoch:')
    expect(releaseCandidate).toContain('RELEASE_SEQUENCE: ${{ inputs.sequence }}')
    expect(releaseCandidate).toContain('--sequence "$RELEASE_SEQUENCE"')
    expect(releaseCandidate).not.toContain('--sequence "${{ inputs.sequence }}"')
    expect(releaseCandidate).not.toContain('--source-date-epoch "${{ inputs.source_date_epoch }}"')
    expect(releaseCandidate).toContain('[[ "$RELEASE_SEQUENCE" =~ ^(0|[1-9][0-9]*)$ ]]')
    expect(setup).toContain('Cache pnpm store')
    expect(setup).toContain('--frozen-lockfile')
    expect(setup).toContain('H5PLAYER_PNPM_VERSION: ${{ inputs.pnpm-version }}')
    expect(setup).not.toContain('pnpm@${{ inputs.pnpm-version }}')
    for (const workflow of [pullRequest, nightly, releaseCandidate]) {
      expect(workflow).toContain('audit --audit-level high')
      expect(workflow).not.toContain('audit --prod')
    }
    const pnpmPolicy = await readFile(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(pnpmPolicy).toContain('GHSA-w3rx-r6r6-pgpr')
    expect(pnpmPolicy).toContain('GHSA-5p2g-fcmc-qvqq')
    expect(pullRequest).not.toContain('--skip-build')
  })
})
