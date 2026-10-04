# 鲸月工作台：阿里云私有体验部署

这是 **当前鲸月 / Onlook / 百炼工作台** 的独立部署入口，不是旧 `atoms-demo` 制品，也不是公开多租户生产系统。现有受限内测已部署至香港 FC，域名、HTTPS 和项目持久化已接通；2026-09-28 已切换独立账号注册登录，当前账号模式配置以 [ACCOUNTS.md](ACCOUNTS.md) 为准。下方 Basic 配置保留用于理解旧入口，不能当作当前多用户部署方案。验收范围及未完成项见根目录 [JINGYUE.md](../JINGYUE.md)。

## 为什么单独加部署入口

上游默认启动依赖 Wrangler 本地模拟器；Dockerfile 直接复制仓库而 `.dockerignore` 未覆盖本机百炼配置；`bindings.sh` 把环境密钥放进命令行参数。上游还有返回服务端 API Key 的导出接口，以及可由浏览器配置模型目的地址的能力。不能原样面向公网开放。

这里通过部署专用 Node HTTP 入口复用已有 Remix 生产构建：

- 访问凭据未配置时拒绝启动；除无敏感信息的健康检查外，页面、静态文件与 API 均需认证。
- 模型密钥只从服务器环境注入，不写入制品、前端包、命令行或页面。
- 只提供百炼的两种已配置模型；剥离浏览器的 API Key 与提供商 Cookie；不允许改写模型目的地址。
- 禁止 API Key 导出、任意 Git 代理、云连接器、系统诊断、第三方发布接口；后续逐项安全审查后再开放。
- 写请求必须同源；每个实例最多 2 个同时进行的模型请求、每分钟 10 个请求，单请求体最大 4 MiB；禁止原始上游日志输出，服务只记录无请求内容的固定事件。
- 页面返回 WebContainer 必需的 COOP / COEP，响应按流转发不聚合；AI 生成代码依然在访问者浏览器的 WebContainer 执行。

HTTP Basic 仅是旧个人 Demo 的临时入口。当前账号模式使用应用会话与数据库持久额度，公开注册限制为 20 个账号，模型每用户每日 20 次、全站每日 100 次；网关另有每实例频率和并发限制。必须配合云端最大实例数与费用告警，这些限制均不是账单硬上限；仅使用 HTTPS 公网入口。

## 生成无秘密制品

先在根目录完成正常生产构建，再执行：

```sh
node --test deployment/security.test.mjs deployment/gateway.test.mjs
node deployment/build.mjs
```

脚本将已安装 Vite 依赖中的 esbuild 用于打包 Node 服务，复制 `build/client` 与许可证，输出至被 Git 忽略的 `deployment/releases/`，包含独立目录、`.zip`（FC 控制台上传）和 `.tgz`，**不遍历或读取 `.dev.vars`、百炼配置文本或其他本地凭据文件**。不包含 `node_modules`、本机原生二进制、源码映射、Git 或配置。输出目录是一次性快照；UI 变化后需要重新构建打包。

秘密扫描覆盖全部制品文件，仅对已核验的 Shiki Emacs Lisp 语法资产内三个固定词的 SHA-256 指纹放行，不跳过整个文件或关闭扫描。假 key、云访问密钥字面量、私有文件与符号链接仍被拒绝。扫描不能证明不存在任何形式的未知秘密；其依据是严格输入白名单与字面量/文件名检查，不读取真实密钥作比对。

`node deployment/verify-release.mjs <生成目录>` 使用假访问凭据和假百炼 key，对打包后的真实 Remix + AI SDK 做本机验证。它在独立测试进程内模拟最终模型网络传输，不联系百炼、不消耗模型费用，也不将模拟代码带入制品；验证首页、资源、鉴权、密钥导出封锁、流式增量与断连取消，且取消后服务保持可用。

