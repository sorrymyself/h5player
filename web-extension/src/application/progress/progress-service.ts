import { failure, type Result } from '../../shared/result'
import { createProgressIdentity } from '../../domain/progress'
import type {
  ProgressDeleteInput,
  ProgressDeleteResult,
  ProgressError,
  ProgressReadInput,
  ProgressReadResult,
  ProgressRepositoryPort,
  ProgressSaveInput,
  ProgressSaveResult,
  ProgressPruneResult
} from './progress-port'

const DEFAULT_SOURCE = 'progress-service'

export class ProgressService {
  constructor(private readonly repository: ProgressRepositoryPort) {}

  async save(
    input: ProgressSaveInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressSaveResult, ProgressError>> {
    const identity = createProgressIdentity(input)
    if (!identity.ok) return failure(identity.error)
    return this.repository.saveProgress(
      identity.value,
      {
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds ?? null
      },
      source
    )
  }

  async read(
    input: ProgressReadInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressReadResult, ProgressError>> {
    const identity = createProgressIdentity(input)
    if (!identity.ok) return failure(identity.error)
    return this.repository.readProgress(identity.value, source)
  }

  async delete(
    input: ProgressDeleteInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressDeleteResult, ProgressError>> {
    const identity = createProgressIdentity(input)
    if (!identity.ok) return failure(identity.error)
    return this.repository.deleteProgress(identity.value, source)
  }

  prune(source = DEFAULT_SOURCE): Promise<Result<ProgressPruneResult, ProgressError>> {
    return this.repository.pruneProgress(source)
  }

  saveProgress(
    input: ProgressSaveInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressSaveResult, ProgressError>> {
    return this.save(input, source)
  }

  readProgress(
    input: ProgressReadInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressReadResult, ProgressError>> {
    return this.read(input, source)
  }

  deleteProgress(
    input: ProgressDeleteInput,
    source = DEFAULT_SOURCE
  ): Promise<Result<ProgressDeleteResult, ProgressError>> {
    return this.delete(input, source)
  }

  pruneProgress(source = DEFAULT_SOURCE): Promise<Result<ProgressPruneResult, ProgressError>> {
    return this.prune(source)
  }
}
