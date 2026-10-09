import { expect, it } from 'vitest';
import { validateImports } from './dependencies';
import { REACT_VITE_TEMPLATE } from './template';

it('names undeclared component, routing and icon packages before installation', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx':
        'import { Button } from "antd"; import { Routes } from "react-router-dom"; import { PlusOutlined } from "@ant-design/icons";',
    }),
  ).toThrow('未声明的依赖：@ant-design/icons, antd, react-router-dom');
});
it('allows declared dependencies, subpaths and relative imports', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'import { createRoot } from "react-dom/client"; import "./style.css";',
    }),
  ).not.toThrow();
});
it('detects re-exports and literal dynamic imports without matching comments', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': '// import "fake";\nexport { Button } from "antd"; const x = import("recharts");',
    }),
  ).toThrow('antd, recharts');
});
it('leaves syntax errors to the compiler instead of hiding them', () => {
  expect(() => validateImports({ ...REACT_VITE_TEMPLATE, 'src/App.tsx': 'const =' })).not.toThrow();
});

it('rejects missing shared types from real portfolio generation before dependency installation', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/components/ProjectGrid.tsx': 'import { Project } from "../types"; export const projects: Project[] = [];',
    }),
  ).toThrow('src/components/ProjectGrid.tsx → ../types');
});
it('resolves local files, directory entry points and TypeScript ESM extension substitution', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'import "./components"; import "./types.js"; import "./image.png"; import "#alias";',
      'src/components/index.tsx': 'export {}',
      'src/types.ts': 'export type Project = { id: string };',
    }),
  ).not.toThrow();
});
it('checks relative re-exports and lazy imports without evaluating source', () => {
  expect(() =>
    validateImports({
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': 'export * from "./types"; const Page = import("./Page");',
    }),
  ).toThrow('src/App.tsx → ./Page；src/App.tsx → ./types');
});
it('collects local and external dependency failures in one diagnostic', () => {
  const broken = { ...REACT_VITE_TEMPLATE, 'src/App.tsx': 'import "./Missing"; import "undeclared-library";' };

  try {
    validateImports(broken);
    throw new Error('expected failure');
  } catch (error) {
    expect(String(error)).toContain('./Missing');
    expect(String(error)).toContain('未声明的依赖：undeclared-library');
  }
});
