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
