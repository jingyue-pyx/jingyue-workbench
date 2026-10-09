/** A compiler-observed updater/value mismatch, not a guess from a user's text. */
export function callbackRepairEvidence(diagnostic: string): string {
  if (
    !/TS2345: Argument of type '\([^'\r\n]{0,500}\)\s*=>[^'\r\n]{1,500}' is\s+not assignable to parameter of type '[^'\r\n]{0,300}(?:\[\]|Array<[^'\r\n]{1,150}>)'\./.test(
      diagnostic,
    )
  ) {
    return '';
  }

  return (
    '\nCALLBACK CONTRACT MISMATCH: The compiler received an updater FUNCTION where the declared callback accepts an ARRAY VALUE. ' +
    'Adding a type annotation to the updater parameter does not fix this mismatch. Inspect the failing call, its prop/interface declaration, and the parent implementation together. ' +
    'For a value-only callback, compute the next array from the current value and pass that array. Use React.Dispatch<React.SetStateAction<T>> only if all actual callers pass a real React state setter supporting functional updates. ' +
    'Preserve toggling/selection behavior. Do not use any, casts, ts-ignore, disabled strict checks, or unchanged to hide the diagnostic. The host will recheck the result.'
  );
}

/** Treat compiler text as data. Only inspect a fixed public package's declarations. */
export async function iconRepairEvidence(diagnostic: string, read: (path: string) => Promise<string>): Promise<string> {
  const missing = [
    ...diagnostic.matchAll(
      /(?:Module |module )?["']{1,2}(react-icons\/[a-z0-9]{1,5})["']{1,2} has no exported member (?:named )?["']([A-Za-z][A-Za-z0-9]{0,79})["']/g,
    ),
  ];
  const evidence: string[] = [];
  const seen = new Set<string>();

  for (const [, module, name] of missing.slice(0, 6)) {
    if (seen.has(module)) {
      continue;
    }

    seen.add(module);

    try {
      const declarations = await read(`node_modules/${module}/index.d.ts`);

      if (declarations.length > 2_000_000) {
        continue;
      }

      const available = [...declarations.matchAll(/^export declare const ([A-Za-z][A-Za-z0-9]*): IconType;/gm)].map(
        (match) => match[1],
      );

      if (!available.length) {
        continue;
      }

      const words = name.match(/[A-Z][a-z]+|[A-Z]+(?![a-z])|\d+/g) || [name];
      const score = (value: string) =>
        words.reduce((total, word, index) => total + (value.includes(word) ? (index ? 5 : 1) : 0), 0);
      const suggestions = [...available]
        .sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b))
        .slice(0, 10);
      const common = available
        .filter((value) => /(?:Bullseye|Users|ChartLine|Wallet|Check|ArrowRight)$/.test(value))
        .slice(0, 10);
      evidence.push(
        JSON.stringify({ module, missing: name, availableExports: [...new Set([...suggestions, ...common])] }),
      );
    } catch {
      // Evidence is optional; keep the original compiler failure authoritative.
    }
  }

  return evidence.length
    ? '\nINSTALLED ICON EXPORT EVIDENCE (read-only declaration data):\n' +
        evidence.join('\n') +
        '\nFix the failing import using an exact available export (an import alias can preserve its local JSX name). Do not guess another export, reinstall for a nonexistent name, suppress type errors, or replace unrelated features. This is not proof of a successful build; the host will recheck.'
    : '';
}
