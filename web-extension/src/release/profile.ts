export const RELEASE_CHANNELS = ['dev', 'alpha', 'beta', 'rc', 'stable'] as const

export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

export type ParsedExtensionVersion = Readonly<{
  major: number
  minor: number
  patch: number
  prereleaseChannel: Exclude<ReleaseChannel, 'stable'> | null
  prereleaseSequence: number | null
}>

export type ReleaseProfile = Readonly<{
  schemaVersion: 1
  channel: ReleaseChannel
  sequence: number
  packageVersion: string
  releaseVersion: string
  manifestVersion: string
  manifestName: string
  manifestDescription: string
  production: boolean
}>

const MANIFEST_VERSION_PART_MAX = 65_535
const RELEASE_SEQUENCE_MAX = 9_999
const CHANNEL_VERSION_BASE: Readonly<Record<ReleaseChannel, number>> = Object.freeze({
  dev: 10_000,
  alpha: 20_000,
  beta: 30_000,
  rc: 40_000,
  stable: 60_000
})

const PROFILE_COPY: Readonly<
  Record<ReleaseChannel, Readonly<{ name: string; description: string; production: boolean }>>
> = Object.freeze({
  dev: {
    name: 'H5Player Web Extension (Dev)',
    description: 'H5Player 的独立 Manifest V3 Web Extension 开发构建',
    production: false
  },
  alpha: {
    name: 'H5Player Web Extension (Alpha)',
    description: 'H5Player 的独立 Manifest V3 Web Extension Alpha 候选构建',
    production: true
  },
  beta: {
    name: 'H5Player Web Extension (Beta)',
    description: 'H5Player 的独立 Manifest V3 Web Extension Beta 候选构建',
    production: true
  },
  rc: {
    name: 'H5Player Web Extension (RC)',
    description: 'H5Player 的独立 Manifest V3 Web Extension 发布候选构建',
    production: true
  },
  stable: {
    name: 'H5Player Web Extension',
    description: 'H5Player 的独立 Manifest V3 Web Extension',
    production: true
  }
})

function parseVersionPart(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MANIFEST_VERSION_PART_MAX) {
    throw new Error(`${label} must be an integer between 0 and ${MANIFEST_VERSION_PART_MAX}`)
  }
  return parsed
}

function parsePrerelease(
  value: string | undefined
): Pick<ParsedExtensionVersion, 'prereleaseChannel' | 'prereleaseSequence'> {
  if (value === undefined) {
    return { prereleaseChannel: null, prereleaseSequence: null }
  }

  const [channelValue, sequenceValue, ...rest] = value.split('.')
  if (
    rest.length > 0 ||
    channelValue === undefined ||
    channelValue === 'stable' ||
    !RELEASE_CHANNELS.includes(channelValue as ReleaseChannel)
  ) {
    throw new Error('Prerelease version must use dev.N, alpha.N, beta.N, or rc.N')
  }
  if (sequenceValue === undefined || !/^(?:0|[1-9]\d*)$/.test(sequenceValue)) {
    throw new Error('Prerelease version must include a numeric sequence')
  }
  const sequence = Number(sequenceValue)
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > RELEASE_SEQUENCE_MAX) {
    throw new Error(`Prerelease sequence must be between 0 and ${RELEASE_SEQUENCE_MAX}`)
  }
  return {
    prereleaseChannel: channelValue as Exclude<ReleaseChannel, 'stable'>,
    prereleaseSequence: sequence
  }
}

export function parseExtensionVersion(version: string): ParsedExtensionVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (!match) {
    throw new Error('Extension version must be SemVer without build metadata')
  }
  const [, majorValue, minorValue, patchValue, prereleaseValue] = match
  if (majorValue === undefined || minorValue === undefined || patchValue === undefined) {
    throw new Error('Extension version is missing a numeric component')
  }
  return {
    major: parseVersionPart(majorValue, 'major'),
    minor: parseVersionPart(minorValue, 'minor'),
    patch: parseVersionPart(patchValue, 'patch'),
    ...parsePrerelease(prereleaseValue)
  }
}

export function parseReleaseChannel(value: string | undefined): ReleaseChannel {
  const channel = value ?? 'dev'
  if (!RELEASE_CHANNELS.includes(channel as ReleaseChannel)) {
    throw new Error(`Unsupported release channel: ${channel}`)
  }
  return channel as ReleaseChannel
}

export function parseReleaseSequence(value: string | number | undefined): number {
  if (value === undefined) return 0
  if (typeof value === 'string' && !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Release sequence must be between 0 and ${RELEASE_SEQUENCE_MAX}`)
  }
  const sequence = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > RELEASE_SEQUENCE_MAX) {
    throw new Error(`Release sequence must be between 0 and ${RELEASE_SEQUENCE_MAX}`)
  }
  return sequence
}

export function resolveReleaseProfile(
  input: Readonly<{
    packageVersion: string
    channel?: string
    sequence?: string | number
  }>
): ReleaseProfile {
  const parsed = parseExtensionVersion(input.packageVersion)
  const channel = parseReleaseChannel(input.channel)
  const requestedSequence = parseReleaseSequence(input.sequence)

  if (channel === 'stable' && requestedSequence !== 0) {
    throw new Error('Stable profile does not accept a release sequence')
  }
  if (parsed.prereleaseChannel !== null && parsed.prereleaseChannel !== channel) {
    throw new Error(
      `Package prerelease channel ${parsed.prereleaseChannel} does not match profile ${channel}`
    )
  }
  if (parsed.prereleaseChannel !== null && channel === 'stable') {
    throw new Error('Stable profile requires a non-prerelease package version')
  }

  const sequence = parsed.prereleaseSequence ?? requestedSequence
  if (
    parsed.prereleaseSequence !== null &&
    requestedSequence !== 0 &&
    requestedSequence !== sequence
  ) {
    throw new Error('Package prerelease sequence does not match the requested release sequence')
  }

  const releaseVersion =
    channel === 'stable' || parsed.prereleaseChannel !== null
      ? input.packageVersion
      : `${input.packageVersion}-${channel}.${sequence}`
  const fourthPart = CHANNEL_VERSION_BASE[channel] + sequence
  if (fourthPart > MANIFEST_VERSION_PART_MAX) {
    throw new Error('Release channel and sequence exceed the browser manifest version limit')
  }
  const copy = PROFILE_COPY[channel]

  return Object.freeze({
    schemaVersion: 1,
    channel,
    sequence,
    packageVersion: input.packageVersion,
    releaseVersion,
    manifestVersion: `${parsed.major}.${parsed.minor}.${parsed.patch}.${fourthPart}`,
    manifestName: copy.name,
    manifestDescription: copy.description,
    production: copy.production
  })
}

export function artifactFileName(
  profile: Pick<ReleaseProfile, 'releaseVersion'>,
  browser: 'chrome' | 'firefox'
): string {
  return `h5player-webext-${profile.releaseVersion}-${browser}.zip`
}
