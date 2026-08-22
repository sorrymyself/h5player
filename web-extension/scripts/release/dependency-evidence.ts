import { createRequire } from 'node:module'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { ReleaseProfile } from '../../src/release'
import type { WebExtensionPackage } from './package-metadata'
import { sha256 } from './hash'

type PackageJson = Readonly<{
  name: string
  version: string
  license: string
  homepage: string | null
  repository: string | null
  dependencies: Readonly<Record<string, string>>
}>

export type RuntimeDependency = Readonly<{
  key: string
  spdxId: string
  name: string
  version: string
  license: string
  homepage: string | null
  repository: string | null
  dependencies: readonly string[]
}>

export type RuntimeDependencyGraph = Readonly<{
  rootDependencies: readonly string[]
  packages: readonly RuntimeDependency[]
}>

const APPROVED_RUNTIME_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC'
])

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({})
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return Object.freeze(result)
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const url = (value as Record<string, unknown>)['url']
    if (typeof url === 'string' && url.length > 0) return url
  }
  return null
}

function licenseExpression(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const type = (value as Record<string, unknown>)['type']
    if (typeof type === 'string' && type.trim().length > 0) return type.trim()
  }
  return 'NOASSERTION'
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
  if (typeof parsed['name'] !== 'string' || typeof parsed['version'] !== 'string') {
    throw new Error(`Dependency package.json is missing name/version: ${filePath}`)
  }
  return Object.freeze({
    name: parsed['name'],
    version: parsed['version'],
    license: licenseExpression(parsed['license'] ?? parsed['licenses']),
    homepage: typeof parsed['homepage'] === 'string' ? parsed['homepage'] : null,
    repository: repositoryUrl(parsed['repository']),
    dependencies: stringRecord(parsed['dependencies'])
  })
}

async function resolveDependencyPackageJson(
  dependencyName: string,
  parentPackageJson: string,
  cwd: string
): Promise<string> {
  const parentDirectory = path.dirname(parentPackageJson)
  const segments = dependencyName.split('/')
  const candidates = [path.join(parentDirectory, 'node_modules', ...segments, 'package.json')]
  let ancestor = parentDirectory
  while (path.dirname(ancestor) !== ancestor) {
    if (path.basename(ancestor) === 'node_modules') {
      candidates.push(path.join(ancestor, ...segments, 'package.json'))
    }
    ancestor = path.dirname(ancestor)
  }
  candidates.push(path.join(cwd, 'node_modules', ...segments, 'package.json'))
  for (const candidate of candidates) {
    try {
      return await realpath(candidate)
    } catch {
      // Continue to Node resolution for non-standard layouts.
    }
  }

  const requireFromParent = createRequire(parentPackageJson)
  try {
    return await realpath(requireFromParent.resolve(`${dependencyName}/package.json`))
  } catch {
    throw new Error(`Cannot resolve runtime dependency ${dependencyName} from ${parentPackageJson}`)
  }
}

function dependencyKey(name: string, version: string): string {
  return `${name}@${version}`
}

function spdxPackageId(key: string): string {
  return `SPDXRef-Package-${sha256(key).slice(0, 20)}`
}

export async function collectRuntimeDependencyGraph(
  packageMetadata: WebExtensionPackage,
  cwd = process.cwd()
): Promise<RuntimeDependencyGraph> {
  const rootPackageJson = path.join(cwd, 'package.json')
  const packages = new Map<string, RuntimeDependency>()
  const packagePaths = new Map<string, string>()

  const visit = async (packageJsonPath: string): Promise<string> => {
    const metadata = await readPackageJson(packageJsonPath)
    const key = dependencyKey(metadata.name, metadata.version)
    const existingPath = packagePaths.get(key)
    if (existingPath !== undefined) {
      if (existingPath !== packageJsonPath) {
        throw new Error(`Dependency identity collision for ${key}`)
      }
      return key
    }
    packagePaths.set(key, packageJsonPath)
    packages.set(key, {
      key,
      spdxId: spdxPackageId(key),
      name: metadata.name,
      version: metadata.version,
      license: metadata.license,
      homepage: metadata.homepage,
      repository: metadata.repository,
      dependencies: Object.freeze([])
    })

    const dependencies: string[] = []
    for (const dependencyName of Object.keys(metadata.dependencies).sort()) {
      const dependencyPath = await resolveDependencyPackageJson(
        dependencyName,
        packageJsonPath,
        cwd
      )
      dependencies.push(await visit(dependencyPath))
    }
    const current = packages.get(key)
    if (current === undefined) throw new Error(`Dependency graph lost ${key}`)
    packages.set(key, {
      ...current,
      dependencies: Object.freeze([...new Set(dependencies)].sort())
    })
    return key
  }

  const rootDependencies: string[] = []
  for (const dependencyName of Object.keys(packageMetadata.dependencies).sort()) {
    const dependencyPath = await resolveDependencyPackageJson(dependencyName, rootPackageJson, cwd)
    rootDependencies.push(await visit(dependencyPath))
  }

  return Object.freeze({
    rootDependencies: Object.freeze([...new Set(rootDependencies)].sort()),
    packages: Object.freeze(
      [...packages.values()].sort((left, right) => left.key.localeCompare(right.key, 'en'))
    )
  })
}