此步骤仍需针对最终制品进行敏感值检查与实际 Node/Linux 验收。打包成功不等于 FC 已部署。

## 云端运行配置

现有 Demo 使用中国香港 FC **Web 函数 / Custom Runtime > Node.js 22（Debian 11）**。不是事件函数；启动命令 `node server.mjs`，工作目录 `/code`，监听 `0.0.0.0:9000`。无需运行时 npm 安装业务依赖。保留控制台语言模板自动配置的 PATH / 官方层；不要猜测或清空自动配置。新环境首次运行仍须确认 Node 版本及入口可用。

服务端环境：

| 名称 | 内容 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `9000` |
| `HOST` | `0.0.0.0` |
| `JINGYUE_PUBLIC_ORIGIN` | 实际 HTTPS 域名 origin，不带路径 |
| `WORKBENCH_ACCESS_USER` | 用户自行设置的访问名 |
| `WORKBENCH_ACCESS_PASSWORD` | 用户自行设置的至少 20 字符访问口令，只存服务端 |
| `DASHSCOPE_API_KEY` | 用户已有百炼密钥，仅服务端安全配置 |
| `DASHSCOPE_BASE_URL` | 与密钥地域/业务空间对应的官方 HTTPS 兼容接口地址 |

公网环境禁止设置 `JINGYUE_LOCAL_TEST`。本地无模型调用的健康/认证测试可设置它为 `1`，但只能绑定 `127.0.0.1`；不提供线上跳过认证开关。

候选资源限制：最小实例 0、最大实例 1、超时 300 秒；具体 CPU/内存以打包后的内存实测和账号支持规格选择。没有资源时，创建 FC 会产生按量费用承诺，不能把免费试用视为没有费用；需用户明确同意后再创建。不要自动开通 ADB、NAT、EIP、OSS、SLS 或购买资源包。

2026-09-27 本机打包运行采样（macOS / Node 25、假模型流）RSS 约 101 MiB，不是 Linux 峰值。0.5 GB 内存只是待测下限，首次受限私有体验建议使用控制台已准备的 1 vCPU / 2 GB、最小 0 / 最大 1；验证实际云端峰值后再评估降配。应用每实例限流不是云账单硬封顶，未授权访问仍会消耗函数请求/计算资源。

最初单人 Demo 的首月预算目标为 100 元以内，并以 30–60 活跃实例小时、1 万请求和 10 GB 出流量估算；这是历史假设，不是当前连续运行成本承诺。用户现已批准受限公网注册，并关闭数据库自动暂停两周，数据库期间持续计费。恢复检查与人工兜底见 [ACCOUNTS.md](ACCOUNTS.md)。函数仍最小 0、最大 1；告警建议 50 / 75 / 90 元，是否启用另行核验。百炼、函数、数据库和流量费用分开核对，均没有硬封顶保证。

绑定 `jingyue-christine.xin` 的 HTTPS，证书需先确认已有可用证书或用户批准的免费申请资格。最终 DNS 目标必须取自真实 FC 自定义域名配置，不猜 IP/CNAME。不要把本机代理返回的保留地址当公网地址。大陆地区还需备案；当前候选香港地区按官方规则不需 ICP 备案。

## 上线验收

1. 认证为空/错误时页面与所有 API 返回 401；健康检查只返回状态。未经授权不能发起模型调用。
2. 正确认证后首页、JS、CSS 正常；任何密钥导出或编码变体返回 404。客户端修改 provider cookie 不能改模型目的地址。
3. HTTPS 有效，COOP/COEP 完整；Chrome 中 `crossOriginIsolated` 为真，WebContainer 实际可启动。
4. 一个小型真实生成项目完成依赖安装、预览；再进行对话修改和直接编辑；刷新恢复另行验收。
5. 网络断开/停止生成会取消上游流，日志不含密钥、口令、请求体或原始错误对象。
6. 云用量、并发/实例限制、告警核验；记录撤回方法。仅本机验证时不得声明线上完成。

