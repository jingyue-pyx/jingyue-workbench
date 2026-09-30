/**
 * AI SDK v4 normally starts a new assistant message after each model call.
 * Token-limit continuations must remain one message so Bolt can finish a file action.
 */
export function normalizeContinuationChunk(chunk: string): string {
  if (!chunk.startsWith('e:') && !chunk.startsWith('d:')) {
    return chunk;
  }

  const value = JSON.parse(chunk.slice(2));

  if (value.finishReason !== 'length') {
    return chunk;
  }

  if (chunk.startsWith('d:')) {
    return '';
  }

  return `e:${JSON.stringify({ ...value, isContinued: true })}\n`;
}
