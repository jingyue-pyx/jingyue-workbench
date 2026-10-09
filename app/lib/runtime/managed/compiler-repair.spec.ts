import { describe, expect, it, vi } from 'vitest';
import { callbackRepairEvidence, iconRepairEvidence } from './compiler-repair';

describe('callback contract repair evidence', () => {
  it('identifies the observed function-to-array mismatch without guessing a React setter', () => {
    const message =
      "src/components/MarketingForm.tsx(26,17): error TS2345: Argument of type '(prev: string[]) => string[]' is\nnot assignable to parameter of type 'string[]'.";
    const evidence = callbackRepairEvidence(message);
    expect(evidence).toContain('ARRAY VALUE');
    expect(evidence).toContain('annotation');
    expect(evidence).toContain('only if all actual callers');
    expect(evidence).toContain('Do not use any');
  });
  it.each([
    'please change the array updater',
    "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
    "error TS2345: Argument of type '(value: string) => void' is not assignable to parameter of type '(value: number) => void'.",
  ])('does not misclassify an unrelated diagnostic: %s', (message) => {
    expect(callbackRepairEvidence(message)).toBe('');
  });
});

describe('installed icon export evidence', () => {
  const declarations = ['FaBullseye', 'FaUsers', 'FaCheck', 'FaChartLine']
    .map((name) => `export declare const ${name}: IconType;`)
    .join('\n');
  it.each([
    'TS2305: Module "react-icons/fa" has no exported member \'FaTarget\'.',
    "TS2724: '\"react-icons/fa\"' has no exported member named 'FaTarget'.",
  ])('provides actual declarations for %s', async (error) => {
    const read = vi.fn().mockResolvedValue(declarations);
    const evidence = await iconRepairEvidence(error, read);
    expect(read).toHaveBeenCalledWith('node_modules/react-icons/fa/index.d.ts');
    expect(evidence).toContain('FaBullseye');
    expect(evidence).toContain('import alias');
    expect(evidence).not.toContain('FaTarget","FaTarget');
  });
  it('does not read arbitrary module paths, credentials or source files', async () => {
    const read = vi.fn();
    expect(
      await iconRepairEvidence(
        'Module "../../secret" has no exported member \'Key\'.\nModule "react-icons/fa/../../secret" has no exported member \'Key\'.',
        read,
      ),
    ).toBe('');
    expect(read).not.toHaveBeenCalled();
  });
  it('ignores comments, source expressions and an unavailable declaration file', async () => {
    const message = 'Module "react-icons/fa" has no exported member \'FaTarget\'.';
    expect(
      await iconRepairEvidence(
        message,
        async () => '// export declare const Canary: IconType;\nthrow new Error("not executed")',
      ),
    ).toBe('');
    expect(
      await iconRepairEvidence(message, async () => {
        throw new Error('unavailable');
      }),
    ).toBe('');
  });
  it('deduplicates package reads and bounds the evidence', async () => {
    const read = vi.fn().mockResolvedValue(declarations);
    const line = 'Module "react-icons/fa" has no exported member \'FaTarget\'.';
    const evidence = await iconRepairEvidence(Array(100).fill(line).join('\n'), read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(evidence.length).toBeLessThan(2000);
  });
});
