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
