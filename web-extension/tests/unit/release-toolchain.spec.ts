import { describe, expect, it } from 'vitest'
import {
  assertReleaseToolchain,
  RELEASE_TOOLCHAIN,
  type WebExtensionPackage
} from '../../scripts/release/package-metadata'

function packageMetadata(overrides: Partial<WebExtensionPackage> = {}): WebExtensionPackage {
  return {
    name: '@h5player/web-extension',
    version: '0.1.0',
    license: 'GPL-3.0-or-later',
    packageManager: RELEASE_TOOLCHAIN.packageManager,
    dependencies: {},
    devDependencies: { wxt: RELEASE_TOOLCHAIN.wxt },
    ...overrides
  }
}

describe('release toolchain policy', () => {
  it('requires the exact Node, package-manager, and WXT release toolchain', () => {
    expect(() => assertReleaseToolchain(packageMetadata(), RELEASE_TOOLCHAIN.node)).not.toThrow()
    expect(() => assertReleaseToolchain(packageMetadata(), 'v24.14.0')).toThrow(/Node version/)
    expect(() =>
      assertReleaseToolchain(
        packageMetadata({ packageManager: 'pnpm@12.0.0' }),
        RELEASE_TOOLCHAIN.node
      )
    ).toThrow(/package manager/)
    expect(() =>
      assertReleaseToolchain(
        packageMetadata({ devDependencies: { wxt: '0.22.0' } }),
        RELEASE_TOOLCHAIN.node
      )
    ).toThrow(/WXT version/)
  })
})
