// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
import { WorkbenchLoadingShell } from './WorkbenchLoadingShell';

describe('initial workbench HTML', () => {
  it('renders useful initial content without waiting for hydration or a browser sandbox', () => {
    const html = renderToString(<WorkbenchLoadingShell />);
    expect(html).toContain('鲸月工作台');
    expect(html).toContain('先显示会话，代码与预览随后恢复。');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<iframe');
  });
});
