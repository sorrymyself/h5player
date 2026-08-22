import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const KIB = 1024
const GZIP_LEVEL = 9

export type BundleId = 'background' | 'content' | 'page-main'

export type BundleBudgetDefinition = {
  id: BundleId
  relativePath: string
  maxRawBytes: number
}

export type ProductionOutputConfig = {
  target: string
  outputRoot: string
}

export type BundleSources = Readonly<Record<BundleId, Uint8Array>>

export type BudgetViolationCode =
  | 'BUNDLE_RAW_BUDGET_EXCEEDED'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_REQUIRED_HOST_PERMISSIONS'
  | 'MANIFEST_WEB_ACCESSIBLE_RESOURCES'
  | 'MANIFEST_CONTENT_SCRIPTS'
  | 'OUTPUT_INSPECTION_FAILED'

export type BudgetViolation = {
  code: BudgetViolationCode
  target: string
  path: string
  message: string
}

export type BundleMeasurement = BundleBudgetDefinition & {
  rawBytes: number
  gzipBytes: number
  rawHeadroomBytes: number
  passed: boolean
}

export type ManifestCheck = {
  path: string
  requiredHostPermissions: string[]
  webAccessibleResourceCount: number | null
  contentScriptCount: number | null
  passed: boolean
  violations: BudgetViolation[]
}

export type ProductionOutputReport = {
  target: string
  outputRoot: string
  enforcedMetric: 'rawBytes'
  bundles: BundleMeasurement[]
  manifest: ManifestCheck
  passed: boolean
  violations: BudgetViolation[]
}

export type BundleBudgetSummary = {
  schemaVersion: 1
  enforcedMetric: 'rawBytes'
  gzipCompressionLevel: 9
  budgets: BundleBudgetDefinition[]
  outputs: ProductionOutputReport[]
  passed: boolean
  violations: BudgetViolation[]
}

type CliDependencies = {
  inspectOutput?: (config: ProductionOutputConfig, cwd: string) => Promise<ProductionOutputReport>
  writeOutput?: (output: string) => void
}

export const BUNDLE_BUDGETS: readonly BundleBudgetDefinition[] = [
  {
    id: 'background',
    relativePath: 'background.js',
    maxRawBytes: 150 * KIB
  },
  {
    id: 'content',
    relativePath: 'content-scripts/content.js',
    maxRawBytes: 250 * KIB
  },
  {
    id: 'page-main',
    relativePath: 'content-scripts/page-main.js',
    maxRawBytes: 200 * KIB
  }
]

export const DEFAULT_PRODUCTION_OUTPUTS: readonly ProductionOutputConfig[] = [
  { target: 'chrome-mv3', outputRoot: '.output/chrome-mv3' },
  { target: 'firefox-mv3', outputRoot: '.output/firefox-mv3' }
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
}

function isHostPermission(value: string): boolean {
  return value === '<all_urls>' || /^(?:\*|https?|file|ftp):\/\//i.test(value)
}

function countManifestEntries(
  value: unknown,
  fieldName: string,
  target: string,
  manifestPath: string,
  violationCode: BudgetViolationCode,
  violations: BudgetViolation[]
): number | null {
  if (value === undefined) return 0
  if (!Array.isArray(value)) {
    violations.push({
      code: violationCode,
      target,
      path: manifestPath,
      message: `${fieldName} must be absent or an empty array`
    })
    return null
  }
  if (value.length > 0) {
    violations.push({
      code: violationCode,
      target,
      path: manifestPath,
      message: `${fieldName} must not contain production entries (found ${value.length})`
    })
  }
  return value.length
}

export function measureBundle(
  definition: BundleBudgetDefinition,
  source: Uint8Array
): BundleMeasurement {
  const rawBytes = source.byteLength
  const gzipBytes = gzipSync(source, { level: GZIP_LEVEL }).byteLength
  return {
    ...definition,
    rawBytes,
    gzipBytes,
    rawHeadroomBytes: definition.maxRawBytes - rawBytes,
    passed: rawBytes <= definition.maxRawBytes
  }
}

export function validateProductionManifest(
  manifest: unknown,
  target: string,
  manifestPath = 'manifest.json'
): ManifestCheck {
  const violations: BudgetViolation[] = []
  const record = asRecord(manifest)
  if (!record || record['manifest_version'] !== 3) {
    violations.push({
      code: 'MANIFEST_INVALID',
      target,
      path: manifestPath,
      message: 'production manifest must be a Manifest V3 object'
    })
  }

  const hostPermissionsValue = record?.['host_permissions']
  const hostPermissions =
    hostPermissionsValue === undefined ? [] : asStringArray(hostPermissionsValue)
  const regularPermissions = asStringArray(record?.['permissions']) ?? []
  const requiredHostPermissions = [
    ...(hostPermissions ?? []),
    ...regularPermissions.filter(isHostPermission)
  ].filter((value, index, values) => values.indexOf(value) === index)

  if (hostPermissions === null) {
    violations.push({
      code: 'MANIFEST_REQUIRED_HOST_PERMISSIONS',
      target,
      path: manifestPath,
      message: 'host_permissions must be absent or an empty string array'
    })
  } else if (requiredHostPermissions.length > 0) {
    violations.push({
      code: 'MANIFEST_REQUIRED_HOST_PERMISSIONS',
      target,
      path: manifestPath,
      message: `required host permissions are forbidden: ${requiredHostPermissions.join(', ')}`
    })
  }

  const webAccessibleResourceCount = countManifestEntries(
    record?.['web_accessible_resources'],
    'web_accessible_resources',
    target,
    manifestPath,
    'MANIFEST_WEB_ACCESSIBLE_RESOURCES',
    violations
  )
  const contentScriptCount = countManifestEntries(
    record?.['content_scripts'],
    'content_scripts',
    target,
    manifestPath,
    'MANIFEST_CONTENT_SCRIPTS',
    violations
  )

  return {
    path: manifestPath,
    requiredHostPermissions,
    webAccessibleResourceCount,
    contentScriptCount,
    passed: violations.length === 0,
    violations
  }
}

