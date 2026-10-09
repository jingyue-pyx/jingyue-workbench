import { parsePlan, type SourceFiles, type TaskPlan } from './protocol';
import { sourceRevision, sourceSnapshot } from './source-revision';

export interface CandidateResume {
  baseRevision: string;
  files: SourceFiles;
  plan: TaskPlan;
}

const retrySuffix = /(?:\s*继续此前任务，保留现有草稿，检查并修复未通过的问题。)+\s*$/;
export const recoveryTask = (task: string) => task.replace(retrySuffix, '').trim();

export async function candidateContext(
  task: string,
  base: SourceFiles,
  files: SourceFiles,
  plan: TaskPlan,
): Promise<SourceFiles> {
  return {
    version: '1',
    task: recoveryTask(task),
    baseRevision: await sourceRevision(base),
    candidateRevision: await sourceRevision(files),
    plan: JSON.stringify(plan),
  };
}

/** Account/project scoping belongs to checkpoint storage. Hashes bind its two records. */
export async function restoreCandidate(
  task: string,
  base: SourceFiles,
  files?: SourceFiles,
  context?: SourceFiles,
): Promise<CandidateResume | undefined> {
  if (!files || !context || context.version !== '1' || context.task !== recoveryTask(task)) {
    return undefined;
  }

  if (
    context.baseRevision !== (await sourceRevision(base)) ||
    context.candidateRevision !== (await sourceRevision(files))
  ) {
    return undefined;
  }

  try {
    const plan = parsePlan(context.plan, { finalizing: true });

    if (!plan.supported) {
      return undefined;
    }

    return { baseRevision: context.baseRevision, files: sourceSnapshot(files), plan };
  } catch {
    // Legacy/incomplete/corrupt metadata never auto-approves a plan or writes files.
    return undefined;
  }
}
