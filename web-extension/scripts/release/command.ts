import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function captureCommand(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  return result.stdout.trim()
}

export async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: environment,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}
