import { describe, it, expect, vi } from 'vitest';
import { failureCode, FAILURE_REASONS } from './failure-code';
import { parsePatch, RunError, type RunState } from './protocol';
import { runMessage, runtimeEvent, reportRuntime } from './presentation';
import { parseOutcomeAnnotation } from './outcome';

describe('safe failure classification', () => {
  it.each([
    [new RunError('private-canary', false, 'unsafe-path'), 'unsafe_path'],
    [new RunError('private-canary', false, 'protected-config'), 'protected_config'],
    [new RunError('private-canary', false, 'source-size'), 'source_size'],
    [new RunError('private-canary', false, 'recovery-storage'), 'recovery_storage'],
    [new DOMException('private-canary', 'DataCloneError'), 'recovery_storage'],
    [new DOMException('private-canary', 'QuotaExceededError'), 'storage_quota'],
    [new TypeError('private-canary'), 'internal_type'],
    [new ReferenceError('private-canary'), 'internal_reference'],
    [new Error('private-canary'), 'internal_error'],
  ])('preserves a finite reason for %s', (error, code) => {
    expect(failureCode(error)).toBe(code);

    const state: RunState = {
      id: '8c1e4b17-f6e4-4d7a-9e29-a50174634828',
      phase: 'failed',
      failureCode: code as string,
      detail: 'private-canary',
      errors: ['private-canary'],
      changed: [],
      events: [{ phase: 'generating', detail: '', at: 1 }],
      attempt: 0,
      maxRepairs: 2,
      startedAt: 1,
    };
    expect(runMessage(state)).toContain(FAILURE_REASONS[code as keyof typeof FAILURE_REASONS]);
    expect(runMessage(state)).not.toContain('private-canary');
    expect(runtimeEvent(state).reason).toBe(code);
    expect(parseOutcomeAnnotation(`managed-outcome:failed:generating:${code}:0`)?.reasonCode).toBe(code);
  });
  it('keeps unsafe paths, limits and protected config non-repairable', () => {
    for (const [file, previous, category] of [
      [{ path: '../outside', content: 'x' }, {}, 'unsafe-path'],
      [{ path: 'a.ts', content: 'x'.repeat(250001) }, {}, 'source-size'],
      [{ path: 'tsconfig.json', content: '{}' }, { 'tsconfig.json': '{"strict":true}' }, 'protected-config'],
    ] as const) {
      try {
        parsePatch(JSON.stringify({ summary: 'x', files: [file] }), previous);
        expect.fail('unsafe candidate should fail');
      } catch (error) {
        expect(error).toMatchObject({ category, repairable: false });
      }
    }
  });
  it('logs only allowlisted metadata, even for an unrecognized error code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    try {
      await reportRuntime({
        id: '',
        phase: 'failed',
        failureCode: 'private-canary',
        detail: 'private-canary',
        errors: [],
        changed: [],
        events: [],
        attempt: 0,
        maxRepairs: 2,
        startedAt: 1,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-canary');
      expect(JSON.stringify(fetcher.mock.calls)).not.toContain('private-canary');
    } finally {
      warn.mockRestore();
      fetcher.mockRestore();
    }
  });
});
