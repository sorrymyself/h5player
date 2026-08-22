import type { ReleaseProfile } from '../../src/release'
import { readZipEntries, toDosDateTime, type ArchiveEntry } from './archive'
import { stableJson } from './stable-json'

export type ReleaseBrowser = 'chrome' | 'firefox'

export type ArtifactViolationCode =
  | 'ARCHIVE_ENTRY_MODE'
  | 'ARCHIVE_ENTRY_TIMESTAMP'
  | 'ARCHIVE_REQUIRED_FILE'
  | 'ARCHIVE_SOURCE_MAP'
  | 'FORBIDDEN_CODE'
  | 'MANIFEST_BACKGROUND'
  | 'MANIFEST_CAPABILITY'
  | 'MANIFEST_CONTENT_SCRIPTS'
  | 'MANIFEST_CSP'
  | 'MANIFEST_HOST_PERMISSION'
  | 'MANIFEST_IDENTITY'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_FIREFOX_METADATA'
  | 'MANIFEST_OPTIONAL_HOST_PERMISSION'
  | 'MANIFEST_OPTIONAL_PERMISSION'
  | 'MANIFEST_PERMISSION'
  | 'MANIFEST_REMOTE_CAPABILITY'
  | 'MANIFEST_WEB_ACCESSIBLE_RESOURCE'

export type ArtifactViolation = Readonly<{
  code: ArtifactViolationCode
  path: string
  message: string
}>

export type ArtifactInspection = Readonly<{
  schemaVersion: 1
  browser: ReleaseBrowser
  entryCount: number
  manifestVersion: string | null
  passed: boolean
  violations: readonly ArtifactViolation[]
}>

