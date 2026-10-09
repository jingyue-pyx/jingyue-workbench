import { describe, expect, it } from 'vitest';
import { modelFailureCode, modelFailureEvent } from './model-errors';

describe('bounded model failure diagnostics', () => {
  it.each([
    [{ statusCode: 429 }, 'JINGYUE_MODEL_LIMIT'],
    [{ statusCode: 401 }, 'JINGYUE_MODEL_AUTH'],
    [{ statusCode: 503 }, 'JINGYUE_MODEL_UNAVAILABLE'],
    [{ statusCode: 400 }, 'JINGYUE_MODEL_REQUEST'],
    [{ cause: { code: 'UND_ERR_SOCKET' } }, 'JINGYUE_MODEL_NETWORK'],
    [{ lastError: { cause: { code: 'ERR_STREAM_PREMATURE_CLOSE' } } }, 'JINGYUE_MODEL_NETWORK'],
  ])('classifies structured provider failure without raw text', (error, code) => {
    expect(modelFailureCode({ ...error, message: 'private-canary', responseBody: 'private-canary' })).toBe(code);
  });
  it('does not inspect raw secrets, hostile getters or unbounded causes', () => {
    expect(
      modelFailureCode({
        get message() {
          throw new Error('do not read');
        },
      }),
    ).toBe('JINGYUE_MODEL_UNKNOWN');
    expect(
      modelFailureCode({
        get code() {
          throw new Error('do not leak');
        },
      }),
    ).toBe('JINGYUE_MODEL_UNKNOWN');

    const circular = { cause: {} };
    circular.cause = circular;
    expect(modelFailureCode(circular)).toBe('JINGYUE_MODEL_UNKNOWN');
    expect(
      modelFailureEvent('private-canary', 'JINGYUE_MODEL_NETWORK', { projectId: 'private-canary', batch: 2 }),
    ).toBe('managed_model_unknown_JINGYUE_MODEL_NETWORK_batch_2');
  });
  it('reports only allowlisted transport codes or bounded HTTP status, never provider text', () => {
    expect(
      modelFailureEvent('intent', 'JINGYUE_MODEL_NETWORK', {}, { cause: { code: 'ECONNRESET', message: 'secret' } }),
    ).toBe('managed_model_intent_JINGYUE_MODEL_NETWORK_reason_ECONNRESET');
    expect(
      modelFailureEvent('plan', 'JINGYUE_MODEL_UNAVAILABLE', {}, { statusCode: 503, responseBody: 'secret' }),
    ).toBe('managed_model_plan_JINGYUE_MODEL_UNAVAILABLE_reason_HTTP_503');
    expect(modelFailureEvent('plan', 'JINGYUE_MODEL_UNAVAILABLE', {}, { code: 'secret', statusCode: Infinity })).toBe(
      'managed_model_plan_JINGYUE_MODEL_UNAVAILABLE_reason_UNKNOWN',
    );
  });
});