export function evaluateProductionOutput(
  config: ProductionOutputConfig,
  manifest: unknown,
  sources: BundleSources
): ProductionOutputReport {
  const manifestPath = path.join(config.outputRoot, 'manifest.json')
  const manifestCheck = validateProductionManifest(manifest, config.target, manifestPath)
  const bundles = BUNDLE_BUDGETS.map((definition) =>
    measureBundle(definition, sources[definition.id])
  )
  const violations = [...manifestCheck.violations]

  for (const bundle of bundles) {
    if (bundle.passed) continue
    const bundlePath = path.join(config.outputRoot, bundle.relativePath)
    violations.push({
      code: 'BUNDLE_RAW_BUDGET_EXCEEDED',
      target: config.target,
      path: bundlePath,
      message: `${bundle.id} raw size ${bundle.rawBytes} exceeds budget ${bundle.maxRawBytes} bytes`
    })
  }

  return {
    target: config.target,
    outputRoot: config.outputRoot,
    enforcedMetric: 'rawBytes',
    bundles,
    manifest: manifestCheck,
    passed: violations.length === 0,
    violations
  }
}

export async function inspectProductionOutput(
  config: ProductionOutputConfig,
  cwd = process.cwd()
): Promise<ProductionOutputReport> {
  const resolvedOutputRoot = path.resolve(cwd, config.outputRoot)
  const manifestPath = path.join(resolvedOutputRoot, 'manifest.json')
  const [manifestSource, background, content, pageMain] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(path.join(resolvedOutputRoot, 'background.js')),
    readFile(path.join(resolvedOutputRoot, 'content-scripts/content.js')),
    readFile(path.join(resolvedOutputRoot, 'content-scripts/page-main.js'))
  ])
  const manifest = JSON.parse(manifestSource) as unknown

  return evaluateProductionOutput(config, manifest, {
    background,
    content,
    'page-main': pageMain
  })
}

export function createBundleBudgetSummary(
  outputs: readonly ProductionOutputReport[]
): BundleBudgetSummary {
  const violations = outputs.flatMap((output) => output.violations)
  return {
    schemaVersion: 1,
    enforcedMetric: 'rawBytes',
    gzipCompressionLevel: GZIP_LEVEL,
    budgets: BUNDLE_BUDGETS.map((budget) => ({ ...budget })),
    outputs: [...outputs],
    passed: violations.length === 0,
    violations
  }
}

export function resolveProductionOutputs(args: readonly string[]): ProductionOutputConfig[] {
  if (args.length === 0) return DEFAULT_PRODUCTION_OUTPUTS.map((output) => ({ ...output }))
  return args.map((outputRoot) => ({
    target: path.basename(path.resolve(outputRoot)),
    outputRoot
  }))
}

function failedOutputReport(
  config: ProductionOutputConfig,
  error: unknown
): ProductionOutputReport {
  const manifestPath = path.join(config.outputRoot, 'manifest.json')
  const message = error instanceof Error ? error.message : String(error)
  const violation: BudgetViolation = {
    code: 'OUTPUT_INSPECTION_FAILED',
    target: config.target,
    path: config.outputRoot,
    message
  }
  return {
    target: config.target,
    outputRoot: config.outputRoot,
    enforcedMetric: 'rawBytes',
    bundles: [],
    manifest: {
      path: manifestPath,
      requiredHostPermissions: [],
      webAccessibleResourceCount: null,
      contentScriptCount: null,
      passed: false,
      violations: [violation]
    },
    passed: false,
    violations: [violation]
  }
}

export async function runBundleBudgetCli(
  args: readonly string[],
  cwd = process.cwd(),
  dependencies: CliDependencies = {}
): Promise<0 | 1> {
  const inspectOutput = dependencies.inspectOutput ?? inspectProductionOutput
  const writeOutput = dependencies.writeOutput ?? console.log
  const configs = resolveProductionOutputs(args)
  const outputs = await Promise.all(
    configs.map(async (config) => {
      try {
        return await inspectOutput(config, cwd)
      } catch (error) {
        return failedOutputReport(config, error)
      }
    })
  )
  const summary = createBundleBudgetSummary(outputs)
  writeOutput(JSON.stringify(summary))
  return summary.passed ? 0 : 1
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  return (
    invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  )
}

if (isDirectExecution()) {
  process.exitCode = await runBundleBudgetCli(process.argv.slice(2))
}
