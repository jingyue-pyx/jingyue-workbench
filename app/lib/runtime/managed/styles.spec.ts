import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateStyles } from './styles';
import { REACT_VITE_TEMPLATE, STYLED_REACT_VITE_TEMPLATE } from './template';
import type { SourceFiles } from './protocol';
afterEach(() => vi.unstubAllGlobals());

describe('generated CSS dependency guard', () => {
  it('ships a complete utility pipeline for new apps without mutating the native baseline', () => {
    expect(() => validateStyles(STYLED_REACT_VITE_TEMPLATE)).not.toThrow();
    expect(JSON.parse(STYLED_REACT_VITE_TEMPLATE['package.json']).devDependencies.tailwindcss).toBe('3.4.17');
    expect(JSON.parse(STYLED_REACT_VITE_TEMPLATE['package.json']).dependencies['react-icons']).toBe('5.5.0');
    expect(REACT_VITE_TEMPLATE['postcss.config.cjs']).toBeUndefined();
    expect(STYLED_REACT_VITE_TEMPLATE['src/main.tsx']).toContain('import "./style.css"');
  });
  it('reproduces the marketing page: raw Tailwind directives without its pipeline cannot pass', () => {
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'src/App.tsx': '<button className="btn-primary">提交</button>',
        'src/style.css':
          '@tailwind base; @tailwind components; @tailwind utilities; .btn-primary { @apply bg-blue-600 text-white; }',
      }),
    ).toThrow('Tailwind 指令');
  });
  it('an installed Tailwind package alone does not compile its directives', () => {
    const pkg = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
    pkg.devDependencies.tailwindcss = '3.4.17';
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'package.json': JSON.stringify(pkg),
        'src/style.css': '@tailwind utilities;',
      }),
    ).toThrow('编译配置');
  });
  it.each(['v3', 'v4-vite', 'v4-postcss'])('accepts configured %s Tailwind pipeline', (version) => {
    const pkg = JSON.parse(REACT_VITE_TEMPLATE['package.json']);
    pkg.devDependencies.tailwindcss = version === 'v3' ? '3.4.17' : '4.0.0';

    const config: SourceFiles = {};

    if (version === 'v3') {
      pkg.devDependencies.postcss = '8.4.49';
      config['postcss.config.cjs'] = 'module.exports = { plugins: { tailwindcss: {} } }';
      config['tailwind.config.js'] = 'export default { content: ["./src/**/*.{js,jsx,ts,tsx}"] }';
    } else if (version === 'v4-vite') {
      pkg.devDependencies['@tailwindcss/vite'] = '4.0.0';
      config['vite.config.ts'] =
        'import tailwindcss from "@tailwindcss/vite"; export default { plugins: [tailwindcss()] }';
    } else {
      pkg.devDependencies['@tailwindcss/postcss'] = '4.0.0';
      config['postcss.config.mjs'] = 'export default { plugins: { "@tailwindcss/postcss": {} } }';
    }

    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        ...config,
        'package.json': JSON.stringify(pkg),
        'src/style.css': version === 'v3' ? '@tailwind utilities;' : '@import "tailwindcss";',
      }),
    ).not.toThrow();
  });

  const broken: SourceFiles = {
    ...REACT_VITE_TEMPLATE,
    'src/App.tsx': '<main className="py-20 px-4 gap-8 text-gray-900"><svg className="w-10 h-10" /></main>',
  };
  it('catches compiling but unstyled utility output and is repairable', () => {
    expect(() => validateStyles(broken)).toThrow('样式依赖缺失');

    try {
      validateStyles(broken);
    } catch (error: any) {
      expect(error.repairable).toBe(true);
    }
  });
  it('accepts native CSS, including manually defined utility names', () => {
    expect(() => validateStyles(REACT_VITE_TEMPLATE)).not.toThrow();
    expect(() =>
      validateStyles({
        ...broken,
        'src/style.css': '.py-20{} .px-4{} .gap-8{} .text-gray-900{} .w-10{width:40px} .h-10{height:40px}',
      }),
    ).not.toThrow();
  });
  it('does not accept installation without a CSS entry, or reject one coincidental class', () => {
    const pkg = JSON.parse(broken['package.json']);
    pkg.devDependencies.tailwindcss = '3.4.17';
    expect(() => validateStyles({ ...broken, 'package.json': JSON.stringify(pkg) })).toThrow('工具类入口');
    expect(() => validateStyles({ ...broken, 'src/App.tsx': '<div className="p-4 custom-layout" />' })).not.toThrow();
  });
  it('catches missing desktop/mobile visibility and navigation spacing, not only icon sizes', () => {
    const files = {
      ...REACT_VITE_TEMPLATE,
      'src/App.tsx': '<header><nav className="hidden md:flex space-x-5"/><button className="md:hidden"/></header>',
    };
    expect(() => validateStyles(files)).toThrow('hidden、md:flex、space-x-5、md:hidden');
    expect(() =>
      validateStyles({
        ...files,
        'src/style.css':
          '.hidden{display:none}.space-x-5 > * + *{margin-left:20px}@media(min-width:768px){.md\\:flex{display:flex}.md\\:hidden{display:none}}',
      }),
    ).not.toThrow();
  });
  it('does not mistake longer class names for the missing definitions', () => {
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'src/App.tsx': '<div className="p-4 m-2 w-1 h-1"/>',
        'src/style.css': '.p-40{}.m-20{}.w-12{}.h-12{}',
      }),
    ).toThrow('样式依赖缺失');
  });
  it('rejects native layout declarations discarded by the target browser parser', () => {
    vi.stubGlobal('CSS', { supports: vi.fn((property, value) => value !== 'repeat(3, minmax(0, 1fr)))') });
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'src/style.css': '.grid{grid-template-columns:repeat(3, minmax(0, 1fr)));}',
      }),
    ).toThrow('grid-template-columns');
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'src/style.css':
          '/* width: invalid */ .grid{display:grid !important;grid-template-columns:repeat(3, minmax(0, 1fr));}',
      }),
    ).not.toThrow();
  });
  it('does not parse a valid media breakpoint as a width declaration', () => {
    const supports = vi.fn((_property, value) => !value.includes(')'));
    vi.stubGlobal('CSS', { supports });
    expect(() =>
      validateStyles({
        ...REACT_VITE_TEMPLATE,
        'src/style.css': '@media(min-width:768px){.nav{display:flex;gap:20px;}}',
      }),
    ).not.toThrow();
    expect(supports).toHaveBeenCalledWith('display', 'flex');
    expect(supports).not.toHaveBeenCalledWith('width', '768px)');
  });
});
