import { describe, expect, it } from 'vitest';
import { editSource, inspectSource, instrumentSource } from './source';

const path = '/home/project/src/App.tsx';
const source =
  'export default function App() { return <main><h1 data-oid="title">原来的标题</h1><p data-oid="body" className="old">说明</p></main>; }';

describe('Onlook source editing adapter', () => {
  it('adds locators only to native JSX and is idempotent', () => {
    const input = 'const App = () => <Layout><h1>Hello</h1><img src="/a.png" /></Layout>';
    const instrumented = instrumentSource(input, path);
    expect(instrumented.match(/data-oid=/g)).toHaveLength(2);
    expect(instrumented).toContain('data-jingyue-source="/home/project/src/App.tsx"');
    expect(instrumentSource(instrumented, path)).toBe(instrumented);
  });

  it('preserves existing identities and replaces duplicates', () => {
    const output = instrumentSource('<><p data-oid="same"/><p data-oid="same"/></>', path);
    expect(output.match(/data-oid="same"/g)).toHaveLength(1);
  });

  it('edits actual source text, not just preview DOM', () => {
    const output = editSource(source, 'title', { kind: 'text', value: '走进山野' });
    expect(inspectSource(output, 'title').text).toBe('走进山野');
    expect(output).toContain('说明');
    expect(output).not.toContain('原来的标题');
  });

  it('escapes JSX-significant text without turning it into code', () => {
    const literal = '<script>{danger} & friends';
    const output = editSource(source, 'title', { kind: 'text', value: literal });
    expect(inspectSource(output, 'title').text).toBe(literal);
    expect(output).not.toContain('<script>');
  });

  it('updates classes and styles on the same file', () => {
    const styled = editSource(source, 'body', { kind: 'classes', value: 'new large' });
    const output = editSource(styled, 'body', { kind: 'style', property: 'color', value: '#ff0000' });
    expect(inspectSource(output, 'body').classes).toBe('new large');
    expect(output).toContain('color: "#ff0000"');
  });

  it('rejects stale, ambiguous, nested and dynamic targets', () => {
    expect(() => editSource(source, 'missing', { kind: 'text', value: 'x' })).toThrow();
    expect(() => editSource('<><p data-oid="x"/><p data-oid="x"/></>', 'x', { kind: 'text', value: 'x' })).toThrow();

    for (const body of ['{name}', '<span>child</span>']) {
      const input = `<h1 data-oid="x">${body}</h1>`;
      expect(inspectSource(input, 'x').textEditable).toBe(false);
      expect(() => editSource(input, 'x', { kind: 'text', value: 'x' })).toThrow();
    }
    expect(inspectSource('<img data-oid="x"/>', 'x').textEditable).toBe(false);
    expect(() =>
      editSource('<p data-oid="x" className={classes}>X</p>', 'x', { kind: 'classes', value: 'x' }),
    ).toThrow();
    expect(() =>
      editSource('<p data-oid="x" style={styles}>X</p>', 'x', { kind: 'style', property: 'color', value: 'red' }),
    ).toThrow();
  });
});
