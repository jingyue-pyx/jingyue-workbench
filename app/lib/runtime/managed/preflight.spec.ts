import { describe, expect, it } from 'vitest';
import { validateCandidate } from './preflight';
import { STYLED_REACT_VITE_TEMPLATE } from './template';
import { assertSameSources, sourceRevision, sourceSnapshot } from './source-revision';
import type { SourceFiles } from './protocol';

describe('candidate preflight and revision identity', () => {
  it('parses the supported typed template without executing source', () => {
    expect(() =>
      validateCandidate({
        ...STYLED_REACT_VITE_TEMPLATE,
        'src/check.ts': 'throw new Error("never execute generated code")',
      }),
    ).not.toThrow();
  });
  it('rejects broken JSX before writes with a bounded location, not raw source', () => {
    try {
      validateCandidate({
        ...STYLED_REACT_VITE_TEMPLATE,
        'src/App.tsx': 'export default function App(){return <main title="private-canary"><h1>test</main>}',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ category: 'syntax', repairable: true });
      expect((error as Error).message).toContain('src/App.tsx:1:');
      expect((error as Error).message).not.toContain('private-canary');
    }
  });
  it('rejects imports and utility configuration before execution', () => {
    expect(() =>
      validateCandidate({
        ...STYLED_REACT_VITE_TEMPLATE,
        'src/App.tsx': 'import Missing from "missing-lib"; export default function App(){return <Missing/>}',
      }),
    ).toThrow('未声明的依赖');

    const files: SourceFiles = {
      ...STYLED_REACT_VITE_TEMPLATE,
      'src/App.tsx': 'export default function App(){return <div className="flex gap-4 p-8 text-red-500"/>}',
    };
    delete files['postcss.config.cjs'];
    expect(() => validateCandidate(files)).toThrow();
  });
  it('has stable hashes independent of enumeration order and detects exact byte changes', async () => {
    expect(await sourceRevision({ b: '2', a: '1' })).toBe(await sourceRevision({ a: '1', b: '2' }));
    expect(await sourceRevision({ a: '1' })).not.toBe(await sourceRevision({ a: '1 ' }));
    expect(await sourceRevision({ a: '1' })).not.toBe(await sourceRevision({ b: '1' }));
    expect(await sourceRevision({ a: '1' })).not.toBe(await sourceRevision({ a: '1', b: '' }));
  });
  it('isolates a snapshot and rejects additions, removals and changes without a manual-edit signal', () => {
    const live = { a: 'old' };
    const snapshot = sourceSnapshot(live);
    live.a = 'new';
    expect(snapshot.a).toBe('old');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => assertSameSources(snapshot, live)).toThrow('源码版本已变化');
    expect(() => assertSameSources(snapshot, {})).toThrow('源码版本已变化');
    expect(() => assertSameSources(snapshot, { a: 'old', b: 'added' })).toThrow('源码版本已变化');
    expect(() => assertSameSources(snapshot, { a: 'old' })).not.toThrow();
  });
});
