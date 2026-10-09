import { describe, expect, it } from 'vitest';
import { validateNewModuleIntegration } from './module-integration';

const entry = {
  'index.html': '<script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': 'import App from "./App"; console.log(App)',
  'src/App.tsx': 'export default function App(){return <main/>}',
  'src/pages/Projects.tsx': 'export default function Projects(){return <main/>}',
};
describe('new project module wiring', () => {
  it('rejects inline entry copies that leave generated pages unused', () => {
    expect(() => validateNewModuleIntegration(entry)).toThrow('src/pages/Projects.tsx');
  });
  it('accepts imports, barrel exports and lazy routes connected to the entry', () => {
    expect(() =>
      validateNewModuleIntegration({
        ...entry,
        'src/App.tsx': 'import { Projects } from "./pages"; export default Projects',
        'src/pages/index.ts': 'export {default as Projects} from "./Projects"',
      }),
    ).not.toThrow();
    expect(() =>
      validateNewModuleIntegration({ ...entry, 'src/App.tsx': 'export const page = () => import("./pages/Projects")' }),
    ).not.toThrow();
  });
  it('does not confuse type-only imports with a rendered page connection', () => {
    expect(() =>
      validateNewModuleIntegration({
        ...entry,
        'src/App.tsx': 'import type Projects from "./pages/Projects"; export default function App(){return <main/>}',
      }),
    ).toThrow('模块未接入');
  });
  it('leaves unknown aliases and entry conventions to their actual compiler', () => {
    expect(() =>
      validateNewModuleIntegration({
        ...entry,
        'src/App.tsx': 'import Projects from "@/pages/Projects"; export default Projects',
      }),
    ).not.toThrow();
    expect(() => validateNewModuleIntegration({ ...entry, 'index.html': '<div/>' })).not.toThrow();
  });
  it('does not require unused platform helpers or test components to mount', () => {
    expect(() =>
      validateNewModuleIntegration({
        ...entry,
        'src/App.tsx': 'import Projects from "./pages/Projects"; export default Projects',
        'src/lib/jingyue-auth.ts': 'export const helper = 1',
        'src/components/Example.spec.tsx': 'export const example = <main/>',
      }),
    ).not.toThrow();
  });
});
