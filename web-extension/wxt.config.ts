import { readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'
import { resolveReleaseProfile } from './src/release'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  version?: unknown
}
if (typeof packageJson.version !== 'string') {
  throw new Error('web-extension/package.json must define a string version')
}

const releaseProfile = resolveReleaseProfile({
  packageVersion: packageJson.version,
  channel: process.env['H5PLAYER_RELEASE_CHANNEL'] ?? 'dev',
  sequence: process.env['H5PLAYER_RELEASE_SEQUENCE'] ?? '0'
})

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: releaseProfile.manifestName,
    version: releaseProfile.manifestVersion,
    description: releaseProfile.manifestDescription,
    permissions: ['storage', 'activeTab', 'scripting'],
    optional_host_permissions: ['<all_urls>'],
    action: {
      default_title: 'H5Player'
    },
    browser_specific_settings: {
      gecko: {
        id: 'h5player-webext@example.invalid',
        strict_min_version: '142.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    }
  }
})