function packageExternalReference(value: RuntimeDependency): readonly Record<string, string>[] {
  const locator = value.repository ?? value.homepage
  return locator
    ? Object.freeze([
        Object.freeze({
          referenceCategory: 'OTHER',
          referenceLocator: locator,
          referenceType: 'website'
        })
      ])
    : Object.freeze([])
}

export function createSpdxDocument(
  input: Readonly<{
    packageMetadata: WebExtensionPackage
    profile: ReleaseProfile
    graph: RuntimeDependencyGraph
    sourceDateIso: string
    lockfileSha256: string
  }>
): Readonly<Record<string, unknown>> {
  const rootSpdxId = 'SPDXRef-Package-H5Player-WebExtension'
  const namespace = `https://github.com/xxxily/h5player/releases/spdx/${encodeURIComponent(
    input.profile.releaseVersion
  )}/${input.lockfileSha256}`
  const relationships: Record<string, string>[] = input.graph.rootDependencies.map((target) => ({
    spdxElementId: rootSpdxId,
    relatedSpdxElement: spdxPackageId(target),
    relationshipType: 'DEPENDS_ON'
  }))
  for (const dependency of input.graph.packages) {
    for (const target of dependency.dependencies) {
      relationships.push({
        spdxElementId: dependency.spdxId,
        relatedSpdxElement: spdxPackageId(target),
        relationshipType: 'DEPENDS_ON'
      })
    }
  }

  return Object.freeze({
    SPDXID: 'SPDXRef-DOCUMENT',
    creationInfo: {
      created: input.sourceDateIso,
      creators: ['Tool: h5player-webext-release/1']
    },
    dataLicense: 'CC0-1.0',
    documentDescribes: [rootSpdxId],
    documentNamespace: namespace,
    name: `h5player-webext-${input.profile.releaseVersion}`,
    packages: [
      {
        SPDXID: rootSpdxId,
        copyrightText: 'NOASSERTION',
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: input.packageMetadata.license,
        licenseDeclared: input.packageMetadata.license,
        name: input.packageMetadata.name,
        versionInfo: input.profile.releaseVersion
      },
      ...input.graph.packages.map((dependency) => ({
        SPDXID: dependency.spdxId,
        copyrightText: 'NOASSERTION',
        downloadLocation: 'NOASSERTION',
        externalRefs: packageExternalReference(dependency),
        filesAnalyzed: false,
        licenseConcluded: dependency.license,
        licenseDeclared: dependency.license,
        name: dependency.name,
        versionInfo: dependency.version
      }))
    ],
    relationships: relationships.sort((left, right) =>
      `${left['spdxElementId']}:${left['relatedSpdxElement']}`.localeCompare(
        `${right['spdxElementId']}:${right['relatedSpdxElement']}`,
        'en'
      )
    ),
    spdxVersion: 'SPDX-2.3'
  })
}

export function createThirdPartyLicenseReport(graph: RuntimeDependencyGraph): string {
  const lines = [
    'H5Player Web Extension — Third-Party License Inventory',
    '',
    'Evidence boundary: runtime dependency closure declared by web-extension/package.json.',
    'Build/test-only dependencies are covered by pnpm-lock.yaml hash and full CI audit; explicit temporary advisory exceptions are governed by project risk records.',
    ''
  ]
  for (const dependency of graph.packages) {
    lines.push(`${dependency.name}@${dependency.version}`)
    lines.push(`License: ${dependency.license}`)
    if (dependency.repository) lines.push(`Repository: ${dependency.repository}`)
    else if (dependency.homepage) lines.push(`Homepage: ${dependency.homepage}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function assertRuntimeLicensePolicy(graph: RuntimeDependencyGraph): void {
  const violations = graph.packages.filter(
    (dependency) => !APPROVED_RUNTIME_LICENSES.has(dependency.license)
  )
  if (violations.length > 0) {
    throw new Error(
      `Runtime dependency license review required: ${violations
        .map((dependency) => `${dependency.key} (${dependency.license})`)
        .join(', ')}`
    )
  }
}
