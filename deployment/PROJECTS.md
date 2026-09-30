# Private cloud project persistence

Only the Node gateway talks to PostgreSQL. WebContainer execution remains in
the browser. No database DDL is run at startup and no background worker is used.
Until authorized database configuration and schema are present, project APIs
return HTTP 503 with `error.code=PERSISTENCE_UNAVAILABLE`; model APIs are unchanged.

## Server configuration

The current limited public demo uses the account/session mode documented in
`ACCOUNTS.md`. Verified sessions determine each project's owner. The Basic
workspace below is the legacy mode, not the current multi-user identity model.

- `WORKBENCH_OWNER_ID`: one stable UUID for this private workspace, independent
  of Basic username/password. Everyone with the shared Basic credentials has
  access to this same workspace. This is not a multi-user login system.
- `JINGYUE_DATABASE_URL`: server-only PostgreSQL URL with username/password and
  database name, on an official `.rds.aliyuncs.com` hostname. No query/hash options.
- `JINGYUE_DATABASE_CA`: optional PEM CA certificate from the verified database
  provider, if not trusted by Node's standard CA store. Certificate verification
  remains enabled by default; never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Explicit exception: approved private demo only (not production)

The user accepted unencrypted FC-to-RDS traffic for this existing private demo
on 2026-09-28 (Beijing time), without changing to a paid TLS-capable specification.
This is NOT encryption: DB credentials and project contents can be exposed to
network interception or a compromised private network. A VPC and security group
reduce reachability but do not provide TLS confidentiality or authenticated
server identity. Website HTTPS and Basic authentication remain unchanged;
they protect browser-to-FC, not FC-to-DB. Do not put sensitive production data
in this demo. No commercial/production use is permitted with this exception.

Only server environment configuration can opt in, using BOTH exact values:

```
JINGYUE_DEMO_PRIVATE_PLAINTEXT=1
JINGYUE_DEMO_PRIVATE_HOST=pgm-j6cdnxlsd0mjok7u.rwlb.cnhk.rds.aliyuncs.com
```

The database URL must also use that exact hostname and port 5432. Hostname and
`172.26.0.0/20` are pinned in code, not configurable by a request or URL option.
Each new socket resolves all addresses and rejects the entire result if any
address is missing, IPv6 or outside that approved IPv4 subnet. It connects using
the already-checked IP from that lookup, with no second resolution or fallback.
DNS failure or a future RDS address outside the subnet means unavailable, not
permission to expand the subnet. This restriction may require a deliberate
reassessment if the approved RDS proxy later moves to another private subnet.

Remove `JINGYUE_DATABASE_CA` entirely for this mode; even an empty defined CA
conflicts. A missing/mismatched host pin, unexpected flag value, URL query/hash,
different host/port, or disabled global TLS verification fails closed. No TLS
error triggers plaintext fallback. Leaving both demo flags absent (or only
setting the switch to `0`) retains strict TLS. The host pin must be removed
when turning the switch off. An invalid DB configuration leaves model APIs and
the workbench running, while project APIs return the normal 503 unavailable.

For production, move to an explicitly approved TLS-capable DB configuration,
remove BOTH demo flags, and verify the official CA and hostname. Refer to
`persistence.env.example`; its commented placeholders are not real credentials.

Provide these through server secret/environment configuration, not source,
browser settings, build variables, command arguments or exported project data.
Apply `sql/001-projects.sql` explicitly using an authorized migration account.
The runtime account needs schema USAGE and CRUD on the two tables only, not DDL
or superuser rights. Configure the approved FC-to-RDS private network separately.
Connection pool: max 2, idle 10s, connect 3s, statement 5s, lock wait 1.5s.
The official PostgreSQL Serverless auto-start guide warns of minute-scale first
connection latency after suspension. A failed attempt returns 503 with
`Retry-After: 5`; it never claims a save succeeded. Keep the same request ID and
body for bounded foreground retries (for example 5/10/20/30/30 seconds), then
retain the local pending copy and offer manual retry. No database keepalive or
background wake-up task is installed.

