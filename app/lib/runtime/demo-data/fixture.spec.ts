import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { DEMO_STORAGE_FIXTURE } from './fixture';
import { inspectProject, managedSystemPrompt } from '~/lib/runtime/managed/protocol';
import { validateImports } from '~/lib/runtime/managed/dependencies';

describe('Supabase acceptance fixture and capability planning', () => {
  it('keeps cloud capability disabled by default and distinguishes a bound demo from a generic backend', () => {
    expect(managedSystemPrompt('plan')).not.toContain('EXPLICIT CAPABILITY EXCEPTION');

    const prompt = managedSystemPrompt('plan', false, true);
    expect(prompt).toContain('EXPLICIT CAPABILITY EXCEPTION');
    expect(prompt).toContain('useDemoData');
    expect(prompt).toContain('beyond the explicitly provisioned Supabase storage/auth services');
    expect(prompt).not.toContain('No backend server, database or credentials are provisioned');
  });
  it('has valid template dependencies and TypeScript syntax, with no credentials or mock save acknowledgements', () => {
    expect(inspectProject(DEMO_STORAGE_FIXTURE).typed).toBe(true);
    validateImports(DEMO_STORAGE_FIXTURE);

    for (const [name, source] of Object.entries(DEMO_STORAGE_FIXTURE)) {
      if (!/\.tsx?$/.test(name) || name.endsWith('.d.ts')) {
        continue;
      }

      const result = ts.transpileModule(source, {
        fileName: name,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
      });
      expect(result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
    }
    expect(DEMO_STORAGE_FIXTURE['src/App.tsx']).not.toContain('supabase.co');
    expect(DEMO_STORAGE_FIXTURE['src/App.tsx']).not.toContain('sb_secret_');
    expect(DEMO_STORAGE_FIXTURE['src/App.tsx']).toContain('labels[status]');
  });
});
