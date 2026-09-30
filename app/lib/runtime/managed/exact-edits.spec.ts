import { describe, expect, it } from 'vitest';
import { ExactEditError, managedSystemPrompt, parsePatch } from './protocol';
import { REACT_VITE_TEMPLATE } from './template';

const previous = { 'src/App.tsx': 'const open = () => alert("demo");\nexport default open;' };
const patch = (files: unknown[]) => JSON.stringify({ status: 'changed', summary: '修复入口', files });
const edit = (search: string, replace: string) => ({ path: 'src/App.tsx', edits: [{ search, replace }] });

describe('exact existing-file edits', () => {
  it('reports a structured full-file fallback without leaking search or replacement contents', () => {
    try {
      parsePatch(patch([edit('private-search-canary', 'private-replace-canary')]), previous);
      throw Error('Expected mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(ExactEditError);
      expect(error).toMatchObject({ filePath: 'src/App.tsx', category: 'format', repairable: true });
      expect((error as Error).message).toContain('完整 content');
      expect((error as Error).message).not.toContain('canary');
    }
  });
  it('does not silently ignore visual-editor attributes when locating JSX', () => {
    const files = {
      'src/App.tsx': 'export default function App(){return <main data-oid="jy-test"><h1>正在创建你的应用</h1></main>}',
    };
    expect(() =>
      parsePatch(patch([edit('<main><h1>正在创建你的应用</h1></main>', '<main>营销</main>')]), files),
    ).toThrow(ExactEditError);
    expect(files['src/App.tsx']).toContain('data-oid="jy-test"');
  });
  it('requires a complete file only for the path selected for recovery', () => {
    expect(() => parsePatch(patch([edit('alert("demo")', 'openPanel()')]), previous, ['src/App.tsx'])).toThrow(
      '完整 content',
    );
    expect(
      parsePatch(patch([{ path: 'src/App.tsx', content: 'export default function App(){return null}' }]), previous, [
        'src/App.tsx',
      ]).files,
    ).toHaveLength(1);
    expect(
      parsePatch(patch([edit('alert("demo")', 'openPanel()')]), previous, ['src/other.tsx']).files[0].content,
    ).toContain('openPanel()');
  });
  it('retains protected-file validation when the full-file fallback is used', () => {
    expect(() =>
      parsePatch(patch([{ path: 'tsconfig.json', content: '{}' }]), REACT_VITE_TEMPLATE, ['tsconfig.json']),
    ).toThrow('校验配置');
    expect(managedSystemPrompt('repair')).toContain('input.fullFilePaths');
    expect(managedSystemPrompt('generate')).toContain('placeholder template');
  });
  it('preserves unrelated source and resolves to the existing complete-file protocol', () => {
    const result = parsePatch(patch([edit('alert("demo")', 'setOpen(true)')]), previous);
    expect(result.files).toEqual([
      { path: 'src/App.tsx', content: 'const open = () => setOpen(true);\nexport default open;' },
    ]);
    expect(previous['src/App.tsx']).toContain('alert');
  });
  it('supports sequential edits and literal replacement characters', () => {
    const result = parsePatch(
      patch([
        {
          path: 'src/App.tsx',
          edits: [
            { search: 'alert("demo")', replace: 'show("$&")' },
            { search: 'show("$&")', replace: 'show("$1")' },
          ],
        },
      ]),
      previous,
    );
    expect(result.files[0].content).toContain('show("$1")');
  });
  it.each(['missing text', 'open'])('rejects absent or ambiguous targets rather than guessing: %s', (search) => {
    expect(() => parsePatch(patch([edit(search, 'replacement')]), previous)).toThrow('唯一匹配');
  });
  it('rejects overlapping matches', () => {
    expect(() => parsePatch(patch([edit('aa', 'x')]), { 'src/App.tsx': 'aaa' })).toThrow('唯一匹配');
  });
  it('does not partially mutate the previous snapshot when a later edit fails', () => {
    const original = JSON.stringify(previous);
    expect(() =>
      parsePatch(
        patch([
          edit('alert("demo")', 'setOpen(true)'),
          { path: 'src/other.ts', edits: [{ search: 'missing', replace: 'new' }] },
        ]),
        previous,
      ),
    ).toThrow();
    expect(JSON.stringify(previous)).toBe(original);
  });
  it.each([
    { path: 'src/App.tsx', content: 'full', edits: [{ search: 'open', replace: 'close' }] },
    { path: 'src/App.tsx', edits: [] },
    { path: 'src/App.tsx', edits: [{ search: '', replace: 'x' }] },
    { path: 'src/App.tsx', edits: [{ search: '   ', replace: 'x' }] },
    { path: 'src/App.tsx', edits: [{ search: 'open', replace: null }] },
    { path: 'src/App.tsx', edits: Array.from({ length: 21 }, () => ({ search: 'open', replace: 'x' })) },
    { path: '../outside', edits: [{ search: 'x', replace: 'y' }] },
    { path: '.env', edits: [{ search: 'x', replace: 'y' }] },
    { path: 'constructor', edits: [{ search: 'x', replace: 'y' }] },
  ])('rejects unsafe or malformed edits: $path', (file) => {
    expect(() => parsePatch(patch([file]), previous)).toThrow();
  });
  it('retains compiler and dependency protections after resolving edits', () => {
    expect(() =>
      parsePatch(
        patch([{ path: 'tsconfig.json', edits: [{ search: REACT_VITE_TEMPLATE['tsconfig.json'], replace: '{}' }] }]),
        REACT_VITE_TEMPLATE,
      ),
    ).toThrow('校验配置');
    expect(() =>
      parsePatch(
        patch([{ path: 'package.json', edits: [{ search: REACT_VITE_TEMPLATE['package.json'], replace: '{}' }] }]),
        REACT_VITE_TEMPLATE,
      ),
    ).toThrow('校验工具');
  });
  it('retains duplicate-path and resulting-size protections', () => {
    expect(() => parsePatch(patch([edit('alert("demo")', 'x'), edit('alert("demo")', 'y')]), previous)).toThrow('重复');
    expect(() => parsePatch(patch([edit('alert("demo")', 'x'.repeat(250000))]), previous)).toThrow('上限');
  });
});
