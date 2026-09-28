// Local acceptance only. Never loads .env or connects to RDS/model providers.
// Run after `pnpm build`; data is in a new temporary, local PGlite directory.
import { createRequire } from 'node:module';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const databaseDirectory =
  process.env.JINGYUE_LOCAL_PREVIEW_DATA || (await mkdtemp(join(tmpdir(), 'jingyue-accounts-preview-')));
if (!databaseDirectory.startsWith(join(tmpdir(), 'jingyue-accounts-preview-')) || databaseDirectory.includes('..'))
  throw new Error('Only the temporary preview database may be reused.');
await mkdir(resolve(root, 'deployment/releases'), { recursive: true });
const outfile = resolve(root, 'deployment/releases/accounts-local-preview.mjs');
await build({
  stdin: {
    contents: `
    import { readFile } from 'node:fs/promises';
    import { randomBytes, randomUUID } from 'node:crypto';
    import { PGlite } from '@electric-sql/pglite';
    import { createRequestHandler } from '@remix-run/node';
    import * as app from './build/server/index.js';
    import { createGateway } from './deployment/gateway.mjs';
    import { configuration } from './deployment/security.mjs';
    import { AccountStore } from './deployment/accounts.mjs';
    import { PostgresProjectStore } from './deployment/project-store.mjs';
    const database = await PGlite.create(${JSON.stringify(databaseDirectory)});
    for (const file of ['001-projects.sql','003-accounts.sql']) await database.exec(await readFile(${JSON.stringify(resolve(root, 'deployment/sql'))}+'/'+file, 'utf8'));
    let previous=Promise.resolve();
    const pool={async connect(){const wait=previous;let release;previous=new Promise(r=>release=r);await wait;return {query:(s,a)=>database.query(s,a),release};},async query(s,a){const c=await this.connect();try{return await c.query(s,a);}finally{c.release();}}};
    const config=configuration({JINGYUE_PUBLIC_ORIGIN:'http://127.0.0.1:9015',JINGYUE_LOCAL_TEST:'1',PORT:'9015',WORKBENCH_ACCESS_USER:'local-preview-owner',WORKBENCH_ACCESS_PASSWORD:randomBytes(32).toString('base64url'),JINGYUE_AUTH_MODE:'accounts',JINGYUE_REGISTRATION_OPEN:'1'});
    const owner=randomUUID();
    const accounts=new AccountStore(pool,config,owner);
    if (!(await pool.query("SELECT id FROM jingyue.accounts WHERE username='preview_alice'")).rows.length) await accounts.register({username:'preview_alice',displayName:'小月 · 验收账号',password:'Local-test-password-7248'},'local-fixture');
    const server=await createGateway({config,clientDirectory:${JSON.stringify(resolve(root, 'build/client'))},accountStore:accounts,projectStore:new PostgresProjectStore(pool,owner),handler:async (request,context)=>request.method==='POST'?new Response(JSON.stringify({error:'本机账号验收环境不调用模型'}),{status:503,headers:{'Content-Type':'application/json'}}):createRequestHandler(app,'production')(request,context)});
    server.listen(9015,'127.0.0.1',()=>process.stdout.write('Local account preview ready at http://127.0.0.1:9015/register; models disabled.\\n'));
    process.on('SIGTERM',()=>{server.closeAllConnections();server.close(async()=>{await database.close();process.exit(0);});});
  `,
    resolveDir: root,
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@electric-sql/pglite'],
  alias: { 'react-dom/server': 'react-dom/server.browser' },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: "import { createRequire as __makeRequire } from 'node:module'; const require = __makeRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
await import(outfile);
