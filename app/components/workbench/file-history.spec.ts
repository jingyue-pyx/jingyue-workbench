import { expect, it } from 'vitest';
import { recordFileChanges, filterFileChanges } from './file-history';

const file = (content: string) => ({ type: 'file' as const, content, isBinary: false });
it('captures actual committed source changes and searches full paths case-insensitively', () => {
  const path = '/home/project/src/App.tsx';
  const history = recordFileChanges({ [path]: file('before') }, { [path]: file('after') }, {}, 1);
  expect(history[path].originalContent).toBe('before');
  expect(history[path].versions[0].content).toBe('after');
  expect(filterFileChanges(history, ' APP.TSX ')).toHaveLength(1);
  expect(filterFileChanges(history, 'src/')).toHaveLength(1);
  expect(filterFileChanges(history, 'missing')).toHaveLength(0);
  expect(recordFileChanges({ [path]: file('after') }, { [path]: file('before') }, history)).toEqual({});
});
it('does not label hydration, unchanged content, or binary files as edits', () => {
  expect(recordFileChanges({}, { 'src/App.tsx': file('loaded') }, {})).toEqual({});
  expect(recordFileChanges({ a: file('x') }, { a: file('x') }, {})).toEqual({});
  expect(recordFileChanges({ a: file('x') }, { a: { ...file('y'), isBinary: true } }, {})).toEqual({});
});
