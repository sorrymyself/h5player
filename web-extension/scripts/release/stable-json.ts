function normalizeJson(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJson(entry, `${path}[${index}]`))
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry === undefined) throw new Error(`Undefined JSON value at ${path}.${key}`)
      normalized[key] = normalizeJson(entry, `${path}.${key}`)
    }
    return normalized
  }
  throw new Error(`Unsupported JSON value at ${path}`)
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(normalizeJson(value, '$'), null, 2)}\n`
}
