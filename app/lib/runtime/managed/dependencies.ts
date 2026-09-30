import { packages } from '@babel/standalone';
import { RunError, type SourceFiles } from './protocol';

/**
 * Catch undeclared packages before install instead of asking the model to
 * repair downstream TS2307/implicit-any errors without a dependency diagnosis.
 */
export function validateImports(files: SourceFiles) {
  const pkg = JSON.parse(files['package.json']);
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = new Set<string>();

  for (const [path, content] of Object.entries(files)) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(path)) {
      continue;
    }

    let ast;

    try {
      ast = packages.parser.parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch {
      continue;
    } // The actual compiler diagnoses syntax; never mask it.

    const inspect = (specifier: string) => {
      if (/^(?:[./#]|[a-z]+:)/i.test(specifier)) {
        return;
      }

      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

      if (!declared[name]) {
        missing.add(name);
      }
    };
    packages.traverse.default(ast, {
      ImportDeclaration(node) {
        inspect(node.node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.node.source) {
          inspect(node.node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        inspect(node.node.source.value);
      },
      CallExpression(node) {
        const arg = node.node.arguments[0];

        if (
          (node.node.callee.type === 'Import' ||
            (node.node.callee.type === 'Identifier' && node.node.callee.name === 'require')) &&
          arg?.type === 'StringLiteral'
        ) {
          inspect(arg.value);
        }
      },
    });
  }

  if (missing.size) {
    throw new RunError(
      `源码导入了未声明的依赖：${[...missing].sort().join(', ')}。请在同一补丁的 package.json 中添加兼容的明确版本并核对导出名称，不要仅修改组件类型或禁用检查。`,
      true,
      'dependency',
    );
  }
}
