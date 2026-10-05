import { describe, expect, it } from 'vitest';
import { bindSingleFileResponse, managedSystemPrompt, parsePatch, RunError } from './protocol';

const path = 'src/style.css';
const original = { [path]: 'button{color:blue}' };
const reply = (value: unknown) => JSON.stringify(value);

describe('host-bound single-file output', () => {
  it('binds content and edits to the current target without asking the model to name files', () => {
    for (const change of [{ content: 'button{color:green}' }, { edits: [{ search: 'blue', replace: 'green' }] }]) {
      const bound = bindSingleFileResponse(reply({ status: 'changed', summary: '按钮变绿', ...change }), path);
      expect(parsePatch(bound, original).files).toEqual([{ path, content: 'button{color:green}' }]);
      expect(original[path]).toBe('button{color:blue}');
    }
  });
  it('accepts explicit unchanged but never code hidden behind unchanged', () => {
    expect(
      parsePatch(bindSingleFileResponse(reply({ status: 'unchanged', summary: '已有样式' }), path), original).status,
    ).toBe('unchanged');
    expect(() =>
      bindSingleFileResponse(reply({ status: 'unchanged', summary: 'ignored', content: 'new' }), path),
    ).toThrow(RunError);
  });
  it.each([
    { status: 'changed', summary: 'x', content: 'css', path: 'src/App.tsx' },
    { status: 'changed', summary: 'x', content: 'css', command: 'ignored' },
    { status: 'changed', summary: 'x', content: 'css', otherFiles: [] },
    null,
    [],
    { status: 'changed' },
  ])('rejects ambiguous or redirected content without silently relabeling it', (value) => {
    expect(() => bindSingleFileResponse(reply(value), path)).toThrow(RunError);
  });
  it('keeps strict format, size, path and protected-config checks after binding', () => {
    expect(() => bindSingleFileResponse('{"content":', path)).toThrow(RunError);
    expect(() => bindSingleFileResponse('{}', '../escape.ts')).toThrow(RunError);

    for (const change of [{ content: null }, { content: 'x'.repeat(250001) }, { content: 'x', edits: [] }]) {
      expect(() =>
        parsePatch(bindSingleFileResponse(reply({ status: 'changed', summary: 'x', ...change }), path), original),
      ).toThrow(RunError);
    }
    expect(() =>
      parsePatch(bindSingleFileResponse(reply({ status: 'changed', summary: 'x', content: '{}' }), 'tsconfig.json'), {
        'tsconfig.json': '{"strict":true}',
      }),
    ).toThrow('不能改写');
  });
  it('does not discard or rebind legacy multi-file responses; the scheduler still checks their scope', () => {
    const legacy = reply({
      status: 'changed',
      summary: 'x',
      files: [{ path: 'src/App.tsx', content: 'wrong target' }],
    });
    expect(bindSingleFileResponse(legacy, path)).toBe(legacy);
  });
  it.each([false, true])('retains capability and safety boundaries (auth/storage: %s)', (enabled) => {
    const prompt = managedSystemPrompt('generate', false, enabled, enabled, 'content', true);
    expect(prompt).toContain('SINGLE-FILE RESPONSE CONTRACT');
    expect(prompt).toContain('Never include secrets');
    expect(prompt).toContain('Do not weaken type checks');
    expect(prompt).not.toMatch(/"files":|"path":|"edits":/);
    expect(prompt.includes('PROVISIONED APPLICATION AUTH')).toBe(enabled);
    expect(prompt.includes('EXPLICIT CAPABILITY EXCEPTION')).toBe(enabled);
  });
});
