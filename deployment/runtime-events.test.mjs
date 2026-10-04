import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEventName } from './runtime-events.mjs';
test('records unsupported capabilities without leaking the model plan', () => {
  const data = { outcome: 'failed', stage: 'planning', reason: 'capability', attempt: 0 };
  assert.equal(runtimeEventName(data), 'client_runtime_failed_planning_capability_repair_0');
  assert.equal(runtimeEventName({ ...data, plan: 'private user requirement' }), null);
});
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

test('correlates bounded batch diagnostics without accepting arbitrary user strings', () => {
  const data = {
    outcome: 'retrying',
    stage: 'generating',
    reason: 'output_limit',
    attempt: 0,
    projectId: 'd63cb19b-9fef-4ae7-8855-293ad3fb2be2',
    runId: '8c1e4b17-f6e4-4d7a-9e29-a50174634828',
    batch: 2,
  };
  assert.match(
    runtimeEventName(data),
    /_projectId_d63cb19b-9fef-4ae7-8855-293ad3fb2be2_runId_8c1e4b17-f6e4-4d7a-9e29-a50174634828_batch_2$/,
  );
  assert.equal(runtimeEventName({ ...data, runId: 'private token or source' }), null);
  assert.equal(runtimeEventName({ ...data, batch: 500 }), null);
  assert.equal(runtimeEventName({ ...data, reason: 'arbitrary text' }), null);
});
