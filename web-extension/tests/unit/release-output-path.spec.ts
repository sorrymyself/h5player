import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareReleaseOutputDirectory } from '../../scripts/release/release-bundle'

describe('release output path safety', () => {
  it('allows nested children of a plain .release directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-output-'))
    const output = await prepareReleaseOutputDirectory(root, '.release/nested/candidate')
    expect(output).toBe(path.join(root, '.release/nested/candidate'))
  })

  it('rejects the release root, symlinked parents, and symlinked outputs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-output-'))
    await expect(prepareReleaseOutputDirectory(root, '.release')).rejects.toThrow(/child directory/)

    const outside = await mkdtemp(path.join(os.tmpdir(), 'h5player-release-outside-'))
    await mkdir(path.join(root, '.release'), { recursive: true })
    await symlink(outside, path.join(root, '.release', 'linked-parent'))
    await expect(
      prepareReleaseOutputDirectory(root, '.release/linked-parent/candidate')
    ).rejects.toThrow(/plain directory/)

    await symlink(outside, path.join(root, '.release', 'linked-output'))
    await expect(prepareReleaseOutputDirectory(root, '.release/linked-output')).rejects.toThrow(
      /plain directory/
    )
  })
})
