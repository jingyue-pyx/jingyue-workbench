import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@remix-run/node';
import * as build from '../build/server/index.js';
import { configuration } from './security.mjs';
import { createGateway, failureDetails } from './gateway.mjs';
import { createModelNetwork } from './network.mjs';
import { createProjectStore } from './project-store.mjs';
import { AccountStore } from './accounts.mjs';

// Upstream logs may contain raw SDK errors, prompts, or request headers. Only
// fixed deployment events are emitted, never raw upstream console arguments.
for (const method of ['log', 'info', 'debug', 'warn', 'error', 'trace']) console[method] = () => {};
const report = (event, error) =>
  process.stderr.write(JSON.stringify({ event, ...(error === undefined ? {} : failureDetails(error)) }) + '\n');
// The upstream route launches unawaited stream observers. An expected abort
// rejects those observers too; it must not crash unrelated private sessions.
// Unknown unhandled failures still stop the process, without logging secrets.
process.on('unhandledRejection', (error) => {
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
    report('model_request_cancelled', error);
    return;
  }
  report('unhandled_request_failure', error);
  process.exit(1);
});

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22 or later is required.');
  const config = configuration(process.env);
  const network = createModelNetwork(config);
  const projectStore = await createProjectStore(process.env, report);
  if (config.authMode === 'accounts' && !projectStore) throw new Error('Account storage is required.');
  const accountStore = config.authMode === 'accounts' ? new AccountStore(projectStore.pool, config, projectStore.ownerId) : null;
  globalThis.fetch = network.fetch;
  const server = await createGateway({
    config,
    clientDirectory: resolve(dirname(fileURLToPath(import.meta.url)), 'client'),
    handler: createRequestHandler(build, 'production'),
    requestScope: network.run,
    report,
    projectStore,
    accountStore,
  });
  server.listen(config.port, config.host, () => report('private_preview_ready'));
} catch {
  report('private_preview_startup_failed_check_configuration');
  process.exitCode = 1;
}
