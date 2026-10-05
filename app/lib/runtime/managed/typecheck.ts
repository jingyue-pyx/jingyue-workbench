/** Shared, host-owned gate for candidates, preview and static publication. */
export function managedTypecheckConfig() {
  return {
    compilerOptions: {
      target: 'ES2020',
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      baseUrl: '..',
      paths: { '@/*': ['src/*'], '~/*': ['src/*'] },
    },
    include: ['../**/*.ts', '../**/*.tsx'],
    exclude: [
      '../node_modules',
      '../dist',
      '../build',
      '../.jingyue-build',
      '../.jingyue-runtime',
      '../.jingyue-candidates',
    ],
  };
}
