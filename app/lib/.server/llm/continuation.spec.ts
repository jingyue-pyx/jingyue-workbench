import { describe, expect, it } from 'vitest';
import { normalizeContinuationChunk } from './continuation';

describe('long generation continuation', () => {
  it('keeps a token-limited step inside the same assistant message', () => {
    const result = normalizeContinuationChunk(
      'e:{"finishReason":"length","usage":{"completionTokens":8000},"isContinued":false}\n',
    );
    expect(JSON.parse(result.slice(2))).toEqual({
      finishReason: 'length',
      usage: { completionTokens: 8000 },
      isContinued: true,
    });
  });
  it('does not emit an intermediate message finish', () => {
    expect(normalizeContinuationChunk('d:{"finishReason":"length"}\n')).toBe('');
  });
  it.each([
    '0:"code fragment"\n',
    'e:{"finishReason":"stop","isContinued":false}\n',
    'd:{"finishReason":"stop"}\n',
    '3:"error"\n',
  ])('preserves ordinary text, final completion and errors: %s', (chunk) => {
    expect(normalizeContinuationChunk(chunk)).toBe(chunk);
  });
});
