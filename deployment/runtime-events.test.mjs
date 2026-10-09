import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEventName } from './runtime-events.mjs';
test('accepts six repair rounds, preserves old events and rejects unbounded attempts', () => {
  const event = { outcome: 'retrying', stage: 'typechecking', reason: 'compile' };
  for (let attempt = 0; attempt <= 6; attempt++) {
    assert.equal(runtimeEventName({ ...event, attempt }), `client_runtime_retrying_typechecking_compile_repair_${attempt}`);
  }
  for (const attempt of [-1, 7, 1.5, '6', NaN, Infinity]) {
    assert.equal(runtimeEventName({ ...event, attempt }), null);
  }
  assert.equal(runtimeEventName({ ...event, attempt: 6, detail: 'private-canary' }), null);
});
test('distinguishes explicit cancellation, page lifecycle and deadline without raw details', () => {
  for (const reason of ['user_stop', 'page_left', 'manual_edit', 'superseded', 'task_timeout']) {
    const outcome = reason === 'task_timeout' ? 'failed' : 'cancelled';
    const event = { outcome, stage: 'planning', reason, attempt: 0 };
    assert.equal(runtimeEventName(event), `client_runtime_${outcome}_planning_${reason}_repair_0`);
    assert.equal(runtimeEventName({ ...event, detail: 'private-canary' }), null);
  }
});
test('keeps finite model recovery codes and rejects raw provider data', () => {
  for (const reason of ['model_rate_limit', 'model_daily_limit']) {
    assert.equal(
      runtimeEventName({ outcome: 'retrying', stage: 'generating', reason, attempt: 0 }),
      `client_runtime_retrying_generating_${reason}_repair_0`,
    );
  }
  for (const reason of [
    'model_network',
    'model_unavailable',
    'model_incomplete',
    'model_auth',
    'model_limit',
    'model_request',
    'model_unknown',
    'model_policy',
    'session_expired',
    'request_denied',
  ]) {
    for (const outcome of ['failed', 'retrying']) {
      const event = { outcome, stage: 'generating', reason, attempt: 0 };
      assert.equal(runtimeEventName(event), `client_runtime_${outcome}_generating_${reason}_repair_0`);
      assert.equal(runtimeEventName({ ...event, responseBody: 'secret-canary' }), null);
    }
  }
});
test('accepts finite generation/storage diagnostics but never error objects or raw text', () => {
  for (const reason of [
    'unsafe_path',
    'protected_config',
    'source_size',
    'recovery_storage',
    'storage_quota',
    'internal_type',
    'internal_reference',
    'internal_error',
  ]) {
    const event = { outcome: 'failed', stage: 'generating', reason, attempt: 0 };
    assert.equal(runtimeEventName(event), `client_runtime_failed_generating_${reason}_repair_0`);
    assert.equal(runtimeEventName({ ...event, detail: 'private-canary' }), null);
    assert.equal(runtimeEventName({ ...event, error: { message: 'private-canary' } }), null);
  }
});
test('accepts only finite final batch subtypes with no raw source fields', () => {
  for (const reason of ['patch_format', 'patch_mismatch', 'batch_scope', 'batch_missing', 'source_syntax']) {
    const event = { outcome: 'failed', stage: 'generating', reason, attempt: 0 };
    assert.equal(runtimeEventName(event), `client_runtime_failed_generating_${reason}_repair_0`);
    assert.equal(runtimeEventName({ ...event, source: 'private-canary' }), null);
  }
});
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
