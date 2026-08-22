export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'application/json;charset=utf-8'
): void {
  const objectUrl = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
