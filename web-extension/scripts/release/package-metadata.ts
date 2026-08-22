import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type WebExtensionPackage = Readonly<{
  name: string
  version: string
  license: string
  packageManager: string
  dependencies: Readonly<Record<string, string>>
  devDependencies: Readonly<Record<string, string>>
}>

export const RELEASE_TOOLCHAIN = Object.freeze({
  node: 'v24.13.0',
  packageManager: 'pnpm@11.21.0',
  wxt: '0.21.3'
})

function asStringRecord(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new Error(`${label}.${key} must be a string`)
    result[key] = entry
  }
  return result
}

export async function readWebExtensionPackage(cwd = process.cwd()): Promise<WebExtensionPackage> {
  const packagePath = path.join(cwd, 'package.json')
  const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
  if (
    typeof parsed['name'] !== 'string' ||
    typeof parsed['version'] !== 'string' ||
    typeof parsed['license'] !== 'string' ||
    typeof parsed['packageManager'] !== 'string'
  ) {
    throw new Error('package.json must define name, version, license, and packageManager strings')
  }
  return Object.freeze({
    name: parsed['name'],
    version: parsed['version'],
    license: parsed['license'],
    packageManager: parsed['packageManager'],
    dependencies: Object.freeze(asStringRecord(parsed['dependencies'], 'dependencies')),
    devDependencies: Object.freeze(asStringRecord(parsed['devDependencies'], 'devDependencies'))
  })
}

export function assertReleaseToolchain(
  packageMetadata: WebExtensionPackage,
  nodeVersion = process.version
): void {
  if (nodeVersion !== RELEASE_TOOLCHAIN.node) {
    throw new Error(
      `Release Node version must be ${RELEASE_TOOLCHAIN.node}, received ${nodeVersion}`
    )
  }
  if (packageMetadata.packageManager !== RELEASE_TOOLCHAIN.packageManager) {
    throw new Error(
      `Release package manager must be ${RELEASE_TOOLCHAIN.packageManager}, received ${packageMetadata.packageManager}`
    )
  }
  if (packageMetadata.devDependencies['wxt'] !== RELEASE_TOOLCHAIN.wxt) {
    throw new Error(
      `Release WXT version must be ${RELEASE_TOOLCHAIN.wxt}, received ${String(
        packageMetadata.devDependencies['wxt']
      )}`
    )
  }
}
