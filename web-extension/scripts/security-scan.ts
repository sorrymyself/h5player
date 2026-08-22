import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { stableJson } from './release/stable-json'

const sourceRoots = ['entrypoints', 'src']
const outputRoots = [
  { browser: 'chrome', root: '.output/chrome-mv3' },
  { browser: 'firefox', root: '.output/firefox-mv3' }
] as const
const roots = [...sourceRoots, ...outputRoots.map((output) => output.root)]
const forbidden = [
  { label: 'eval', pattern: /\beval\s*\(/i },
  { label: 'Function constructor', pattern: /\b(?:new\s+)?Function\s*\(/ },
  { label: 'javascript data URI', pattern: /data:\s*text\/javascript/i },
  { label: 'remote executable script', pattern: /https?:\/\/[^\s'"`]+\.m?js(?:[?#][^\s'"`]*)?/i },
  { label: 'unsafe-eval', pattern: /unsafe-eval/i },
  { label: 'CSP relaxation', pattern: /declarativeNetRequest|webRequestBlocking/i }
]
const sourceOnlyForbidden = [
  { label: 'business innerHTML assignment', pattern: /\.innerHTML\s*=/ },
  { label: 'legacy runtime import', pattern: /(?:inject(?:\.base|\.main)?\.js|src\/h5player)/ }
]
const allowedPermissions = new Set(['storage', 'activeTab', 'scripting'])
const allowedOptionalHostPermissions = new Set(['<all_urls>'])
const allowedManifestKeys = new Set([
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

async function collectFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await collectFiles(filePath)))
      else if (/\.(?:ts|tsx|vue|js|mjs|html|json)$/.test(entry.name)) files.push(filePath)
    }
    return files
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}

function matchesJson(value: unknown, expected: unknown): boolean {
  return value !== undefined && stableJson(value) === stableJson(expected)
}

function checkExactSet(
  values: string[] | null,
  expected: ReadonlySet<string>,
  label: string,
  manifestPath: string,
  violations: string[]
): void {
  const uniqueValues = values === null ? null : new Set(values)
  if (
    values === null ||
    values.length !== expected.size ||
    uniqueValues?.size !== expected.size ||
    [...expected].some((value) => !uniqueValues?.has(value))
  ) {
    violations.push(`${label} differs from the canonical release policy: ${manifestPath}`)
  }
}

async function inspectManifest(
  manifestPath: string,
  browser: (typeof outputRoots)[number]['browser'],
  violations: string[]
): Promise<boolean> {
  let source: string
  try {
    source = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    violations.push(`manifest cannot be read: ${manifestPath}`)
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    violations.push(`manifest cannot be parsed: ${manifestPath}`)
    return true
  }
  const manifest = asRecord(parsed)
  if (!manifest || manifest['manifest_version'] !== 3) {
    violations.push(`manifest is not MV3: ${manifestPath}`)
    return true
  }

  const unexpectedManifestKeys = Object.keys(manifest)
    .filter((key) => !allowedManifestKeys.has(key))
    .sort()
  if (unexpectedManifestKeys.length > 0) {
    violations.push(
      `unapproved manifest capabilities (${unexpectedManifestKeys.join(', ')}): ${manifestPath}`
    )
  }

  checkExactSet(
    stringArray(manifest['permissions']),
    allowedPermissions,
    'permissions',
    manifestPath,
    violations
  )
  checkExactSet(
    stringArray(manifest['optional_host_permissions']),
    allowedOptionalHostPermissions,
    'optional_host_permissions',
    manifestPath,
    violations
  )
  const optionalPermissionsValue = manifest['optional_permissions']
  const optionalPermissions = stringArray(optionalPermissionsValue)
  if (
    optionalPermissionsValue !== undefined &&
    (optionalPermissions === null || optionalPermissions.length !== 0)
  ) {
    violations.push(`unexpected optional_permissions: ${manifestPath}`)
  }
  if (manifest['host_permissions'] !== undefined) {
    violations.push(`unexpected host_permissions: ${manifestPath}`)
  }

  if (
    !matchesJson(manifest['action'], { default_popup: 'popup.html', default_title: 'H5Player' })
  ) {
    violations.push(`unexpected extension action: ${manifestPath}`)
  }
  if (!matchesJson(manifest['options_ui'], { open_in_tab: true, page: 'options.html' })) {
    violations.push(`unexpected options UI: ${manifestPath}`)
  }
  const expectedBackground =
    browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] }
  if (!matchesJson(manifest['background'], expectedBackground)) {
    violations.push(`unexpected ${browser} background declaration: ${manifestPath}`)
  }
  if (
    !matchesJson(manifest['browser_specific_settings'], {
      gecko: {
        data_collection_permissions: { required: ['none'] },
        id: 'h5player-webext@example.invalid',
        strict_min_version: '142.0'
      }
    })
  ) {
    violations.push(`unexpected Firefox release metadata: ${manifestPath}`)
  }

  for (const field of ['content_scripts', 'web_accessible_resources'] as const) {
    const value = manifest[field]
    if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) {
      violations.push(`production ${field} must be absent or empty: ${manifestPath}`)
    }
  }

  const serialized = JSON.stringify(manifest)
    .replaceAll('http://localhost/*', '')
    .replaceAll('http://127.0.0.1/*', '')
  if (/unsafe-eval|https?:\/\//i.test(serialized)) {
    violations.push(`manifest contains unsafe CSP or remote URL: ${manifestPath}`)
  }
  return true
}

const files = (await Promise.all(roots.map((root) => collectFiles(root)))).flat()
const sourceFiles = (await Promise.all(sourceRoots.map((root) => collectFiles(root)))).flat()
const violations: string[] = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${rule.label}: ${file}`)
  }
}

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8')
  for (const rule of sourceOnlyForbidden) {
    if (rule.pattern.test(source)) violations.push(`${rule.label}: ${file}`)
  }
}

let manifestsInspected = 0
for (const output of outputRoots) {
  if (await inspectManifest(path.join(output.root, 'manifest.json'), output.browser, violations)) {
    manifestsInspected += 1
  }
}

if (violations.length > 0) {
  console.error('Security scan failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `Security scan passed (${files.length} files and ${manifestsInspected} manifests inspected).`
  )
}
