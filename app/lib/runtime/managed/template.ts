import type { SourceFiles } from './protocol';
import DEMO_DATA_CLIENT from '~/lib/runtime/demo-data/client.ts?raw';
import APP_AUTH_CLIENT from '~/lib/runtime/app-auth/client.ts?raw';

export const DEMO_DATA_FILES: SourceFiles = { 'src/lib/jingyue-data.ts': DEMO_DATA_CLIENT };
export const APP_AUTH_FILES: SourceFiles = { 'src/lib/jingyue-auth.ts': APP_AUTH_CLIENT };

// Pinned baseline, not fetched from an external template repository at runtime.
export const REACT_VITE_TEMPLATE: SourceFiles = {
  ...DEMO_DATA_FILES,
  ...APP_AUTH_FILES,
  'package.json': JSON.stringify(
    {
      name: 'jingyue-app',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { dev: 'vite --host 0.0.0.0', typecheck: 'tsc --noEmit', build: 'tsc --noEmit && vite build' },
      dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
      devDependencies: { vite: '5.4.21', typescript: '5.5.2', '@types/react': '18.3.3', '@types/react-dom': '18.3.0' },
    },
    null,
    2,
  ),
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
      },
      include: ['src'],
    },
    null,
    2,
  ),
  'index.html':
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>鲸月应用</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx':
    'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./style.css";\ncreateRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);\n',
  'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
  'src/App.tsx':
    'export default function App() { return <main><h1>正在创建你的应用</h1><p>任务完成后会自动检查并启动预览。</p></main>; }\n',
  'src/style.css':
    '*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f6f7fb;color:#192238}main{max-width:1000px;margin:auto;padding:48px 24px}button,input{font:inherit}button{cursor:pointer}\n',
};

/*
 * New projects get a complete, pinned utility pipeline, not just instructions
 * asking the model to invent setup. Keep the native baseline for old projects
 * and migration/regression fixtures; never overwrite an existing app with this.
 */
const styledPackage = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
export const STYLED_REACT_VITE_TEMPLATE: SourceFiles = {
  ...REACT_VITE_TEMPLATE,
  'package.json': JSON.stringify(
    {
      ...styledPackage,
      dependencies: { ...styledPackage.dependencies, 'react-icons': '5.5.0' },
      devDependencies: {
        ...styledPackage.devDependencies,
        tailwindcss: '3.4.17',
        postcss: '8.4.49',
        autoprefixer: '10.4.20',
      },
    },
    null,
    2,
  ),
  'postcss.config.cjs': 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n',
  'tailwind.config.cjs':
    'module.exports = { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: { extend: {} }, plugins: [] };\n',
  'src/style.css':
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@layer base { body { margin: 0; font-family: system-ui, sans-serif; color: #192238; background: #f6f7fb; } button, input, textarea, select { font: inherit; } button { cursor: pointer; } }\n',
};
