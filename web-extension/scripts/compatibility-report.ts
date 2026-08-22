import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SITE_ADAPTER_DEFINITIONS } from '../src/adapters/sites'

export type CompatibilityReportEntry = {
  readonly id: string
  readonly version: string
  readonly tier: 1 | 2
  readonly supportLevel: 'preview' | 'best-effort'
  readonly owner: string
  readonly fixture: string
  readonly lastVerified: string
  readonly fixturePresent: boolean
  readonly fixtureSha256: string | null
  readonly status: 'fixture-verified' | 'fixture-missing'
}

type BaselineEntry = Pick<
  CompatibilityReportEntry,
  | 'id'
  | 'version'
  | 'tier'
  | 'supportLevel'
  | 'owner'
  | 'fixture'
  | 'lastVerified'
  | 'fixtureSha256'
>

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_VERIFICATION_AGE_DAYS = 183

export type CompatibilityReport = Readonly<{
  schemaVersion: 1
  generatedAt: string
  evidenceBoundary: 'sanitized-fixture-only'
  liveSmoke: 'not-verified'
  entries: readonly CompatibilityReportEntry[]
}>

function verificationTimestamp(value: string, id: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid verification date: ${id}`)
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid verification date: ${id}`)
  }
  return timestamp
}

function assertCatalog(now: number): void {
  const ids = new Set<string>()
  for (const definition of SITE_ADAPTER_DEFINITIONS) {
    if (ids.has(definition.id)) throw new Error(`Duplicate adapter id: ${definition.id}`)
    ids.add(definition.id)
    if (definition.owner.trim() === '') throw new Error(`Missing owner: ${definition.id}`)
    const verifiedAt = verificationTimestamp(definition.lastVerified, definition.id)
    const ageDays = Math.floor((now - verifiedAt) / DAY_MS)
    // Allow one calendar day of timezone skew between a maintainer's local date
    // and a UTC CI runner, but reject genuinely future-dated evidence.
    if (ageDays < -1) {
      throw new Error(`Verification date is in the future: ${definition.id}`)
    }
    if (ageDays > MAX_VERIFICATION_AGE_DAYS) {
      throw new Error(`Site adapter verification is stale (${ageDays} days): ${definition.id}`)
    }
  }
}

export async function createCompatibilityReport(
  now = Date.now(),
  cwd = process.cwd()
): Promise<CompatibilityReport> {
  assertCatalog(now)
  const baselinePath = path.resolve(cwd, 'tests/baselines/site-adapters.json')
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
    readonly schemaVersion: number
    readonly evidenceBoundary: string
    readonly liveSmoke: string
    readonly entries: readonly BaselineEntry[]
  }
  if (baseline.schemaVersion !== 1) throw new Error('Unsupported adapter baseline schema')
  if (
    baseline.evidenceBoundary !== 'sanitized-fixture-only' ||
    baseline.liveSmoke !== 'not-verified'
  ) {
    throw new Error('Adapter baseline overstates its verification boundary')
  }
  const baselineById = new Map(baseline.entries.map((entry) => [entry.id, entry]))
  const entries: CompatibilityReportEntry[] = []
  for (const definition of SITE_ADAPTER_DEFINITIONS) {
    const fixture = path.resolve(cwd, 'tests/fixtures/sites', definition.fixture)
    let fixturePresent = true
    let fixtureSha256: string | null = null
    try {
      const content = await readFile(fixture)
      fixtureSha256 = createHash('sha256').update(content).digest('hex')
    } catch {
      fixturePresent = false
    }
    entries.push({
      id: definition.id,
      version: definition.version,
      tier: definition.tier,
      supportLevel: definition.supportLevel,
      owner: definition.owner,
      fixture: definition.fixture,
      lastVerified: definition.lastVerified,
      fixturePresent,
      fixtureSha256,
      status: fixturePresent ? 'fixture-verified' : 'fixture-missing'
    })
    const expected = baselineById.get(definition.id)
    if (
      expected === undefined ||
      expected.version !== definition.version ||
      expected.tier !== definition.tier ||
      expected.supportLevel !== definition.supportLevel ||
      expected.owner !== definition.owner ||
      expected.fixture !== definition.fixture ||
      expected.lastVerified !== definition.lastVerified ||
      expected.fixtureSha256 !== fixtureSha256
    ) {
      throw new Error(
        `Adapter catalog drift requires an explicit baseline update: ${definition.id}`
      )
    }
  }
  if (baseline.entries.length !== entries.length) {
    throw new Error('Adapter baseline/catalog entry count differs')
  }

  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    evidenceBoundary: 'sanitized-fixture-only' as const,
    liveSmoke: 'not-verified' as const,
    entries: Object.freeze(entries)
  })
}

export function createCompatibilityReportHtml(report: CompatibilityReport): string {
  const escapeHtml = (value: string | number): string =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  const rows = report.entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.id)}</td><td>${escapeHtml(entry.tier)}</td><td>${escapeHtml(entry.supportLevel)}</td><td>${escapeHtml(entry.version)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.lastVerified)}</td></tr>`
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>H5Player compatibility evidence</title></head>
<body>
<h1>H5Player Web Extension compatibility evidence</h1>
<p>Generated: ${escapeHtml(report.generatedAt)}</p>
<p>Boundary: ${escapeHtml(report.evidenceBoundary)}; live site smoke: ${escapeHtml(report.liveSmoke)}.</p>
<table><thead><tr><th>Adapter</th><th>Tier</th><th>Support</th><th>Version</th><th>Fixture</th><th>Last verified</th></tr></thead><tbody>${rows}</tbody></table>
</body>
</html>
`
}

function sourceDateNow(): number {
  const sourceDateEpoch = process.env['SOURCE_DATE_EPOCH']
  if (sourceDateEpoch === undefined) return Date.now()
  const parsed = Number(sourceDateEpoch)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer')
  }
  return parsed * 1_000
}

async function main(): Promise<void> {
  const report = await createCompatibilityReport(sourceDateNow())
  const missing = report.entries.filter((entry) => !entry.fixturePresent)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (missing.length > 0) {
    throw new Error(`Missing site adapter fixtures: ${missing.map((entry) => entry.id).join(', ')}`)
  }
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  return (
    invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  )
}

if (isDirectExecution()) void main()
