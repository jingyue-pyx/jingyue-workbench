// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
import { JingyueBrand } from './JingyueBrand';
afterEach(cleanup);

it('presents the Jingyue brand and keeps the home destination', () => {
  render(<JingyueBrand />);
  expect(screen.getByRole('link', { name: '鲸月 · 返回首页' }).getAttribute('href')).toBe('/');
  expect(screen.getByText('鲸月')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/bolt/i);
});

it('uses Jingyue for build identities while retaining the upstream license and protocol', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  expect(JSON.parse(read('package.json')).name).toBe('jingyue');
  expect(read('wrangler.toml')).toContain('name = "jingyue"');
  expect(read('Dockerfile')).not.toContain('bolt-ai');
  expect(read('docker-compose.yaml')).not.toContain('bolt-ai');
  expect(read('app/routes/_index.tsx')).toContain("title: '鲸月");
  expect(read('app/routes/git.tsx')).toContain("title: '鲸月");
  expect(read('app/routes/chat.$id.tsx')).toContain("export { meta } from './_index'");
  expect(read('LICENSE')).toContain('Copyright');
  expect(read('app/lib/runtime/message-parser.ts')).toContain('boltArtifact');
});

it('does not mount the retired Supabase management connector or its legacy diagnostics', () => {
  expect(readFileSync('app/components/chat/BaseChat.tsx', 'utf8')).not.toMatch(
    /<SupabaseConnection|<SupabaseChatAlert/,
  );
  expect(readFileSync('app/components/@settings/tabs/connections/ConnectionDiagnostics.tsx', 'utf8')).not.toContain(
    'supabase_connection',
  );
  expect(readFileSync('deployment/gateway.mjs', 'utf8')).toContain('handleDemoDataApi');
});