const REQUIRED_FILES = [
  'background.js',
  'content-scripts/content.js',
  'content-scripts/page-main.js',
  'manifest.json',
  'options.html',
  'popup.html'
] as const
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'storage'] as const
const ALLOWED_OPTIONAL_HOST_PERMISSIONS = ['<all_urls>'] as const
const ALLOWED_MANIFEST_KEYS = new Set([
  'action',
  'background',
  'browser_specific_settings',
  'content_scripts',
  'content_security_policy',
  'description',
  'host_permissions',
  'manifest_version',
  'name',
  'optional_host_permissions',
  'optional_permissions',
  'options_ui',
  'permissions',
  'version',
  'web_accessible_resources'
])
const TEXT_FILE_PATTERN = /\.(?:css|html|js|json|mjs)$/i
const FORBIDDEN_CODE = [
  { label: 'eval', pattern: /\beval\s*\(/i },
  { label: 'Function constructor', pattern: /\b(?:new\s+)?Function\s*\(/ },
  { label: 'javascript data URI', pattern: /data:\s*text\/javascript/i },
  { label: 'remote executable script', pattern: /https?:\/\/[^\s'"`]+\.m?js(?:[?#][^\s'"`]*)?/i },
  { label: 'remote dynamic import', pattern: /\bimport\s*\(\s*['"`]\s*(?:https?:)?\/\//i },
  {
    label: 'remote script element',
    pattern: /<script\b[^>]*\bsrc\s*=\s*['"`]?\s*(?:https?:)?\/\//i
  },
  {
    label: 'remote worker script',
    pattern: /\b(?:importScripts|Worker|SharedWorker)\s*\(\s*['"`]\s*(?:https?:)?\/\//i
  },
  {
    label: 'remote WebAssembly',
    pattern:
      /\bWebAssembly\.(?:compile|instantiate)(?:Streaming)?\s*\(\s*fetch\s*\(\s*['"`]\s*(?:https?:)?\/\//i
  },
  { label: 'unsafe-eval', pattern: /unsafe-eval/i },
  { label: 'CSP relaxation API', pattern: /declarativeNetRequest|webRequestBlocking/i },
  { label: 'source map reference', pattern: /sourceMappingURL/i }
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}

function equalStringSet(actual: string[] | null, expected: readonly string[]): boolean {
  if (actual === null || actual.length !== expected.length) return false
  const normalized = [...actual].sort()
  const normalizedExpected = [...expected].sort()
  return normalized.every((entry, index) => entry === normalizedExpected[index])
}

function addViolation(
  violations: ArtifactViolation[],
  code: ArtifactViolationCode,
  path: string,
  message: string
): void {
  violations.push({ code, path, message })
}

function matchesJson(value: unknown, expected: unknown): boolean {
  return value !== undefined && stableJson(value) === stableJson(expected)
}

function inspectEntryMetadata(
  entries: readonly ArchiveEntry[],
  sourceDateEpoch: number,
  violations: ArtifactViolation[]
): void {
  const expected = toDosDateTime(sourceDateEpoch)
  const paths = new Set(entries.map((entry) => entry.path))
  for (const required of REQUIRED_FILES) {
    if (!paths.has(required)) {
      addViolation(
        violations,
        'ARCHIVE_REQUIRED_FILE',
        required,
        'required extension entry is missing'
      )
    }
  }
  for (const entry of entries) {
    if (entry.mode !== 0o100644) {
      addViolation(
        violations,
        'ARCHIVE_ENTRY_MODE',
        entry.path,
        `entry mode must be 100644, received ${entry.mode.toString(8)}`
      )
    }
    if (entry.dosDate !== expected.date || entry.dosTime !== expected.time) {
      addViolation(
        violations,
        'ARCHIVE_ENTRY_TIMESTAMP',
        entry.path,
        'entry timestamp does not match SOURCE_DATE_EPOCH'
      )
    }
    if (entry.path.endsWith('.map')) {
      addViolation(violations, 'ARCHIVE_SOURCE_MAP', entry.path, 'source maps are forbidden')
    }
    if (TEXT_FILE_PATTERN.test(entry.path)) {
      const source = Buffer.from(entry.data).toString('utf8')
      for (const rule of FORBIDDEN_CODE) {
        if (rule.pattern.test(source)) {
          addViolation(violations, 'FORBIDDEN_CODE', entry.path, rule.label)
        }
      }
    }
  }
}

function inspectBackground(
  manifest: Record<string, unknown>,
  browser: ReleaseBrowser,
  violations: ArtifactViolation[]
): void {
  const expected =
    browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] }
  const valid = matchesJson(manifest['background'], expected)
  if (!valid) {
    addViolation(
      violations,
      'MANIFEST_BACKGROUND',
      'manifest.json',
      `unexpected ${browser} background declaration`
    )
  }
}

function hasCanonicalExtensionCsp(value: unknown): boolean {
  if (value === undefined) return true
  const policy = asRecord(value)
  if (!policy || Object.keys(policy).length !== 1) return false
  const extensionPages = policy['extension_pages']
  if (typeof extensionPages !== 'string') return false
  const directives = extensionPages
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .sort()
  return (
    directives.length === 2 &&
    directives[0] === "object-src 'self'" &&
    directives[1] === "script-src 'self'"
  )
}

function inspectManifest(
  manifestEntry: ArchiveEntry | undefined,
  browser: ReleaseBrowser,
  profile: ReleaseProfile,
  violations: ArtifactViolation[]
): string | null {
  if (!manifestEntry) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(manifestEntry.data).toString('utf8')) as unknown
  } catch {
    addViolation(violations, 'MANIFEST_INVALID', 'manifest.json', 'manifest is not valid JSON')
    return null
  }
  const manifest = asRecord(parsed)
  if (!manifest || manifest['manifest_version'] !== 3) {
    addViolation(violations, 'MANIFEST_INVALID', 'manifest.json', 'manifest must be Manifest V3')
    return null
  }

  const unexpectedManifestKeys = Object.keys(manifest)
    .filter((key) => !ALLOWED_MANIFEST_KEYS.has(key))
    .sort()
  if (unexpectedManifestKeys.length > 0) {
    addViolation(
      violations,
      'MANIFEST_CAPABILITY',
      'manifest.json',
      `unapproved manifest capabilities: ${unexpectedManifestKeys.join(', ')}`
    )
  }

  if (
    manifest['version'] !== profile.manifestVersion ||
    manifest['name'] !== profile.manifestName ||
    manifest['description'] !== profile.manifestDescription
  ) {
    addViolation(
      violations,
      'MANIFEST_IDENTITY',
      'manifest.json',
      'manifest version/name/description does not match the selected release profile'
    )
  }
  if (!equalStringSet(stringArray(manifest['permissions']), ALLOWED_PERMISSIONS)) {
    addViolation(
      violations,
      'MANIFEST_PERMISSION',
      'manifest.json',
      'permissions differ from storage, activeTab, and scripting'
    )
  }
  const optionalPermissionsValue = manifest['optional_permissions']
  const optionalPermissions = stringArray(optionalPermissionsValue)
  if (
    optionalPermissionsValue !== undefined &&
    (optionalPermissions === null || optionalPermissions.length !== 0)
  ) {
    addViolation(
      violations,
      'MANIFEST_OPTIONAL_PERMISSION',
      'manifest.json',
      'optional non-host permissions are forbidden'
    )
  }
  if (
    !matchesJson(manifest['action'], { default_popup: 'popup.html', default_title: 'H5Player' })
  ) {
    addViolation(
      violations,
      'MANIFEST_CAPABILITY',
      'manifest.json',
      'extension action must use only the approved popup and title'
    )
  }
  if (!matchesJson(manifest['options_ui'], { open_in_tab: true, page: 'options.html' })) {
    addViolation(
      violations,
      'MANIFEST_CAPABILITY',
      'manifest.json',
      'options UI must use only the approved extension page'
    )
  }
  if (
    !equalStringSet(
      stringArray(manifest['optional_host_permissions']),
      ALLOWED_OPTIONAL_HOST_PERMISSIONS
    )
  ) {
    addViolation(
      violations,
      'MANIFEST_OPTIONAL_HOST_PERMISSION',
      'manifest.json',
      'optional host permissions must be exactly <all_urls>'
    )
  }
  const hostPermissions = manifest['host_permissions']
  if (hostPermissions !== undefined && stringArray(hostPermissions)?.length !== 0) {
    addViolation(
      violations,
      'MANIFEST_HOST_PERMISSION',
      'manifest.json',
      'required host permissions are forbidden'
    )
  }
  const contentScripts = manifest['content_scripts']
  if (
    contentScripts !== undefined &&
    (!Array.isArray(contentScripts) || contentScripts.length > 0)
  ) {
    addViolation(
      violations,
      'MANIFEST_CONTENT_SCRIPTS',
      'manifest.json',
      'production content_scripts must be absent or empty'
    )
  }
  const webAccessibleResources = manifest['web_accessible_resources']
  if (
    webAccessibleResources !== undefined &&
    (!Array.isArray(webAccessibleResources) || webAccessibleResources.length > 0)
  ) {
    addViolation(
      violations,
      'MANIFEST_WEB_ACCESSIBLE_RESOURCE',
      'manifest.json',
      'production web_accessible_resources must be absent or empty'
    )
  }
  const browserSettings = asRecord(manifest['browser_specific_settings'])
  const geckoSettings = asRecord(browserSettings?.['gecko'])
  if (
    !matchesJson(browserSettings, {
      gecko: {
        data_collection_permissions: { required: ['none'] },
        id: 'h5player-webext@example.invalid',
        strict_min_version: '142.0'
      }
    })
  ) {
    addViolation(
      violations,
      'MANIFEST_FIREFOX_METADATA',
      'manifest.json',
      'Firefox identity, minimum version, and data-collection declaration must be canonical'
    )
  }
  if (
    manifest['externally_connectable'] !== undefined ||
    manifest['update_url'] !== undefined ||
    geckoSettings?.['update_url'] !== undefined
  ) {
    addViolation(
      violations,
      'MANIFEST_REMOTE_CAPABILITY',
      'manifest.json',
      'externally_connectable and repository-defined update URLs are forbidden'
    )
  }
  if (!hasCanonicalExtensionCsp(manifest['content_security_policy'])) {
    addViolation(
      violations,
      'MANIFEST_CSP',
      'manifest.json',
      'manifest CSP must be absent or exactly script-src/object-src self'
    )
  }
  inspectBackground(manifest, browser, violations)
  return typeof manifest['version'] === 'string' ? manifest['version'] : null
}

export function inspectExtensionArchive(
  input: Readonly<{
    zip: Uint8Array
    browser: ReleaseBrowser
    profile: ReleaseProfile
    sourceDateEpoch: number
  }>
): ArtifactInspection {
  const entries = readZipEntries(input.zip)
  const violations: ArtifactViolation[] = []
  inspectEntryMetadata(entries, input.sourceDateEpoch, violations)
  const manifestVersion = inspectManifest(
    entries.find((entry) => entry.path === 'manifest.json'),
    input.browser,
    input.profile,
    violations
  )
  return Object.freeze({
    schemaVersion: 1,
    browser: input.browser,
    entryCount: entries.length,
    manifestVersion,
    passed: violations.length === 0,
    violations: Object.freeze(violations)
  })
}