## 官方依据

- [FC 自定义运行时](https://help.aliyun.com/zh/functioncompute/custom-runtime/) 支持 HTTP Server，可选择运行时/启动命令。
- [FC Web 函数流式响应](https://help.aliyun.com/zh/functioncompute/does-function-compute-support-sse-streaming-response)：Web 函数支持流式，需分块响应；不能用事件函数替代。
- [FC 自定义域名](https://help.aliyun.com/en/functioncompute/configure-custom-domain-names)：香港及中国大陆以外域名绑定不需 ICP；默认测试域名可能强制附件下载。
- [FC 计费](https://help.aliyun.com/zh/functioncompute/billing-overview-of-fc)：无最小实例且无请求不计计算费；计算/CU 和公网出流量分项计费，试用额度耗尽后转按量。
- [WebContainer 响应头](https://webcontainers.io/guides/configuring-headers) 与 [商业使用许可](https://webcontainers.io/enterprise)：原型/POC 不要求商业许可，但面向商业客户/员工的生产使用需核实授权，不能因为宿主 MIT 许可就自动视为可商用。
# Local OpenCode experiment (not enabled in production)

Restore point before this experiment: `263be1b9190172ae7fd2b5d6fa2ef04244632da0`
on `jingyue/main`. The experiment lives on `codex/opencode-serve-poc`; keep the
working tree and any uncommitted work before switching branches.

The optional local adapter uses **OpenCode 1.18.34 `serve`** in a disposable
Docker container for each candidate. It replaces generation/repair only;
intent routing, plan approval, editor layout, project persistence and the
browser preview remain the existing implementation. This is not yet a remote
preview service, nor persistent OpenCode agent memory across tasks.

```sh
docker build -t jingyue-opencode:1.18.34 deployment/opencode
pnpm build
JINGYUE_LOCAL_AGENT=opencode JINGYUE_LOCAL_PREVIEW_PORT=9027 \
  JINGYUE_LOCAL_MODEL_REQUESTS=100 node deployment/preview-managed.mjs
```

Use the local preview account and select `qwen3-coder-next`. Other models use
the existing engine. Do not expose this local experiment publicly. Remove
`JINGYUE_LOCAL_AGENT` and restart to return to the existing engine; the normal
production entrypoint does not instantiate an OpenCode runner.

Security/behavior boundaries:

- Only a validated candidate directory is mounted, never the workbench repo,
  Docker socket, host home, SSH credentials or database configuration.
- Containers run without root/capabilities, with CPU, memory and PID limits.
  This local Docker boundary is not a substitute for a production tenant
  isolation and network-egress design.
- Model credentials stay in the workbench process. The agent receives a
  revocable task token for a loopback model proxy. Each upstream model request
  charges the signed-in account's normal quota; task maximum is 16 calls and
  80,000 output tokens across retries (not a monetary hard cap). Each call
  reserves its maximum, then settles against valid provider usage only after
  a complete stream; interrupted/missing-usage calls retain their reservation.
- Agent tools may read/edit the candidate. The platform owns the fixed
  install/typecheck/build commands and returns failures for agent repair;
  shell tools are disabled to avoid duplicate checks and wasted model calls.
  Sharing, external-directory access, subagents and arbitrary
  web tools are disabled. These permissions supplement container isolation.
- A completed model response is not success: the platform independently runs
  typecheck/build, checks protected configuration, then returns a deterministic
  diff. The existing workbench still validates it before replacing live files.
- Cancellation revokes the task token and removes the exact task container.
  Candidate files remain in private OS temporary directories for diagnosis;
  the short-lived agent configuration file is removed. No user project is
  deleted by experiment cleanup.

Validation commands:

```sh
node --test deployment/opencode.test.mjs
node deployment/opencode/smoke.mjs
# Live synthetic marketing example; consumes the local test account quota:
node deployment/opencode/acceptance.mjs --live
```

The smoke test runs real OpenCode tools with a synthetic model. Live acceptance
uses synthetic source, not user project exports. Browser interaction/visual
checks are separate from build and persistence checks.

### Local acceptance record (2026-10-02)

- Original implementation restore point was pushed before any adapter changes.
- Application regression: 536 passed. Deployment regression: 90 passed.
  TypeScript checking and the production build passed; lint has warnings but
  no errors in the changed frontend files.
- Real OpenCode + synthetic model: read/edit, independent typecheck/build,
  and a deliberately broken candidate followed by successful repair passed.
- Real Bailian test, synthetic marketing page: first generation used 12 model
  calls; adding channel selection/filtering used 14. Both passed independent
  typecheck/build and source checkpoint read-back (local test database).
- Browser acceptance then caught an orphan stylesheet: CSS existed but was
  never imported. Entry-graph style checks now return that failure to the agent
  before candidate acceptance; they are not a replacement for visual QA.
- A real request entered through the workbench conversation used OpenCode
  successfully to connect the stylesheet, label demo data and disable placeholder
  navigation. Candidate checks, browser compilation, preview and source save
  all passed. In the preview, adding a 2,000-budget activity changed totals from
  105,000 to 107,000; channel filtering, pause and resume passed.
- After a full workbench refresh, the saved source, stylesheet and channel
  controls restored and the styled preview reopened. The temporary activity
  reset as explicitly described in the demo; this is not business-data
  persistence validation.
- Runtime-generated lockfiles stay in the browser project, not the editable
  agent payload. This pilot uses fresh candidate installs with the pinned
  framework versions; general lockfile-preserving execution is future work.
- Earlier real attempts hit the agent budget. Reservations now settle against
  trusted provider usage, rejected admissions do not count as provider usage,
  and platform-owned checks avoid competing execution loops. This is a bounded
  pilot result, not a claim that every project now succeeds or costs less.
- Local OpenCode authentication uses a separate test Cookie namespace. Existing
  production authentication is unchanged. Browser sandbox previews and business
  data persistence are still separate concerns from the agent's candidate files.
- No production deployment was performed. This is still a small synthetic
  acceptance case, not a broad stability/performance verdict. Preview business
  data is deliberately temporary; only conversation/source restoration was in
  scope. Production tenant isolation, persistent agent sessions and moving the
  preview off WebContainers are not implemented by this pilot.

Provider usage reference: [Bailian streaming usage](https://www.alibabacloud.com/help/en/model-studio/stream).

## Netlify personal-account static publishing (local implementation; disabled by default)

This is separate from the legacy browser-token connector. Account-mode users use
the project header's **发布网站** dialog. The workbench layout and model workflow
are unchanged. This integration does not publish the workbench itself.

### Setup and release gate

1. Register a **Jingyue-owned** OAuth application in Netlify. Configure its client
   ID; never borrow the Netlify CLI application's ID. The implementation uses
   Netlify's official ticket authorization flow: users approve at Netlify and
   the server exchanges the approved ticket. It never handles provider passwords.
2. A schema owner applies `sql/005-publishing.sql`. Grant only SELECT, INSERT,
   UPDATE and DELETE on `jingyue.publishing_state` to the existing runtime role.
   Production startup does not run migrations or grant permissions.
3. Configure `publishing.env.example` server-side, with a stable, random 32-byte
   base64 encryption key. Local acceptance can use ignored `.publishing.local.env`.
   Do not use `VITE_` variables, frontend storage, or put credentials in a repo.
4. Connect a consenting test account, select its team and confirm public content
   and use of that team's quota. Do not upgrade any plan automatically.
5. Before enabling production: test actual authorization, first static deploy,
   same-site update, binary assets, SPA subroute refresh, expired/revoked token,
   interrupted upload/reconciliation and public access. Mock tests do not satisfy
   this gate. No live account or real deployment has been verified by this code alone.

### Scope and safeguards

- Builds use a frozen, saved project revision in a separate temporary directory
  **inside WebContainer**. The host/backend never executes generated app code.
  Only React/Vite static output is supported, 300 files / 8 MiB per upload.
  Install lifecycle scripts are disabled; packages requiring them are not supported
  in this first version. Build/typecheck failures stop before uploading.
- The backend derives identity from the session; stale-tab guards, origin checks,
  project ownership, saved revision and accessible team are rechecked. The client
  cannot submit remote site IDs, arbitrary URLs or platform tokens.
- Tokens are AES-256-GCM encrypted with user/provider-bound associated data.
  Netlify's consent grants create/manage access to projects across the user's
  teams, not a provider-enforced single-project scope. The UI discloses this;
  Jingyue's owner/project/team checks restrict what this integration will do,
  but do not narrow the capability of a stolen provider token.
  Local disconnect deletes the stored credential, not the website. Users must
  also revoke the app on Netlify to revoke provider-side authorization. Changing
  encryption keys requires an explicit re-encryption/reauthorization procedure.
- Build files preserve bytes. Paths, total size, known credential patterns,
  source maps, functions and workbench-only demo-storage dependencies are rejected.
  This scan is a guardrail, not proof that user content contains no sensitive data.
  A platform-owned SPA fallback and random release marker are added server-side.
- Project-to-site binding and the current job persist in PostgreSQL. A lease
  serializes job advancement. Unknown create responses are reconciled by the
  deterministic site name or deployment title, **not replayed automatically**.
  Ambiguous results that cannot be reconciled require checking Netlify; no blind
  retry/new-site fallback is offered. Old legacy metadata is not a trusted binding.
- Closing the dialog pauses local advancement. An already submitted provider
  request can still complete; reopening queries persisted state. It is not a
  guaranteed remote cancel. Successful/failed terminal jobs discard artifact bytes.
- Netlify `ready` is shown separately from public availability. The server probes
  a tiny generated release marker at the allowlisted HTTPS default domain without
  credentials/redirects; only a matching marker counts as public validation.
  Private-default platform settings may require the user's action in Netlify.
- Independent business storage, SSR/functions, custom domains, Git deployment,
  paid upgrades, template imports and Vercel/Alibaba adapters are not implemented
  by this first publishing slice. Workbench-preview Supabase data does not
  automatically work in a standalone website.

References: [Netlify API](https://open-api.netlify.com/),
[official ticket authorization URL](https://github.com/netlify/cli/blob/main/src/utils/login-url.ts),
[deploy methods](https://docs.netlify.com/deploy/create-deploys/).

### Local publishing checks (2026-10-03)

- Application regression: 581 passed; deployment regression: 109 passed.
  The new publishing coverage consists of 15 server tests and 10 browser-logic/
  component tests. TypeScript and production build passed. Changed frontend
  files have no lint errors (six empty test/log-sink warnings remain).
- The gateway/OpenCode/publishing subset was rerun after the credential-scan
  fix: 47 passed. The release package passed its credential scan. The scanner's
  own public database-URL placeholder was no longer embedded as a literal;
  detection of actual database credentials and secrets was not relaxed.
- Netlify responses are mocked; database behavior is exercised with local
  PostgreSQL-compatible PGlite and UI behavior with jsdom. Real WebContainer
  publishing builds, real OAuth consent, remote sites and public browser access
  remain unverified. No production deployment, cloud migration, paid resource,
  real OAuth application or real Netlify site was created by these checks.

### Real Netlify acceptance (2026-10-04)

- Verification: 583 application tests, 114 deployment tests, TypeScript and
  production build passed. The final package passed its secret scan and 74
  packaged-server checks with synthetic credentials/model transport (zero real
  model or database calls in that packaged check). This is macOS/Node acceptance,
  not a Linux or FC deployment claim.
- Registered the owned Jingyue OAuth application. The user completed Netlify's
  consent page; local server-side ticket exchange and team lookup succeeded.
  The encrypted credential stays in the local test database. The private vault
  configuration is Git-ignored and owner-readable only; no credentials are in
  this document or in frontend bundles.
- Used one synthetic React/Vite fixture on the loopback `9035` test server.
  Real WebContainer installation/build produced six static artifacts including
  a PNG and the server-added SPA redirect/release marker. No user project or
  model request was involved. No paid upgrade was selected.
- Found and fixed a real async upload defect: Netlify's later `required` array
  is not a reliable remaining-work queue. The server now persists the prepared
  manifest before uploading, advances only after successful immutable PUTs,
  and resumes the same deploy after an uncertain response or process restart.
  Preparing responses cannot initialize an empty queue. Legacy partial jobs
  recover by re-uploading their immutable artifacts to the existing deploy.
- The first remote deploy finished after recovery. A second build from saved
  revision 2 updated **the same site and URL**, verified in a real browser by
  its changed heading. The counter, PNG decoding, `/details` navigation and
  direct refresh passed while signed in to Netlify.
- The team creates private sites by default. The initial anonymous check
  correctly reported `access_unverified`. After explicit user approval, only
  the synthetic site's production deployment was made public. Anonymous
  `/details` access now returns HTTP 200 and the updated page renders normally.
  No team-wide protection or deploy-preview protection was changed.
- The local dialog now explains private-default protection and links to the
  exact Netlify project settings. Stopping local work reports a readable status
  rather than the browser's raw AbortError; it does not delete remote resources.
- Formal Jingyue production remains unchanged. Rollout still needs the schema
  migration, persistent encrypted-credential configuration and cloud-runtime
  acceptance; local success is not production deployment. Standalone business
  storage, generated backend functions, custom domains and the second hosting
  provider remain outside this static-publishing iteration.

### Acceptance feedback fixes (2026-10-04)

- The provider selector now follows the authenticated server model catalog.
  Unsupported providers and stale provider/model pairs cannot remain selected.
  Model settings stay accessible while the catalog loads; stop remains usable.
- Prompt enhancement sends JSON with the correct content type and commits only
  a complete successful text response. HTTP errors, quota errors, timeouts and
  edits made while waiting preserve the user's current input. A real browser
  request against the configured model returned enhanced text successfully.
- Repeated-error detection compares both the diagnostic and candidate source
  revision. Changed code with the same type error can use the remaining repair
  round; identical failed candidates still stop. The two-repair ceiling,
  deadlines, quotas and candidate-before-commit checks remain in force.
  Failure messages distinguish deadline, quota, unchanged-code and exhausted
  repair cases. The screenshot-only type-error report lacks the original
  compiler output/session, so that exact generated project is not yet reproduced.
- The obsolete Supabase management-token entry is absent from the chat UI.
  This does not remove the separate server-authorized demo-data bridge.
- Terminals start collapsed and no idle debug shell is created by default.
  The managed run log remains available; extra browser debug terminals can be
  closed with their process detached. The UI identifies these as browser
  sandboxes, not host/server shells. Add/close was checked in the browser.
- Diff tracks changes to existing text files during the current page session,
  labels the filter as changed-file search, and drops reverted changes. It is
  not cross-refresh version history. Saving, filtering and reverting a synthetic
  file were verified without redeploying the public site.
- Sidebar selection actions have their own wrapping row. The recycle-bin
  label no longer compresses into a vertical column; select/unselect was
  visually checked. No project deletion was performed.
- Verification: 599 application tests, 114 deployment tests, TypeScript and
  production build passed. The release credential scan and 74 packaged-server
  checks also passed with zero actual model/database calls in that check.
  Local UI checks used only the synthetic publishing fixture. This fix set is
  on the test branch, not deployed to formal FC.
