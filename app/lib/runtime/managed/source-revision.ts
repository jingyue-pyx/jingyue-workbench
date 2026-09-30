import { RunError, type SourceFiles } from './protocol';

/** Immutable model input. A revision includes names and exact bytes, not just manual-edit counters. */
export async function sourceRevision(files: SourceFiles): Promise<string> {
  const content = JSON.stringify(
    Object.keys(files)
      .sort()
      .map((path) => [path, files[path]]),
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function sourceSnapshot(files: SourceFiles): SourceFiles {
  return Object.freeze({ ...files });
}

export function assertSameSources(expected: SourceFiles, current: SourceFiles) {
  const paths = Object.keys(expected);

  if (paths.length !== Object.keys(current).length || paths.some((path) => expected[path] !== current[path])) {
    throw new RunError('当前源码版本已变化，本轮候选未提交；请基于最新源码重试。', false, 'source-conflict');
  }
}
