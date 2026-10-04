// Exercises the REAL pinned OpenCode server and file tools, with a synthetic
// streaming model. No credentials and no external model calls are required.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createLocalOpenCode } from './runner.mjs';

export const fixture = {
  'package.json': JSON.stringify({
    name: 'agent-smoke',
    version: '1.0.0',
    type: 'module',
    private: true,
    scripts: { typecheck: 'tsc --noEmit', build: 'tsc --noEmit && vite build', dev: 'vite --host 0.0.0.0' },
    dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
    devDependencies: { vite: '5.4.21', typescript: '5.5.2', '@types/react': '18.3.3', '@types/react-dom': '18.3.0' },
  }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      lib: ['ES2020', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ['src'],
  }),
  'index.html':
    '<!doctype html><html><head><title>Agent test</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx':
    'import React from "react"; import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App />);',
  'src/App.tsx': 'export default function App() { return <main><h1>Hello</h1></main>; }',
};

export async function smoke({ repair = false } = {}) {
  let calls = 0;
  let repaired = false;
  const transport = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'qwen3-coder-next');
    const actions = repair
      ? [
          { name: 'read', arguments: { filePath: '/workspace/src/App.tsx' } },
          {
            name: 'edit',
            arguments: { filePath: '/workspace/src/App.tsx', oldString: 'Hello', newString: '{missingDemoName}' },
          },
          undefined,
          { name: 'read', arguments: { filePath: '/workspace/src/App.tsx' } },
          {
            name: 'edit',
            arguments: {
              filePath: '/workspace/src/App.tsx',
              oldString: '{missingDemoName}',
              newString: 'OpenCode connected',
            },
          },
        ]
      : [
          { name: 'read', arguments: { filePath: '/workspace/src/App.tsx' } },
          {
            name: 'edit',
            arguments: { filePath: '/workspace/src/App.tsx', oldString: 'Hello', newString: 'OpenCode connected' },
          },
        ];
    const action = actions[calls++];
    if (calls > 7) throw new Error('Unexpected agent loop');
    const chunk = {
      id: `test-${calls}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: request.model,
      choices: [
        {
          index: 0,
          delta: action
            ? {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${calls}`,
                    type: 'function',
                    function: { name: action.name, arguments: JSON.stringify(action.arguments) },
                  },
                ],
              }
            : { role: 'assistant', content: '已修改标题，等待平台独立编译检查。' },
          finish_reason: null,
        },
      ],
    };
    const end = {
      ...chunk,
      choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  const runner = await createLocalOpenCode({
    config: {
      localTest: true,
      host: '127.0.0.1',
      modelEnv: { DASHSCOPE_BASE_URL: 'https://example.invalid/v1', DASHSCOPE_API_KEY: 'synthetic-only' },
    },
    transport,
    report: (event) => process.stdout.write(JSON.stringify({ event }) + '\n'),
  });
  try {
    const result = await runner.run(
      {
        projectId: randomUUID(),
        runId: randomUUID(),
        phase: 'generate',
        task: 'Change the Hello heading to OpenCode connected.',
        files: fixture,
        errors: [],
        model: 'qwen3-coder-next',
      },
      {
        owner: 'synthetic-test',
        signal: new AbortController().signal,
        charge: async () => {},
        progress: (event) => {
          if (event.stage === 'repairing') repaired = true;
          process.stdout.write(JSON.stringify(event) + '\n');
        },
      },
    );
    assert.match(result.patch.files.find((file) => file.path === 'src/App.tsx')?.content || '', /OpenCode connected/);
    assert.deepEqual(result.checks, ['typecheck', 'build']);
    assert.equal(repaired, repair);
    console.log(
      JSON.stringify({
        realOpenCode: result.version,
        model: 'synthetic',
        checks: result.checks,
        calls,
        repaired,
        changed: result.patch.files.map((file) => file.path),
      }),
    );
  } finally {
    await runner.close();
  }
}

if (process.argv[1]?.endsWith('/opencode/smoke.mjs')) {
  smoke({ repair: process.argv.includes('--repair') }).catch((error) => {
    console.error(JSON.stringify({ code: error.code || 'SMOKE_FAILED', message: error.message }));
    process.exitCode = 1;
  });
}
