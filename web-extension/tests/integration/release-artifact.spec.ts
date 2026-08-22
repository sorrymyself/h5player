import { describe, expect, it } from 'vitest'
import { createDeterministicZip } from '../../scripts/release/archive'
import { inspectExtensionArchive } from '../../scripts/release/artifact-inspection'
import { resolveReleaseProfile } from '../../src/release'

const SOURCE_DATE_EPOCH = 1_700_000_000
const REQUIRED_CONTENT = [
  { path: 'background.js', data: Buffer.from('export {}') },
  { path: 'content-scripts/content.js', data: Buffer.from('export {}') },
  { path: 'content-scripts/page-main.js', data: Buffer.from('export {}') },
  { path: 'options.html', data: Buffer.from('<!doctype html>') },
  { path: 'popup.html', data: Buffer.from('<!doctype html>') }
]

function manifest(
  browser: 'chrome' | 'firefox',
  permission = ['storage', 'activeTab', 'scripting']
) {
  const profile = resolveReleaseProfile({
    packageVersion: '0.1.0',
    channel: 'beta',
    sequence: 1
  })
  return {
    profile,
    source: {
      manifest_version: 3,
      name: profile.manifestName,
      description: profile.manifestDescription,
      version: profile.manifestVersion,
      permissions: permission,
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
}

describe('release artifact inspection', () => {
  it.each(['chrome', 'firefox'] as const)(
    'accepts a minimal policy-compliant %s archive',
    (browser) => {
      const input = manifest(browser)
      const zip = createDeterministicZip(
        [
          ...REQUIRED_CONTENT,
          { path: 'manifest.json', data: Buffer.from(JSON.stringify(input.source)) }
        ],
        SOURCE_DATE_EPOCH
      )
      expect(
        inspectExtensionArchive({
          zip,
          browser,
          profile: input.profile,
          sourceDateEpoch: SOURCE_DATE_EPOCH
        })
      ).toMatchObject({ passed: true, entryCount: 6, violations: [] })
    }
  )

  it('reports permission, remote code, source map, and profile drift', () => {
    const input = manifest('chrome', ['storage', 'tabs'])
    const zip = createDeterministicZip(
      [
        ...REQUIRED_CONTENT,
        { path: 'remote.js', data: Buffer.from('import("https://example.test/code.js")') },
        {
          path: 'remote-loader.html',
          data: Buffer.from('<script src="//example.test/loader"></script>')
        },
        {
          path: 'remote-worker.js',
          data: Buffer.from('new Worker("https://example.test/worker")')
        },
        { path: 'debug.map', data: Buffer.from('{}') },
        {
          path: 'manifest.json',
          data: Buffer.from(JSON.stringify({ ...input.source, version: '9.9.9.9' }))
        }
      ],
      SOURCE_DATE_EPOCH
    )
    const inspection = inspectExtensionArchive({
      zip,
      browser: 'chrome',
      profile: input.profile,
      sourceDateEpoch: SOURCE_DATE_EPOCH
    })
    expect(inspection.passed).toBe(false)
    expect(new Set(inspection.violations.map((violation) => violation.code))).toEqual(
      new Set(['ARCHIVE_SOURCE_MAP', 'FORBIDDEN_CODE', 'MANIFEST_IDENTITY', 'MANIFEST_PERMISSION'])
    )
  })

  it('rejects relaxed CSP and missing Firefox release metadata', () => {
    const input = manifest('firefox')
    const source = {
      ...input.source,
      browser_specific_settings: undefined,
      content_security_policy: {
        extension_pages: "script-src * data: blob:; object-src 'self'"
      }
    }
    const zip = createDeterministicZip(
      [...REQUIRED_CONTENT, { path: 'manifest.json', data: Buffer.from(JSON.stringify(source)) }],
      SOURCE_DATE_EPOCH
    )
    const inspection = inspectExtensionArchive({
      zip,
      browser: 'firefox',
      profile: input.profile,
      sourceDateEpoch: SOURCE_DATE_EPOCH
    })
    expect(new Set(inspection.violations.map((violation) => violation.code))).toEqual(
      new Set(['MANIFEST_CSP', 'MANIFEST_FIREFOX_METADATA'])
    )
  })

  it('rejects optional non-host permissions', () => {
    const input = manifest('chrome')
    const source = {
      ...input.source,
      optional_permissions: ['debugger', 'nativeMessaging', 'downloads']
    }
    const zip = createDeterministicZip(
      [...REQUIRED_CONTENT, { path: 'manifest.json', data: Buffer.from(JSON.stringify(source)) }],
      SOURCE_DATE_EPOCH
    )
    const inspection = inspectExtensionArchive({
      zip,
      browser: 'chrome',
      profile: input.profile,
      sourceDateEpoch: SOURCE_DATE_EPOCH
    })
    expect(inspection.passed).toBe(false)
    expect(inspection.violations).toEqual([
      {
        code: 'MANIFEST_OPTIONAL_PERMISSION',
        path: 'manifest.json',
        message: 'optional non-host permissions are forbidden'
      }
    ])
  })

  it('rejects unapproved top-level and nested manifest capabilities', () => {
    const input = manifest('chrome')
    const source = {
      ...input.source,
      key: 'unapproved-extension-identity',
      devtools_page: 'devtools.html',
      chrome_url_overrides: { newtab: 'newtab.html' },
      sandbox: { pages: ['sandbox.html'] },
      browser_specific_settings: {
        gecko: {
          ...input.source.browser_specific_settings.gecko,
          strict_max_version: '999.*'
        },
        vendor: { capability: true }
      }
    }
    const zip = createDeterministicZip(
      [...REQUIRED_CONTENT, { path: 'manifest.json', data: Buffer.from(JSON.stringify(source)) }],
      SOURCE_DATE_EPOCH
    )
    const inspection = inspectExtensionArchive({
      zip,
      browser: 'chrome',
      profile: input.profile,
      sourceDateEpoch: SOURCE_DATE_EPOCH
    })
    expect(inspection.passed).toBe(false)
    expect(new Set(inspection.violations.map((violation) => violation.code))).toEqual(
      new Set(['MANIFEST_CAPABILITY', 'MANIFEST_FIREFOX_METADATA'])
    )
  })
})