## API contract, schema version 1

All routes require authentication: an application session in account mode, or
Basic credentials in legacy mode. POST additionally requires
the exact configured Origin and JSON. Cookies cannot set owner or DB destination.

`document` has only `schemaVersion:1`, `title` (nonempty, max 200), `messages`,
`snapshot`, optional `metadata`. Messages contain `id`, `role` (user, assistant,
system), `content` (string or nonempty text-only `{type:'text',text:string}` array),
optional ISO `createdAt` and JSON `annotations`. Message IDs must be unique.
Metadata allows only gitUrl (HTTP(S), no userinfo/query/hash), gitBranch and
netlifySiteId. API keys, provider settings and general application settings are
not project metadata and must never be uploaded.

`snapshot` is explicitly null for a chat-only/empty project, or
`{chatIndex,files,summary?}`. chatIndex must refer to one of the messages.
`files` maps relative normalized paths to `{type:'file',content,isBinary}` or
`{type:'folder'}`; both permit optional `isLocked` and `lockedByFolder`.
Binary content is canonical base64. Absolute/parent paths, dependency/Git
internals, credential files and known credential literals are rejected.

Limits: 4 MiB request, 1 MiB per encoded file, 2000 paths, 1000 messages,
100 projects and 200 MiB project JSON per owner, including recycle-bin projects.
These are application limits, not a cloud billing cap or guaranteed secret
detection. Keep credentials out of source and messages independently of scans.

- GET `/api/projects?limit=20&cursor=...&deleted=0`: `{items,nextCursor}`. Summary
  items contain projectId, title, revision, createdAt, updatedAt, deletedAt.
  limit 1..50; deleted=1 lists the recycle bin; no file/message contents in list.
- POST `/api/projects`: `{projectId,requestId,document,migration?}`, 201.
  IDs are UUIDs; migration is optional `{sourceId:UUID,legacyId:string}`.
- GET `/api/projects/:uuid`: `{projectId,revision,document,createdAt,updatedAt,
  deletedAt}`, including soft-deleted own projects so they can be recovered.
- POST `/api/projects/:uuid/checkpoint`: `{requestId,baseRevision,document}`, 200.
- POST `/api/projects/:uuid/delete` or `/restore`: `{requestId,baseRevision}`, 200.

Every successful mutation returns `{projectId,revision,updatedAt,deletedAt}`.
Send the same requestId and exact logical body when retrying an unknown outcome.
Same-ID/different-content retries fail. Receipts are retained for 24h and pruned
on successful writes; after that, retrieve current state rather than assuming
indefinite idempotency. A workspace allows at most 10,000 receipts per 24h.

Errors are `{error:{code,message,currentRevision?}}`: invalid input 422,
not found/other owner 404, version conflict/deleted project/reused ID 409,
size/quota 413, rate 429, unavailable 503. Upstream DB errors are never returned.
Gateway unauthenticated/origin errors preserve the pre-existing 401/403 format.

Writes are atomic and serialized per owner with PostgreSQL transaction-scoped
locks; revision checks prevent stale saves. Deleted records do not auto-revive.
Soft delete retains the latest complete document; no permanent purge or automatic
project retention policy is implemented. Database backup retention is separate.
An immutable history/version rollback feature is not included in this first API.

## Local validation versus cloud validation

Unit/API tests use fake credentials and mocked API stores. SQL tests run an
in-memory PGlite PostgreSQL engine through a single-session adapter, including
rollback and stale-write cases, never a user's database. This does not verify
RDS PostgreSQL 16, TLS, real successful pg-wire connections or cross-connection
isolation. Demo network tests use fake DNS responses and prove denied responses
cannot connect; they do not resolve or connect to the actual RDS instance.
The final cloud acceptance must apply schema using approved credentials, verify
the explicitly selected transport (strict TLS by default; private plaintext only
under the demo exception above), exercise two-session revision conflicts and transaction rollback,
confirm persistence after instance restart, and check cross-browser recovery.
# Generated-app demo data (optional Supabase integration)

