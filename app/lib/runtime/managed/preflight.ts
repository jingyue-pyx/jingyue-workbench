import { packages } from '@babel/standalone';
import { inspectProject, RunError, type SourceFiles } from './protocol';
import { validateImports } from './dependencies';
import { validateStyles } from './styles';

/** Parse one complete source file without executing it or requiring sibling modules. */
export function validateSourceSyntax(path: string, content: string) {
  if (!/\.[cm]?[jt]sx?$/.test(path)) {
    return;
  }

  try {
    packages.parser.parse(content, {
      sourceType: 'unambiguous',
      plugins: [
        ...(/\.[cm]?tsx?$/.test(path) ? ['typescript' as const] : []),
        ...(/\.(?:[cm]?js|jsx|tsx)$/.test(path) ? ['jsx' as const] : []),
      ],
    });
  } catch (error) {
    const location = error as { loc?: { line?: number; column?: number }; reasonCode?: string };

    // Do not include Babel's raw message, which can echo source or credentials.
    const line = location.loc?.line;
    const column = location.loc?.column;
    const at = Number.isInteger(line) && Number.isInteger(column) ? `:${line}:${column! + 1}` : '';
    const reason = /^[A-Za-z]{1,80}$/.test(location.reasonCode || '') ? location.reasonCode : 'ParseError';
    throw new RunError(
      `候选源码语法检查失败（${path}${at}，${reason}），尚未写入当前工程。请修正该文件语法。`,
      true,
      'syntax',
    );
  }
}

/** No filesystem writes. Parse source, but never evaluate generated code. */
export function validateCandidate(files: SourceFiles) {
  inspectProject(files);
  validateImports(files);
  validateStyles(files);

  for (const [path, content] of Object.entries(files)) {
    validateSourceSyntax(path, content);
  }
}
