import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEventName } from './runtime-events.mjs';
test('records no-change separately without accepting raw model content', () => {
  const data = { outcome: 'unchanged', stage: 'generating', reason: 'none', attempt: 0 };
  assert.equal(runtimeEventName(data), 'client_runtime_unchanged_generating_none_repair_0');
  assert.equal(runtimeEventName({ ...data, summary: 'private model text' }), null);
  assert.equal(
    runtimeEventName({ ...data, outcome: 'failed', reason: 'model_no_change' }),
    'client_runtime_failed_generating_model_no_change_repair_0',
  );
});
test('records dependency corruption separately from generated-code failure', () => {
  const data = { outcome: 'failed', stage: 'installing', reason: 'dependency_install', attempt: 0 };
  assert.equal(runtimeEventName(data), 'client_runtime_failed_installing_dependency_install_repair_0');
  assert.equal(runtimeEventName({ ...data, log: 'package or source contents' }), null);
});