Workbench source and chat persistence remain in the existing workbench database.
This opt-in adapter separately stores **generated-app runtime JSON data** in one
Supabase test project. It does not migrate the workbench database, create paid
resources, or give generated applications an arbitrary SQL/backend runtime.

- Apply `supabase/001-demo-data.sql` only to the selected new Supabase test project.
- Configure the three server-only fields in `supabase.env.example`. For local
  acceptance, `.supabase.local.env` is ignored by Git and must have mode 600.
- `JINGYUE_DEMO_WORKBENCH_PROJECT` must name exactly one existing workbench project.
  The gateway proves session identity and project ownership on every read/write.
  Changing an account ID or project ID in the browser does not authorize access.
- A generated React app imports `useDemoData` from `src/lib/jingyue-data.ts`.
  Its data flows through the active preview iframe → same-origin authenticated
  gateway → fixed Supabase RPC over HTTPS. It never receives a management token,
  service key, database password, or workbench session cookie.
- An existing project gets the optional helper after plan approval; merely adding
  the helper does not migrate localStorage data or enable storage for other apps.
- Autosave is debounced by 600ms. Only a server acknowledgement means “saved”.
  A scoped browser draft is kept before writes, including newer edits made while
  a previous save is in flight. Network retries reuse their mutation identifier.
  Revision conflicts stop rather than silently overwriting another page.
- Demo limits: 64KB per JSON document, 20 document keys, one bound workbench
  project; object/array read/replace only. Removing an item means saving an updated
  array/object. No arbitrary schema, SQL, file uploads, payments or app-user Auth.
- The bridge works only inside the logged-in workbench preview. Standalone export,
  a separately opened preview tab, and independent website publishing need a
  separate authentication/integration design and are not delivered by this adapter.
- Project soft deletion blocks new data API requests but retains remote demo data;
  restoring the same project can recover it. Permanent cleanup is a separate,
  deliberate action. In-flight writes authorized before deletion may complete.
- The Secret key remains elevated. RLS is enabled, direct table access and RPC
  execution are denied to `anon`/`authenticated`, and only the server calls the
  narrowly defined RPC. These controls do not make exposing a Secret key safe.

Local checks: `node --test deployment/demo-data.test.mjs` exercises real embedded
PostgreSQL schema/privileges plus mocked HTTP, not the live Supabase service.
Browser autosave/bridge tests are under `app/lib/runtime/demo-data`. Live database
connectivity, generated-app interaction, reload recovery and cross-account access
must still be checked before release. The Free plan can pause inactive projects;
network/restart failures must remain visible, not be labelled successful saves.

### Local integration acceptance — 2026-09-29

Using the dedicated local fixture and the authorized Supabase Free test project:

- Live HTTPS RPC read/write, idempotent retry and stale-revision rejection passed.
- Chrome/WebContainers: the purchase-list fixture compiled and opened; adding a
  synthetic record reached a server-confirmed saved state. Full workbench reload
  restored that record and quantity. This was not a model-generated acceptance run.
- WebContainers rewrites `document.referrer` during its service-worker bootstrap.
  The client now broadcasts only a nonce-only handshake; the mounted preview's
  exact window and origin are validated by the host before any business request.
  Business payloads and replies use exact origins, never wildcard destinations.
- JSONB object key reordering no longer creates false lost-acknowledgement
  conflicts. Newer local drafts remain protected.
- 254 application tests, 69 deployment tests, type checking, production build,
  credential scan and 74 macOS installation checks passed. The installation
  checks use mocked services, not the live database, and do not validate Linux.

No production deployment or RDS migration was performed. Before release, still
exercise model-generated storage use, independent browser/account isolation,
simultaneous browser edits and offline recovery against the real cloud service.
Current scope remains one configured workbench project, not storage for every
newly generated application. No model calls were made for this acceptance fixture.

References: [Supabase key security](https://supabase.com/docs/guides/getting-started/api-keys),
[database functions](https://supabase.com/docs/guides/database/functions).
