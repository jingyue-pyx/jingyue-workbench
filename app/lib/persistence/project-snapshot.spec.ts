import { describe, expect, it, vi } from 'vitest';
import { restoreProjectFiles } from './project-snapshot';

const text = (content: string) => ({ type: 'file' as const, content, isBinary: false });
const filesystem = () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
});

describe('project snapshot restoration', () => {
  it('preserves manually edited source and action-like text verbatim', async () => {
    const fs = filesystem();
    const content = 'const title = "直接编辑后的标题"; const tag = "</boltAction>";';
    await restoreProjectFiles(fs, '/home/project', { '/home/project/src/App.jsx': text(content) });
    expect(fs.mkdir).toHaveBeenCalledWith('src', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith('src/App.jsx', content);
  });

  it('restores nested folders, relative paths, empty files and binary bytes', async () => {
    const fs = filesystem();
    await restoreProjectFiles(fs, '/home/project', {
      empty: { type: 'folder' },
      'src/empty.txt': text(''),
      'public/pixel.bin': { type: 'file', content: 'AAH/', isBinary: true },
    });
    expect(fs.mkdir).toHaveBeenCalledWith('empty', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith('src/empty.txt', '');
    expect([...fs.writeFile.mock.calls[1][1]]).toEqual([0, 1, 255]);
  });

  it.each(['../outside', '/etc/passwd', '/home/project-other/file', '/home/project'])(
    'rejects unsafe path %s before any write',
    async (unsafe) => {
      const fs = filesystem();
      await expect(
        restoreProjectFiles(fs, '/home/project', { 'safe.txt': text('safe'), [unsafe]: text('bad') }),
      ).rejects.toThrow();
      expect(fs.writeFile).not.toHaveBeenCalled();
    },
  );

  it('does not restore dependencies or Git internals', async () => {
    const fs = filesystem();
    await restoreProjectFiles(fs, '/home/project', { 'node_modules/a.js': text(''), '.git/config': text('') });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
