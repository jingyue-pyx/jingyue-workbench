# 鲸月工作台：阿里云私有体验部署

## Public two-file regression and Netlify update passed (2026-10-06)

- The user uploaded source `43822cacd4e3a17da0c42d854a23b3ac4e6521bf`.
  Public health returned 200 and exact release
  `07f1647a2b820f18e98e0ad1261fcbb2c832b57395967c41f850b3635f7201da`;
  anonymous project access remained 401. CI run `37356846609` succeeded.
- On dedicated QA project `362b23e9-b156-46fc-976e-5b224ab84b52`, the original
  two-file request was replayed unchanged, without adding response-format hints.
  Both `src/App.tsx` and `src/style.css` changed: the fourth-version title and
  `step-control` class, input spacing/border/radius/padding, and dark-green
  buttons appeared in source and the compiled preview. This run did not reproduce
  `batch_scope` or `patch_mismatch`.
- Real preview checks passed: step 4 twice produces 8; reset clears count while
  preserving step 4; 11, 0, 1.5 and empty input show validation and disable
  increment. Whole-workbench reload restored the fourth-version source and
  preview without a new model request; increment still worked after recovery.
- Saved revision 83 was published to the existing Netlify QA site, not a new
  resource: https://jy-a6e266ef751893b769efcc46.netlify.app/ . The publish dialog
  reported public verification for revision 83. Reloading the independent URL
  showed the fourth-version title. Increment, reset, and invalid-step checks
  passed there too. Computed CSS confirmed button `rgb(6, 78, 59)` and input
  `1px` border, `6px` radius and `6px 8px` padding.
- Scope caveat: model changes targeted the two requested application files.
  The platform also refreshed its canonical `src/lib/jingyue-auth.ts` helper
  during candidate assembly and regenerated runtime/build artifacts. Therefore
  this is not a byte-for-byte guarantee that every other project file stayed
  unchanged. The helper refresh is explicit in managed controller assembly, not
  a silently accepted out-of-scope model response.
- This passes the specific static-app cloud edit/build/restore/publish regression;
  it is not a claim that arbitrary complex projects, standalone application auth,
  or all intermittent provider failures have been stress-tested. Previous failed
  runs below remain historical evidence. No FC configuration, account, permission,
  paid resource, or browser-origin access restriction was changed or bypassed.

## Host-bound single-file protocol (2026-10-06; implementation history)

- The user deployed source `44a785d`; public health returned 200 and exact
  release `4fd261ca4f4f372e9e021f8d9db863fd4b84a2963247ba739f42e1ab0fba3456`.
  Anonymous project access remained 401; the dedicated QA login and third-version
  project restore succeeded. The original unmodified two-file query still failed,
  now with `batch_scope` during generation (run
  `fa033cd0-a3dc-4810-8145-84bdfbbc8046`, `2026-10-05T18:25:03.046Z`). The browser
  loaded the expected new `Header-DG1pdPDZ.js`. This is a confirmed failed public
  regression, not a stale-page or deployment-success claim.
- The old request carried the multi-file goal and stale conversational instructions
  into each single-file batch, while asking the model to select paths again in a
  files array. This creates an avoidable protocol ambiguity. The new candidate
  supplies a scoped target instruction and read-only project context, omits stale
  chat in code batches, and asks for one `{status,summary,content}` response (or
  bounded `edits` for large files). The host binds that response to the selected
  path. This addresses the ambiguity; the exact raw offending paths from the
  failed cloud response were not captured and are not claimed here.
- Explicitly wrong paths or extra response fields are rejected, not silently
  renamed or dropped. Legacy files-array responses still traverse existing batch
  scope validation. Path/config/size checks, candidate isolation, source revision
  checks, total budget and compile/preview gates are unchanged. Only a complete
  combined candidate can replace live source.
- Regressions cover two native single-file replies, current source propagation to
  the next batch, full-content and edit modes, unchanged handling, truncation,
  malicious paths/extra fields and protected configs. Packaged checks also inspect
  the actual synthetic upstream prompt for both new and compatibility modes.
- Local candidate verification: 753 application tests, 132 deployment tests,
  TypeScript and production build passed. Packaged/Linux checks are recorded in
  the ignored release receipt. These are not a substitute for cloud acceptance.
- At candidate preparation time, the existing source/preview/public site were
  preserved and fourth-version publication was pending. The subsequent allowed
  upload and successful original-query public retest are recorded above. No FC
  configuration or permissions were changed, and the prior browser-origin denial
  was not bypassed.

## Complete-file contract follow-up (2026-10-06; candidate, not deployed)

- Public health verified release `9a6b1b172c3582c7ddd1e141ab3847f732329c553e3fa20c547ea34f5ef35db3`
  (source `1cae73b`). The existing dedicated QA account was reused successfully;
  credentials remain in a user-only local file outside this repository. No
  additional account, permission, paid resource or configuration was created.
- On QA project `362b23e9-b156-46fc-976e-5b224ab84b52`, the original two-file
  request failed during generation. The new finite diagnostic recorded
  `patch_mismatch`, run `8cde78ec-2632-4421-9530-dd777ff63c73`, at
  `2026-10-05T17:56:06.797Z`. This proves a patch-matching failure for this run,
  not the cause of the earlier `other` failure. Third-version source and preview
  remained intact; no fourth-version candidate was published.
- The protocol still suggested exact edits for small existing files and
  contained contradictory fallback guidance. This candidate requires full
  content for files under 6,000 characters from the first attempt. Larger
  files keep bounded exact edits; after a mismatch, their complete-file recovery
  cannot return to edits. The per-batch response contract now also selects a
  matching server prompt, without irrelevant edits examples in full-content
  mode. Invalid mode values are rejected; source/path/config guards and the
  existing call/token budgets are unchanged.
- Regression coverage includes editor-added JSX attributes, a model ignoring
  the requested format, bounded correction, and an actual second CSS change.
  Packaged-server checks additionally inspect the synthetic provider request
  to verify both mode prompts and safety rules, without logging prompt/source
  text or using real credentials, models or databases.
- A public control request explicitly asking for complete files did **not**
  pass: the response ended incompletely during conversation routing, before a
  new code task. This is separate from patch matching and remains an open cloud
  acceptance item. Do not report the control request or this candidate as a
  successful two-file public regression.
- 739 application tests, 132 deployment tests and TypeScript checking passed.
  Build/package checks are recorded separately in the ignored release receipt.
  The candidate still needs an allowed code upload and a repeat of the original
  normal-language query, compile/preview/save/restore and public site update.
  FC browser access remains blocked by auto-review; no alternate access path
  has been used. Environment variables, accounts and cloud permissions remain
  unchanged.

## Unclassified cloud generation failure (2026-10-06; follow-up candidate)

- The user uploaded release `2811aa5cad45a202349b85b9bbf9cc2c6c830fe0c47e37ce13369268514e9017`
  (source `65599dd`). Public `/healthz` returned that exact release ID and 200;
  anonymous `/api/projects` remained 401. Upload succeeded.
- In QA project `362b23e9-b156-46fc-976e-5b224ab84b52`, a subsequent actual
  App.tsx + style.css modification failed during generation with reason
  `other`; the third-version source and preview remained intact. The browser
  console did not retain the actual generation error. Its update-checker
  warning is unrelated. No fourth-version candidate was published. This is
  **not** a successful two-file acceptance, and the historical cause remains
  unproven.
- Inspection found malformed file entries (missing/non-string content or
  duplicate paths) were rejected as non-repairable generic runtime errors,
  bypassing bounded batch correction. These now get an explicit format error
  and the existing bounded correction; unsafe paths, protected configuration
  and oversized content still fail closed. Regression fixtures require both
  an App change and subsequent CSS change, without mutating the live input.
- Typed finite labels distinguish protected config, unsafe paths, size and
  browser recovery-storage failures, plus native internal exceptions. Only
  allowlisted outcome/stage/reason/task IDs reach browser/server logs and saved
  history, never raw model replies, file content, credentials or Error objects.
  This enables diagnosis of the next real failure without weakening guards.
- The code-only FC console attempt was still denied at the origin level by
  browser auto-review. No alternate console, CLI, API or credential path was
  used. A new code package needs an allowed upload before public acceptance
  can resume. Environment variables, resources and cloud permissions are not
  changed by this candidate.
- Verification so far: 737 application tests, 132 deployment tests and
  TypeScript checking passed. Malformed-entry regressions cover correction and
  continuation into the second changed file; protected-path/config/size guards
  and private-canary log tests remain enforced. Build/package verification is
  recorded separately in the release receipt. These local checks do not prove
  the unclassified historical cloud failure fixed.

## Two-file cloud acceptance follow-up (2026-10-05; uploaded 2026-10-06)

- Real public acceptance used the dedicated QA project
  `362b23e9-b156-46fc-976e-5b224ab84b52`. A request to update `src/App.tsx`
  and `src/style.css` failed with the old generic batch-validation notice.
  A subsequent single-file request completed compilation/preview, save and
  whole-workbench restoration. Saved revision 39 was published to the existing
  `jy-a6e266ef751893b769efcc46.netlify.app` site. Step input, increment,
  invalid-value disabling and reset worked on the public page; anonymous HTTP
  returned 200. These results validate the small scoped path, not the failed
  two-file request or this new candidate. No site or paid resource was added.
- The page still loaded `Header-DRgLLWJH.js`, matching the retained
  `jingyue-private-rJyrBw` artifact. Its scheduler grouped small existing files
  and could reject an unchanged full-file response before reaching the actual
  changed file. An isolated replay of that deployed logic reproduced the same
  generic failure in four calls: a CSS/App batch, followed by two identical-CSS
  attempts. The candidate's single-file scheduler skips unchanged CSS and
  reaches the App change in three calls. Both CSS-first and App-first ordering
  now have regression coverage. The actual failed cloud response was not
  retained in accessible logs: this proves a matching implementation defect,
  not which exact subtype occurred in that historical request.
- The new package includes the previously unshipped single-file scheduling,
  identical-file skipping and exact-scope corrections. This follow-up makes the
  response example use each actual batch path instead of encouraging an App
  response during a CSS batch, and explains that a batch-local no-op does not
  mean the whole task is complete. New files still cannot be skipped; all
  candidates must pass aggregate checks and compile before replacing live code.
- Exhausted validation now retains a finite reason in the visible result,
  saved conversation outcome and authenticated runtime event: invalid patch
  format, exact-edit mismatch, out-of-batch path or missing required file.
  Raw model replies, source, paths and credentials are not added to logs.
  Historical generic notices stay unknown; no cause is fabricated for them.
- Verification: 89 targeted application checks, all 722 application tests,
  131 deployment tests and type checking passed. The first full run used Node
  25's experimental global storage and failed the existing DOM tests; the
  documented `NODE_OPTIONS=--no-experimental-webstorage` rerun passed with no
  removed assertions. One new test fixture's incomplete TypeScript shape was
  corrected. Production build and final package checks are separate release
  gates; consult the final artifact receipt for their outcome.
- Upload is a code-only update of the existing FC function: preserve current
  environment variables, credentials, database permissions and resource sizes.
  The earlier denied cloud-console path must not be bypassed. After an approved
  upload, verify the release digest, rerun the original two-file query, then
  repeat save/refresh and update the same Netlify QA site. Do not label the
  candidate deployed before these gates complete.

> 当前状态（2026-10-05）：用户 Netlify 授权与静态网站公网发布已启用，首次发布及同站点更新已实测。下方按日期保留了曾经禁用的历史状态；以文末最新记录为准。OpenCode 不在公网启用，生成应用预览专用认证/存储不随静态网站发布。

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

## Netlify personal-account static publishing (user entry deployed; provider disabled by default)

This is separate from the legacy browser-token connector. Account-mode users can
connect under **Settings → Connection → Netlify 连接**, even without opening a
project. The project header's **发布网站** dialog shares the same authorization
component. The workbench layout and model workflow are unchanged. This integration
does not publish the workbench itself.

The entry distinguishes platform-disabled, disconnected, awaiting official
consent, and connected states. It accepts no personal tokens or OAuth application
secrets. When disabled, it explains that setup belongs to the administrator and
offers a status recheck; adding this entry does not enable cloud publishing.
Users explicitly open the verified Netlify ticket URL, approve on Netlify, then
check the connection. Merely entering Settings creates no ticket or site. Disconnect
has its own confirmation, removes only the workbench's binding, and explains that
full revocation must be performed on Netlify. Published sites are not deleted.

2026-10-05 entry verification: 651 application tests, 20 publishing/setup tests,
TypeScript, changed-file lint and the production build passed. On an isolated
local workbench (new test database, no selected project), Settings rendered the
connection entry, a real Netlify ticket URL was returned, and checking before
official consent correctly stayed pending. Success/disconnect/error states were
covered with mocked provider responses. The subsequent public rollout is recorded
below; this entry does not enable standalone generated-app authentication.

### User connection entry public rollout (2026-10-05)

- Deployed `jingyue-private-rJyrBw.zip` to the existing Hong Kong FC
  `jingyue-workbench` / `jingyue-christine.xin`. No environment variables,
  credentials, database permissions, schemas or resource specifications changed.
  The previous `jingyue-private-IlmPoV.zip` remains available locally for rollback.
- Browser acceptance exposed the pre-existing 1200px fixed settings dialog being
  clipped in the 530px side panel. Limited the dialog to viewport width, allowed
  header wrapping, and labelled its back/close buttons. Local 530px acceptance
  measured the dialog at 498px with 16px margins; public read-back also displayed
  the entire Netlify card and working status-recheck button.
- Final build, type check, changed-file lint and 25 focused publishing UI tests
  passed. Secret scanning and all 74 packaged checks passed with no real model
  or database calls. Prior complete application regression passed 651 tests;
  the small responsive-only follow-up reran the focused suite above.
- Public `/healthz` and `/login` returned 200; unauthenticated `/api/projects`
  and `/api/publishing` returned 401. Settings → Connection and the project
  publishing dialog both showed the new shared authorization UI. Rechecking
  correctly retained the platform-disabled state, not a false connection.
- Whole-page reload preserved the workbench login and restored acceptance
  project `b6d5bc09-1ddc-46e1-bf3e-647e7031d4fc`, its saved source and the preview
  application's authenticated welcome page. No model call or app registration
  was made for this deployment verification.
- Cloud Netlify publishing is still disabled: platform OAuth/encryption/storage
  setup has not been transferred or enabled by this code-only rollout. No cloud
  OAuth grant, team selection, website creation or real deployment to Netlify
  was attempted. Enabling and verifying that separate integration remains work
  to do; the new entry alone is not an end-to-end publishing acceptance.

### Cloud enablement follow-up (2026-10-05; first static publish verified)

- With explicit authorization, applied `sql/005-publishing.sql` in the existing
  cloud database as `jingyue_migrator`, then granted only SELECT, INSERT, UPDATE
  and DELETE to `jingyue_app`. Read-back verified each privilege, migrator table
  ownership, no PUBLIC grants and no runtime schema CREATE privilege. Existing
  account, project and source records were not changed.
- The local platform application ID and stable vault key were checked without
  printing their values; both were present and the key/file-permission checks
  passed. Opening the cloud environment editor was denied by the safety check
  because it could reveal existing credentials; no alternative access path was
  used. The user subsequently added the three publishing variables manually.
  The public workbench changed from disabled to enabled, and the user personally
  granted the Jingyue application on Netlify's official authorization page.
  The cloud workbench successfully exchanged that grant and displayed the
  connected account. No local user's Netlify grant was transferred.
- Real public generation acceptance used a new synthetic project
  `d19a1622-e821-490b-8631-733d5f4bc3b8`, preserving the existing app-auth demo.
  The first request was rejected during planning. Reproduction exposed a
  capability-classifier bug: an explicit exclusion such as “不包含个人数据、
  登录注册、数据库” was treated as a requirement for real authentication.
  The local fix removes explicitly negated feature lists before checking all
  three auth requirements, while preserving later positive requirements.
  English `registration` is now recognized too. No real-auth validation or
  publishing restriction was disabled.
- A second public generation reached the bounded batch budget and stopped
  without replacing source. Narrowing the test to two generated files produced
  a styled static page, passed the runtime pipeline and saved source to cloud.
  Counter increment/reset and a subsequent model-driven copy-only modification
  were verified in the real preview. Unsupported hosting/security promises in
  generated copy were removed. A whole-workbench reload restored the modified
  source and preview without another model call; the counter worked again.
  Its count correctly reset because this fixture deliberately uses memory-only
  state, not persistent application data. This does not validate arbitrary large
  requests or resolve the earlier batch-budget failure.
- Local fix verification: 664 application tests, 30 publishing/app-auth
  deployment tests, type check, production build, secret scan and 74 packaged
  checks passed. The Node gateway tests require loopback permission; their first
  restricted run failed on port access, and the permitted rerun passed.
  Candidate package: `jingyue-private-WwH1cj.zip`; it is **not deployed**.
  The public workbench still runs `jingyue-private-rJyrBw.zip`.
- Cloud Netlify consent and connection are verified. The selected team was
  checked in Netlify's official dashboard and is on the Free plan. Publishing
  saved revision 29 successfully built and uploaded five static artifacts. The
  Netlify project is `jy-fe7129805a75eef95f551150` (site ID
  `a85ff6fe-b9ed-4e61-99bb-dbfd2add0adb`), with published deploy
  `6ac319e5516291aec61bdd1f`. Netlify initially protected the production site;
  the workbench correctly stopped at `access_unverified`. After the user
  explicitly confirmed, only this site's production access was made public.
  Netlify reports **Public production site**, while project management and deploy
  previews remain private. Team-wide protection was not changed.
- Returning to the cloud publishing dialog and advancing the existing job
  changed its status to “已发布，公网访问已验证” for revision 29, without a rebuild.
  An independent request without cookies or authorization returned HTTP 200
  directly from `https://jy-fe7129805a75eef95f551150.netlify.app/`. The independent
  site rendered the expected copy; increment 0 → 2, reset 2 → 0 and full-page
  refresh passed. The first generated-static-site → cloud save → user OAuth →
  build/upload → publicly accessible Netlify deployment is verified for this
  synthetic example. This is not validation of standalone app authentication
  or backend persistence, which remain outside this publishing scope.
- A second publish of the same saved revision was started to test site reuse,
  but the workbench redirected to login during the attempt. No second deploy
  appeared in the official site's activity, and the first published site remains
  available. That attempt did not pass; equivalent same-site update acceptance
  subsequently passed under the dedicated account documented below. No plan
  upgrade or paid subscription was requested. The separate local capability fix above is still
  not deployed, and the larger-generation batch-budget issue remains unresolved.
- With the user's authorization, a dedicated synthetic workbench test account
  was registered via the public API and signed in through the real login page.
  Registration, password login, session identity and wrong-password rejection
  passed. A request for the original owner's synthetic project returned 404,
  and publishing status confirmed the new account does not inherit that owner's
  Netlify connection. Its random password is stored outside the repository in a
  mode-0600 local file, under a mode-0700 directory; no password or session token
  was printed. With the user's subsequent explicit approval, this account
  completed its own official Netlify authorization and encrypted cloud binding;
  no other workbench user's stored grant was copied.

### Independent-account publishing regression (2026-10-05)

- The test account created project `362b23e9-b156-46fc-976e-5b224ab84b52` through
  the real cloud conversation UI and model pipeline. A minimal React/Vite page
  was generated, compiled, previewed and cloud-saved. Its counter increment was
  verified. Revision 7 built and uploaded five artifacts to Netlify site
  `fdcb751c-9913-4316-89f6-ca914b0bc2bd`, named
  `jy-a6e266ef751893b769efcc46`.
- A second real model request changed the heading to “鲸月独立账号验收 · 第二版”
  and changed the counter button from +1 to +2. Compilation and preview passed;
  two clicks produced 4. Revision 14 was confirmed by an independent authenticated
  cloud read, including the modified source. Reading the original user's
  publishing record as this test user was denied with HTTP 404.
- Publishing revision 14 reused the **same site ID and hostname**, rather than
  creating another site. Netlify's official activity shows first deploy
  `6ac32f2ace190d3303eb3ade` and replacement deploy `6ac3304dc541673232c48112`.
  The replacement job is `6f9e4818-43ef-4973-95a1-2e38939207a6`.
  The actual hosted second-version page was checked using the authorized
  Netlify session: heading, +2 (0 → 4) and reset (4 → 0) passed.
- A full workbench reload restored the second-version source and preview
  without another generation request. A separate logout/login check also passed:
  the same account reopened the project, restored the second-version preview
  and displayed its existing Netlify connection without another OAuth grant.
  Recovery/status messages raised the current project revision to 20; the
  hosted second-version source was published at revision 14.
- This new site's production access initially remained private: anonymous HTTP
  checks returned 401 and the job correctly stayed `access_unverified`.
  After the user explicitly confirmed public access for this site, Netlify
  displayed “Your project is public” and “Anyone can visit your production
  site.” Only this site's production access changed; no team setting changed.
  An independent request without cookies or authorization then returned HTTP
  200 from `https://jy-a6e266ef751893b769efcc46.netlify.app/`.
- Advancing the existing job, without another build, changed the workbench to
  “已发布，公网访问已验证” for revision 14. Reloading the independent public
  page showed the second-version heading; +2 twice (0 → 4) and reset (4 → 0)
  passed. This completes the synthetic cloud generation → save → user OAuth →
  initial publish → same-site update → anonymous access acceptance. It does not
  validate arbitrary generation requests or standalone backend/auth features.
  No paid upgrade, Netlify agent run, or backend deployment was made.
- Evidence outside the repository: `jingyue-qa-republished-v2-20261005.jpg`,
  `jingyue-qa-site-public-confirmation-20261005.jpg`,
  `jingyue-qa-public-v2-20261005.jpg` and
  `jingyue-qa-published-verified-20261005.jpg` in the workspace root.

  Local browser proof files are kept outside the repository:
  `jingyue-publishing-permissions-20261005.jpg`,
  `jingyue-cloud-generated-site-20261005.jpg`,
  `jingyue-cloud-publishing-blocker-20261005.jpg` (historical blocker) and
  `jingyue-netlify-public-acceptance-20261005.jpg` in the workspace root.

### Public-workflow hardening candidate (2026-10-05; not yet deployed)

Approved scope: increase the bounded task budget, ship the pending capability
fix, expand real-user acceptance, improve private-site guidance/recovery and
archive a reproducible version. No daily account quota, cloud resource size,
subscription, database permission or website access protection is increased.

| Change | Reason | Resulting design |
| --- | --- | --- |
| Managed generation budget 16 → 32 calls, 80,000 → 160,000 reserved output tokens | Full file manifests and bounded corrections could exhaust the old budget even with short actual responses | Finite per-task ceilings remain; every call still traverses account/global quotas. Per-call token limits and two code-repair rounds are unchanged. Reservations are conservative and are not a billing cap. |
| Negated real-auth requirements | “不要登录、注册和数据库” was misclassified as requiring authentication | Excluded feature lists are removed before capability classification; positive requirements still enforce real-auth integration. |
| Atomic modification batches | Real marketing-page modification returned paths outside its assigned batch, then exhausted scoped correction | Existing-file edits now use one file per call. The output contract is repeated after source context and correction names the allowed and returned paths; scope validation remains strict. Only new modules may share a batch. |
| Identical-file batches | A complete but unchanged existing file was misclassified as an invalid empty aggregate patch, consuming correction calls before later files | Compare validated content with the candidate before aggregation. Skip identical batches and continue to the actual integration changes; an all-identical response is explicitly not verified implementation. |
| Durable routing failure feedback | A model connection failure before planning produced only a short-lived toast, leaving the latest question apparently unanswered | Preserve a bounded failure reply in conversation history, distinguish timeout from cancellation, and normalize pre-header network errors without exposing raw transport data. No silent model retries or quota bypass. |
| Return-to-workbench public check | A provider-ready site can still return anonymous 401 | Focus/visible/online events recheck the existing pending job, with single-flight and a cooldown. Never rebuild, create a duplicate site or disable Netlify protection automatically. |
| Cancellable publishing | Closing the dialog or switching project could leave requests/polling active | Abort signals reach fetch and backoff; late status responses cannot update another project. Already-submitted remote operations are preserved for reconciliation. |
| Dependency and preview reuse | A snapshot can omit runtime lockfiles; retrying preview transport should not redo compilation | Same-sandbox unchanged dependency inputs reuse a checked install. Unchanged compiled source reuses a live development server and reruns the authenticated frame handshake. Whole-page refresh still creates a new browser sandbox. |
| Publishing install recovery | SDK stdout can stay open after process exit, and registry failures can be transient | Exit code remains authoritative; output drain is bounded. Retry transient installation once, never retry code errors or blindly repeat provider creation. |
| Traceable releases | A visible UI alone cannot establish which bundle is online | The archive includes `release.json` with source commit, dirty flag and build time. `X-Jingyue-Release` exposes only a validated server-bundle SHA-256; packaging also reports ZIP SHA-256. CI covers main and codex branches on Node 22. |

Verification so far: 684 application tests and 128 deployment tests passed;
TypeScript and production build passed. On this local Node 25 environment the
first application run hit native Web Storage / jsdom conflicts; rerunning with
`NODE_OPTIONS=--no-experimental-webstorage` passed without changing assertions.
CI uses Node 22 to match the deployment runtime. The restricted build initially
could not open the local proxy port; the approved rerun passed. Browser/model
acceptance and the final release artifact are recorded below as they complete.

Real-browser check uses an isolated local workbench database and the real Bailian
model, not the production user projects. A marketing Agent with campaign list,
filters, form, statistics and details generated, typechecked, built and previewed.
Creating a campaign with an 8,000 budget and opening its details worked. After a
graceful service restart and whole-page refresh, conversations, saved source and
preview recovered without regenerating source. In-memory campaign entries reset
as requested; that is not a test of remote business-data persistence.

The first follow-up modification failed strict batch-scope validation and did
not overwrite the prior preview. After the atomic-file correction, the real
marketing modification passed: required campaign owner field, visible in-memory
demo notice, an 8,800-budget form submission/details and status filtering. A full
refresh restored source/history, the new fields and the preview. One intervening
attempt hit a model stream interruption before planning; it is recorded as a
failure, not hidden by the successful retry.

The supply-chain initial generation passed after bounded automatic repair.
Adding quantity 3 at unit price 120 produced amount 360, count 6 and total 51,310;
search and details matched. Its follow-up date/remarks change first hit a model
stream interruption, then a bounded batch-format failure. The prior source and
preview remained usable. Regression reproduced a distinct identical-file batch
bug and its correction; follow-up browser acceptance is recorded below rather
than inferred from test passes.

Final local follow-up acceptance (source `9f8b595`, real Bailian model): the same
supply-chain change completed after bounded automatic repair, updating six files.
Date and remarks were submitted and shown in order details (2026/10/12 and the
test note), quantity/price arithmetic and search worked, and combined approved
status + Shenzhen supplier filtering selected the correct single order. The
browser's synthetic `fill()` alone did not commit a date to React state; normal
keyboard date changes did, so the date assertion uses that real UI interaction.
After a whole-page refresh, history, modified source, date/remarks controls and
preview recovered without a model call. In-memory test orders reset as specified.
The duplicate filters were removed, although the retained set is above the form
rather than immediately above the list; this is a remaining generated-layout
detail, not an unimplemented filter or failed compilation. These two examples
are useful coverage, not a guarantee that arbitrary generated applications work.

Final code artifact: `deployment/releases/jingyue-private-fLXPAI.zip`, source
`9f8b5952b43701878d7dd4d3b3211ed5b4651e64`, clean source at packaging.
ZIP SHA-256: `4ae7666be5bed26ddd4f3713034da77994c85913237d7e9463581a3bfcc35486`.
Release ID: `b7b1715342a6e66fc9760d961dbcf8b2c54447295a83c987e31d86f598dd34fc`.
Its credential scan and all 76 packaged checks passed on both macOS and Linux /
Node 22.23.3, with no real model or database calls in the packaged smoke test.
The final code's Linux / Node 22 CI also passed:
https://github.com/jingyue-pyx/jingyue-workbench/actions/runs/37271892411 .
This final acceptance note is documentation-only and postdates that artifact;
it does not change the artifact's source identity or claim it was uploaded.

Linux / Node 22 GitHub CI passed for source checkpoint `7e713d9`:
https://github.com/jingyue-pyx/jingyue-workbench/actions/runs/37270220307 .
Its candidate archive `jingyue-private-o9v2zH.zip` passed the credential scan and
76 offline packaged checks on macOS and Linux / Node 22, with zero actual model
or database calls. That archive predates the final identical-file/routing fixes;
use a final clean-commit archive and its `release.json`, not this superseded
checkpoint package. Linux smoke verification reads RSS from `/proc` so it also
works in a minimal Node container without the `ps` utility.

Deployment gate: do not count the existing online small-page acceptance as
acceptance of this new candidate. The cloud configuration console remains outside
the approved tool access path; no alternative credential/API route is used to
bypass that denial. A new archive can be handed off for the existing function's
code-only update, preserving all environment variables, permissions and resources.
After upload, compare `X-Jingyue-Release` with `release.json`, then rerun the
generation / modification / save / publish acceptance before marking deployed.
Rollback uses the retained previous `jingyue-private-rJyrBw.zip`, with the same
environment and database; do not reverse additive auth/publishing migrations or
delete projects to roll back code.

### Five-round follow-up audit (2026-10-05; candidate, not a cloud release)

Target: online generation → modification → compilation/preview → saved recovery →
publication to the user's Netlify account. Each round below includes a reproduced
gap, a scoped correction and regression. Mocked provider tests do not count as a
new production deployment, and previous production acceptance does not validate
this candidate.

| Round | Gap and evidence before the correction | Correction and verification |
| --- | --- | --- |
| 1 — Response integrity | Seven failing assertions: empty/HTML/malformed authorization responses were swallowed as `{}`, `pending: false` without a connection could be accepted, unknown job phases passed through, and expiry had no useful message | Validate action-specific response discriminants, reject redirects/invalid bodies and preserve aborts. Never implicitly retry a remote mutation. 37 client/connection/dialog checks passed. |
| 2 — Stop and isolation | UI regression reproduced a stop button that remained pending while sandbox boot hung, waiting up to 30 seconds | Make sandbox wait abortable without cancelling the shared sandbox. Discard late progress from a closed dialog or another project. 44 publishing tests passed, including cancellation, timeout and no late build. |
| 3 — Same acceptance gate before publication | Two failing regressions: publishing accepted unconfigured Tailwind, and a TypeScript project without generated `tsconfig.json` skipped typecheck | Check style dependencies before building. Preview/candidate/publication share a host-owned strict TypeScript configuration; model source cannot remove the check by omitting its config. 72 runtime/build tests passed; TypeScript passed after a test-only unknown-value assertion was corrected. |
| 4 — Public entry verification | Two failing backend regressions: a public marker with a 404 homepage counted as published, and a ready deployment with an invalid URL became stuck with no actionable failure | Require anonymous nonempty HTML homepage plus matching release marker; allowlisted HTTPS host, no redirects or credentials. Keep uncertain jobs and recheck the same deployment. Invalid provider URL keeps upload state/artifacts and explains the error. Four targeted PostgreSQL-backed tests passed. |
| 5 — Integrated release checks | Live GET `/healthz` returned 200 while HEAD redirected to login; local regression reproduced a 401 for HEAD. This makes some deployment probes report a false outage | Support minimal GET/HEAD health equally, preserving authentication on every other surface; verify digest headers and empty HEAD body in the packaged check. Full application suite: 698 tests. Full deployment suite: 130 tests. Production build passed. Final package/CI receipt is recorded separately after verification. |
| 6 — Real-model follow-up | The existing supply-chain test project's small “clear search” modification failed before coding and showed only `An error occurred`. Retest with safe diagnostics identified a model transport/network failure, not a compiler or file-protocol failure | Map structured transport/status codes to actionable UI failures; log only an allowlisted reason, phase and sanitized trace metadata. No source, key or provider error body is logged. Disable hidden SDK retries so one quota-counted request is one upstream call. Keep the last working source and preview. The connection interruption itself remains an external stability gap, not a claimed successful modification. |

The sixth-round browser retest was made on the same local database/project after
restarting the candidate: saved conversations/source and the existing supply-chain
preview recovered, while the new model request failed in the intent stage with
`JINGYUE_MODEL_NETWORK`. It did not stop the existing preview or overwrite source.
Final application suite: **709 / 709** across 63 files; deployment suite:
**130 / 130**; typecheck and production build passed. Local Node 25 again needed
the documented `NODE_OPTIONS=--no-experimental-webstorage` to avoid shadowing
JSDOM storage (without it, 16 tests in two files fail before exercising the
feature). No assertions were removed. Packaged Linux/Node 22 evidence is recorded
in the release receipt after verification; it does not turn that real-model
failure into a passing end-to-end run.

Candidate receipt (07:05 UTC; **not uploaded to FC**):

- Source: `1af20d3918470665df1d7c7be12c36f94e117712`, clean at packaging,
  pushed to `codex/opencode-serve-poc`.
- Archive: `deployment/releases/jingyue-private-7YHzqU.zip` (local ignored artifact).
  SHA-256: `e4c3b6b86c8026a5cdd14094ebe45cedee74450de7dc5b68378562536ced43ac`.
- Release ID: `bb12c85d1111dab7ea1715d6b4de8c1c6c5303e82c4f1cdad7430219238a97fc`.
- Credential scan passed; 386 allowlisted files, 25,064,385 uncompressed bytes.
  No local environment files, tokens or native dependencies included.
- Packaged checks: **84 / 84** on macOS Node 25.8.0 and **84 / 84** on
  offline, read-only Linux Node 22.23.3; zero real model/database calls.
  The new synthetic provider-failure check confirms exactly one upstream call,
  safe error mapping/logs and no raw provider-body disclosure.
- [Linux Node 22 CI](https://github.com/jingyue-pyx/jingyue-workbench/actions/runs/37275627379)
  passed build, typecheck and all application/deployment tests for that commit.
- An additional credential-free empty POST to the official Bailian endpoint
  timed out after 10 seconds on this machine. This corroborates a transport
  availability problem but does not establish whether local routing, proxy,
  upstream connectivity or the provider is responsible; do not claim it fixed.
- Browser evidence: `jingyue-six-round-local-evidence-20261005.jpg` at workspace
  root (not committed). The updated diagnostic is visible and the prior preview
  is retained; the requested clear-search modification did **not** complete.

Production baseline at 06:33 UTC: GET health returned `{"status":"ok"}` but no
`X-Jingyue-Release`, so it is not the traceable candidate. Existing published test
site `https://jy-a6e266ef751893b769efcc46.netlify.app/` still rendered its second
version after a fresh reload; +2 twice gave 4 and reset gave 0. These are checks
of the **previous** deployment. Screenshot: workspace-root
`jingyue-public-five-round-baseline-20261005.jpg` (not committed).

Remaining release gate: cloud-console tool access is still blocked. Do not try
another credential/API route around that restriction. The code-only archive must
be uploaded to the existing function via an authorized path, without changing
environment variables, DB grants, pricing or site exposure. Then match the live
release digest and repeat authenticated generation, modification, persistence and
same-site publication against that version. Independent published auth/storage
and a cloud OpenCode sandbox remain outside this static-publication scope.

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

### Original-query acceptance follow-up (2026-10-04)

- Replayed the user's original request for a login/registration page with
  accounts actually stored in a database and reusable on the next login.
  Tests used separate local projects, the configured Bailian model and the
  loopback acceptance server; no original project or public site was changed.
- The first real run incorrectly answered that an empty new project needed
  existing source. Explicit new-project requests now enter the task pipeline;
  quoted, negated, deferred requests and diagnostic questions do not gain write
  authority from matching a creation keyword. The classifier contract also
  distinguishes empty new-project context from missing diagnostic source.
- The next real run asked whether localStorage simulation was acceptable.
  Selecting **real backend required** still produced a simulated-auth plan
  with an enabled confirmation button. The current bounded demo JSON storage
  is not an application authentication service. A deterministic capability
  check now rejects this unsupported real-auth requirement before generation,
  removes the misleading simulation title, and does not accept a model's
  `supported=true` as proof that a backend exists.
- Unsupported plans without actionable questions terminate with an explicit
  capability explanation rather than waiting at a disabled confirmation.
  Runtime diagnostics distinguish this from compilation failure or an expired
  workbench login; telemetry still uses finite labels, not raw model content.
- The original query is **not a passed end-to-end feature acceptance**: real
  generated-app registration, credential verification and sessions still need
  a separately provisioned authentication integration. Existing workbench
  account authentication is unchanged. No simulated credential database was
  approved or generated, and the screenshot's original TypeScript error was
  not reproduced by these new runs.
- Regression: 622 application tests, 115 deployment tests, TypeScript and
  production build passed. Release secret scan and 74 packaged-server checks
  passed without real model/database calls in those package checks. The title
  correction was additionally covered by 193 targeted tests. This is a local
  acceptance fix, not a production rollout or a claim of stable generation for
  all requests.

## Generated-application authentication — preview-only opt-in

This supersedes the earlier unsupported-auth boundary **only when** the server
explicitly enables `JINGYUE_APP_AUTH_ENABLED=1`. Workbench login is unchanged.
Supabase Auth stores application users and verifies passwords. The existing
server-only `JINGYUE_SUPABASE_URL` / `JINGYUE_SUPABASE_SERVICE_KEY` configuration
is reused; never expose the secret to a generated project, browser or repository.

- Apply `sql/006-app-auth.sql` with the migration role, then apply
  `sql/007-app-auth-runtime-grants.sql` in the existing `jingyue` database to grant
  runtime SELECT/INSERT/UPDATE/DELETE on its three tables. Production boot never applies
  this migration. The local managed preview applies it to its local test DB.
- Usernames are scoped to the owning workbench account and project. Synthetic
  non-deliverable identities are created through the server-only admin API;
  this is username authentication, not verified ownership of an email address.
- `POST /api/app-auth/:projectId` requires the workbench session, same-origin
  request, current account header and project ownership. Bounded actions are
  status/session/register/login/logout. No SQL or arbitrary provider URL.
- Passwords are validated by Supabase and never persisted by the workbench.
  The temporary Supabase password-check session is closed immediately. The
  browser receives an independent HttpOnly/SameSite=Strict, production Secure,
  path-scoped cookie; only its SHA-256 digest is stored in the workbench DB.
  Sessions expire after 24 hours and are invalidated by logout or changed/deleted
  upstream identity. At most five sessions are retained per application user.
- Demo limits: 20 identities per project, 100 per owner, ten register/login
  attempts per username per 15 minutes, 120 total auth requests per project per
  15 minutes, two concurrent gateway requests. Reservations count toward the
  limit even after an uncertain remote response; try login after a lost reply.
- `src/lib/jingyue-auth.ts` is the platform-owned generated-app hook. Its
  preview bridge checks the iframe source and origin, sends credentials only
  after binding to the workbench origin, and returns only the public profile.
  The helper never persists passwords or tokens. Model capability flags are
  derived from the server, and a real-auth task must actually import the hook.
- Business-data row permissions, roles, password reset, email/SMS verification
  and standalone Netlify authentication are **not** delivered by this slice.
  Publishing artifacts using the preview-auth bridge is blocked. A public
  gateway and allowed-domain binding are separate future work.

Local verification: `JINGYUE_RUN_AUTH_LIVE=1 node deployment/app-auth-live.mjs`
uses the protected local configuration, creates one isolated synthetic user,
checks real password verification/relogin/session/logout, then deletes that
exact test user. It prints only pass/fail metadata, not credentials.

### Preview-auth acceptance (2026-10-04)

- Replayed the original registration/login query against the real model. The
  generated React application uses the platform helper and real Supabase Auth;
  registration, duplicate-account rejection, wrong-password rejection, later
  login, session restore and logout passed the live integration check. Its
  isolated synthetic integration-test identity was removed after verification.
- Browser acceptance additionally verified the generated login screen, wrong
  password feedback, authenticated dashboard, whole-workbench refresh and mouse
  logout. One automatic repair resolved a generated duplicate BrowserRouter.
  Acceptance also exposed independent hook instances and focus checks that
  unmounted buttons during clicks. The canonical helper now shares one
  in-memory auth store and keeps background session checks non-blocking; both
  defects have regression coverage and were rechecked on the same project.
- 633 application tests, 126 deployment tests, TypeScript and production build
  passed. The release credential scan and 74 packaged-server checks passed;
  package checks made no real model/database calls. The package was checked on
  macOS, not Linux. This is local preview acceptance, not a production rollout,
  a standalone published-site auth service, or proof that every generated app
  is correct. A separate synthetic UI account remains for local acceptance.

### Public rollout (2026-10-04; authenticated cloud smoke test passed)

- Existing target verified: Hong Kong FC `jingyue-workbench`, Node.js 22,
  1 vCPU / 2 GB, custom domain `jingyue-christine.xin`. No resource changes.
- User approved the three-table runtime grant and transfer of the existing
  Supabase server configuration to this FC function. The three app-auth tables
  were created as `jingyue_migrator`. Read-back verified all three allow runtime
  SELECT/INSERT/UPDATE/DELETE, are owned by the migrator, and the runtime role
  still cannot CREATE in the schema. PUBLIC privileges on these tables were
  revoked. The existing project count remains 16; no project migration/deletion.
- Current deployed code was exported and copied to the ignored local release
  directory as `jingyue-pre-app-auth-20261004.zip` (5,660,502 bytes). A new FC
  version snapshot was attempted but not verified; only the downloaded code
  backup is confirmed. Existing cloud version 1 is older and must not be
  presented as a snapshot of today's LATEST configuration.
- Initial artifact `jingyue-private-ohBom6.zip` failed cloud startup after auth
  configuration activated a legacy demo-storage configuration check. Auth and
  demo data share credentials, but demo data now opts in only through its own
  project binding. Invalid credentials still fail closed when data is enabled.
- Recovery incident: the console reordered environment rows after saving.
  Clearing new settings by stale row positions affected three original fields.
  They were restored from the retained original form, with accessibility
  metadata stripped. The old workbench access credential also appeared in a
  diagnostic tool result; user was informed and credential rotation is pending.
  No credential is recorded here. Future configuration updates must resolve
  rows by variable name and verify original values without logging them.
- Original code/configuration recovery was verified with HTTP 200, then fixed
  artifact `jingyue-private-IlmPoV.zip` (6.08 MiB displayed by FC) was deployed.
  Supabase URL/key and `JINGYUE_APP_AUTH_ENABLED=1` were set by variable name,
  preserving existing fields. No Netlify or OpenCode cloud execution enabled.
- Fixed release: 18 focused and 127 total deployment tests passed; secret scan
  and 74 packaged checks passed. An additional auth-only packaged startup check
  verified health/login HTTP 200 using synthetic configuration and zero external
  requests. Final public `/healthz` and `/login` returned 200; unauthenticated
  app-auth returned 401. The public login page rendered in the browser.
- The user subsequently signed into the public workbench. A separate acceptance
  project (`b6d5bc09-1ddc-46e1-bf3e-647e7031d4fc`) replayed the real registration/
  login query: generation, dependency installation, checks and preview readiness
  completed; the login and registration forms rendered and cloud save was
  confirmed. Existing projects were not changed. This new test project is in
  addition to the 16 projects counted before rollout.
- The user completed the preview-app credential flow. The generated application
  displayed an authenticated welcome page. A whole-workbench reload restored the
  saved source and the same application identity without another model call.
  A project-scoped, read-only database query confirmed one mapped remote account
  and one unexpired session. No password, token or session digest was queried.
  This verifies the public preview authentication/session-restoration path, not
  merely the local tests or an in-memory logged-in UI.
- Duplicate-account/wrong-password rejection, logout and cross-project isolation
  have local integration/regression evidence above, but have not been replayed
  in this public browser acceptance. The public account is left signed in for
  user acceptance; do not claim the entire negative-path suite passed publicly.
  Standalone Netlify authentication remains out of scope.

## 2026-10-06 — bounded recovery for oversized single files

- The previous scheduler split a failed batch down to single files, then retried
  the same overflowing file once. It had no executable module-extraction step.
  The replacement keeps completed candidates and replans only that target into
  1–4 new source modules/styles plus the original integration file, generated
  separately. Existing and queued paths/configuration cannot be overwritten by
  extraction. There are at most two extractions per task, no recursive child
  extraction, and no increase to the existing request/token budgets.
- Regression coverage includes successful extraction, invalid/colliding paths,
  missing or unchanged integration, truncation inside an extracted child,
  cancellation, concurrent editing and quota exhaustion. Truncated JSON remains
  rejected and the normal candidate compile/preview gates remain in place.
- Application tests: 777 passed; deployment tests: 132 passed; typecheck and
  production build passed. The runtime bundle passed 124 offline packaged checks
  on Linux / Node 22.23.3, with zero real model/database calls in those checks.
- The user's original marketing-Agent prompt was tested against real Bailian
  Qwen3 Coder Next in an isolated local workbench at port 9033. Plan, manifest
  and three generation batches ended normally; generation batch outputs were
  2649 / 1574 / 113 tokens. The project passed typecheck/build/preview. Changing
  the goal to new-product launch and budget from 8000 to 50000 changed the
  displayed timeline and allocation; the result expansion control worked.
  This real run did not truncate; extraction itself has fault-injection evidence,
  not a claim of a reproduced real-provider truncation on this run.
- The first local attempt failed before generation with a model connection
  timeout. IPv4-only process flags allowed the repeat to complete; no system or
  cloud network configuration was changed. Local persistence uses a temporary
  PGlite database, not production RDS. The original cloud project was untouched.
  That local acceptance preceded the error-code recovery release below. Public
  code deployment is now recorded below; authenticated public re-acceptance is
  still pending and must not be inferred from the local example.

## 2026-10-06 — error-code-directed recovery

The scheduler now distinguishes recoverable transport failures from rejected
requests instead of collapsing all failures into “page preparation failed”.

| Failure | Handling |
| --- | --- |
| Network disconnect, HTTP 408/500/502/503/504, provider unavailable, missing stream completion | Retry only the current phase/file, at 500 ms then 1000 ms; discard incomplete text |
| Model output length limit | Reduce batch scope, then bounded target-only module extraction; never apply partial JSON |
| Invalid plan/manifest/file schema | Existing bounded schema correction with concrete validation issues |
| Exact-edit mismatch | Complete-file fallback on the current snapshot, not fuzzy replacement |
| Login expired, permission denied | Stop without retry; preserve drafts and explain required login/permission action |
| Quota/rate limit, provider authentication/request rejection, policy stop, unknown failure | Stop without automatic resubmission; keep an explicit finite diagnostic and actionable notice |
| Dependency/preview connection failures | Keep existing environment-specific bounded recovery; do not ask the model to rewrite working business code |

Transport retries are capped at two per request and six across a coding task,
remain inside the existing 32-call/160000-reserved-token budget, and traverse
the authenticated gateway individually. SDK retries remain disabled. Conversation
routing has at most two extra attempts, also gateway-counted. Cancelling aborts
backoff immediately; source edits during backoff block stale retries. None of
these changes raises daily quotas or modifies cloud credentials/resources.

The saved result and diagnostic endpoint retain finite failure labels, never raw
provider bodies, prompts, source, URLs or credentials. Recovered intermediate
failures do not become failed conversation messages. Exhausted recovery is still
reported honestly, without exposing internal error codes or claiming success.

Fault-injection regression covers interrupted streams, HTTP/provider error
classification, cancellation, shared retry budgets, source drift, candidate
preservation, and safe user notices. Real provider and browser acceptance is
recorded separately from these deterministic tests.

Release verification:

- 813 application tests and 133 deployment tests passed; TypeScript and the
  production build passed. Changed-file lint has no errors (eight test-only
  empty-stub warnings). Credential scan and 124 offline Linux Node 22 packaged
  server checks passed. These tests include synthetic upstream failures, not
  forced failures against the real provider.
- Deployed the code-only package `jingyue-private-1Rvm9r.zip` to the existing
  Hong Kong `jingyue-workbench` function using its ZIP upload page. No environment
  variables, credentials, database schema, quotas, network access or resource
  specifications were changed.
- Package SHA-256: `84a541875f1dcbfb070816b4673e75d641e2ec8b824be11c6c08d444a2b0a15a`.
- The public `/healthz` and `/login` returned 200 with release fingerprint
  `4d7b5cdb13f1f3e70f4fdddc2ca5004f279f26803771c93c3d25a8cf08c860f0`;
  unauthenticated `/api/projects` still returned 401.
- Rollback package retained: `jingyue-private-Vv5OJy.zip`, prior public
  fingerprint `07f1647a2b820f18e98e0ad1261fcbb2c832b57395967c41f850b3635f7201da`.
- The public workbench browser session is expired. Post-deployment authenticated
  generation, compilation, preview and publishing verification remain pending
  login; deployment health checks alone do not constitute that acceptance.

### 2026-10-06 — Recover malformed file JSON with an alternate single-file transport

- Reported project: `aa803bd0-d4d6-42f7-a874-f71c6d504dfe`. The dedicated QA
  account cannot read this other account's project. FC log retention is not
  enabled, so the exact failed JSON/field cannot be retrospectively established.
  No permissions were bypassed and no paid logging resource was enabled.
- Confirmed recovery gap: the scheduler split batches and retried invalid JSON,
  but still required the same escaped JSON file envelope on every correction.
  Two malformed single-file responses therefore terminated without an alternate
  transport. This is distinct from token truncation and from compilation errors.
- After those bounded JSON corrections fail, one additional request returns the
  complete literal source between per-request host-generated markers. The host
  fixes the path and JSON-encodes the accepted source itself. Missing/repeated/
  foreign markers, Markdown wrappers and partial transport responses are rejected.
  No guessing missing JSON, executing response text, or combining partial chunks.
- All requests remain charged to the existing task/account budget. Source-change
  and cancellation guards, protected paths/configs, candidate preflight, build,
  preview and prior-version protection remain intact. Source overflow uses the
  existing bounded module decomposition, not unlimited retries.
- Finite diagnostic labels now separate `patch_json`, `patch_schema`, and
  `file_envelope`; no raw model text, source or credentials are logged.
- Validation before release: 834 application tests and 133 deployment tests,
  typecheck and production build passed. The opt-in `source-recovery-live.ts`
  injected two invalid JSON responses then made ONE real Bailian request; the
  recovered 7,238-character marketing form passed candidate preflight. This test
  writes no user project and is not proof that all generated applications work.
- The previous public release generated the user's exact marketing prompt in QA
  project `70fc28a9-f7e4-47e9-a3ea-ac7d1e13bbae` and reached preview. That request
  did not reproduce the malformed response; new-release public verification is
  tracked separately and must not be inferred from this successful attempt.

Public release verification:

- Uploaded the code-only package `jingyue-private-2BVtg2.zip` to the existing
  `jingyue-workbench` function. Package SHA-256:
  `e1bfa6308214f54fc81763fdd1188efaf1782c93264a09786890ccd0226781e2`.
  Public `/healthz` returned 200 with release fingerprint
  `9cf19fa52a682f4c8e43957f1d7d69ebd21616469480426a3d21ff3b228041c3`.
  No environment variables, credentials, resource specifications or quotas changed.
  Rollback package `jingyue-private-1Rvm9r.zip` remains available.
- Credential scan passed. Offline Linux Node 22 packaged-server validation passed
  in two isolated mock-model runs: 132 baseline checks and 99 source-recovery
  checks. Separate runs respect the gateway's per-minute limit; production limits
  were not relaxed for testing.
- Against the deployed public API, the opt-in fault-injection harness again
  supplied two invalid JSON responses, then ONE actual Bailian call returned a
  complete 12,833-character source file. Candidate preflight passed; no user project
  was written. This verifies alternate transport recovery, not the unavailable
  original failed response.
- After reloading the new public client, QA project
  `70fc28a9-f7e4-47e9-a3ea-ac7d1e13bbae` restored its saved source and preview.
  A real follow-up request updated two components with explicit demo-data labels;
  compilation and preview completed, and cloud save was confirmed by the UI.
- The modified form accepted a budget of 8,000 and displayed `¥8,000.00` with
  the demo-data label. A separate new-project request (`7d99ab13-51cb-4acf-a91b-5a69c93e2dd9`)
  passed file-response validation but exhausted its two typecheck repairs. This
  is retained as a failed acceptance case, not presented as a fully stable run.
- An opt-in synthetic generation probe against the public API separately observed
  output-length recovery, then TypeScript TS2724 for the nonexistent `FaTarget`
  export in `react-icons/fa`. One model repair passed host typecheck. This probe
  uses repository dependencies rather than a WebContainer and is not evidence of
  the exact earlier browser failure or browser preview success.
- Added browser-local finite command diagnostics (tool, exit code, TS error codes;
  no raw source/identifiers/paths). Signal-style exits 130/134/137/139/143 now stop
  as sandbox failures instead of causing blind model source repairs. No claim is
  made that those exit codes caused the earlier case; its detailed log was absent.
- Follow-up code-only release: `jingyue-private-gEJbSr.zip`, SHA-256
  `d9ed78500f0f026d6f19d0763f12e4986acc8fd82332f1e904d6c632d63dee1c`,
  public fingerprint `b0813047829f01c45733486eb582a03054aec4f224154d310f3b4a35a8905d56`.
  Public health returned 200. Tests: 840 application, 133 deployment, typecheck,
  production build, credential scan and 132 offline Linux Node 22 package checks
  passed. Changed-file lint: zero errors, 19 existing/test no-op warnings.
- A browser retry of the same failed QA project then exposed a distinct
  `batch_missing` outcome: a required not-yet-created file was still omitted
  after bounded correction. Extended the single-file framed-source recovery to
  required-file omissions and explanation-only responses. Valid unchanged
  existing files still skip; out-of-scope paths and protected files do not gain
  write authority; unchanged split integration is still rejected.
- The public fault-injection probe supplied two `batch_missing` responses, then
  one actual model call recovered an 8,257-character file that passed preflight.
  It wrote no user project. Deterministic regression now passes 843 application
  and 133 deployment tests. Browser generation remains independently recorded.
- Follow-up code-only release including required-file recovery:
  `jingyue-private-gZPLvD.zip`, SHA-256
  `74e5b228a53c4c2eaf9f5f2acdc28a3ba71bb1cf7738150aefacddecb1549b2f`.
  Public health returned 200 with fingerprint
  `87b11c5c1ced52de02fcdfe6e3783c6c18bd0f4af32504ad72a3284ee720b162`.
  Typecheck, production build, credential scan, and offline Linux package checks
  (132 baseline plus 99 source-recovery) passed. No configuration or quota change.
- New QA project `d0a2a440-7030-40aa-acd7-60243ea91f3c` reached candidate typecheck
  but exhausted repair on TS1110/TS1128/TS1005/TS1109, later TS1005. It did not
  reach preview and remains a failed acceptance case. A local replay of synthetic
  source before/after visual instrumentation passed host typecheck; this does not
  prove the cause of that browser failure.
- Additional compiler classification: browser-local diagnostics now contain only
  finite source/dependency/other origins in addition to TS codes. Dependency
  syntax errors trigger one bounded clean reinstall of the current runtime's
  `node_modules` and recheck, without model source edits. Repeated failure stops.
  JSX in `.ts` is rejected by candidate preflight rather than parsed as `.tsx`.
- Code-only deployment `jingyue-private-Y9cicP.zip`, SHA-256
  `80795d78278daa0bbbba9cb73dedb15bf67adb6eb476cbf8777323708ad81308`,
  public fingerprint `c9e8292798aa397b7efda0506e9e2e5113f7515dbc1132087137cee75e9205d8`.
  Public health 200; 847 application tests, 133 deployment tests, typecheck,
  production build, credential scan, 132 baseline plus 99 source-mode offline
  Linux Node 22 package checks passed. No environment/credential/quota changes.
- The single-preview QA run `5da09a24-3c0b-4e30-9952-ea07cf599d05` reached
  candidate typechecking but repeated TS2305 from source through two repairs.
  It did not reach preview. This is a missing-export error, not the original
  malformed-JSON failure; the finite log does not establish which export.
- Compiler repair now supplies bounded, read-only evidence from the installed
  `react-icons` declaration file when TS2305/TS2724 identifies that package.
  Only a fixed public-package path is read; declarations are parsed, not run.
  The model can select an actually available export rather than guess names.
  This does not suppress typechecking or automatically rewrite user components.
- Deployed code-only package `jingyue-private-AUGfhs.zip`, SHA-256
  `cd22a0fd9403fba67bcea9b68bb9fd28b26eee1ad02c8731c2c028cd93f497f3`.
  Public health returned 200 with fingerprint
  `5e871f9483a7ffe4d7b36b593e40e6893126b9df6487b17929a136bf9f1ee3c5`.
  Regression: 853 application and 133 deployment tests; typecheck, production
  build, credential scan, offline Linux 132 baseline and 99 source-mode checks
  passed. Fresh public browser acceptance is recorded separately below.
- Fresh QA project `81d8cf38-0145-4542-8d32-f8d11051faec` submitted the exact
  original marketing request against this client but stopped before generation
  with the model limit notice. A single minimal authenticated diagnostic request
  confirmed HTTP 429 / `ACCOUNT_RATE_LIMIT`, with no Retry-After header. The
  gateway uses this account-store check for daily model limits (user or global);
  it is distinct from the in-memory per-minute limiter. No quota was changed,
  reset or bypassed. The new-project browser acceptance of this package remains
  UNVERIFIED, and the previous TS2305 case remains an unresolved acceptance case
  until the enriched repair path is exercised with real generation.
- Evidence outside the repository: `jingyue-source-recovery-public-20261006.png`
  records the earlier successful two-file change and budget interaction;
  `jingyue-recovery-quota-check-20261006.png` records the latest quota blocker.
  Do not substitute the earlier success for a pass of this latest new-project run.
- Additional recovery fix: installation integrity now rejects zero/whitespace
  declaration files and missing/empty explicit `react-icons` subpath entries.
  These are dependency faults and trigger the existing bounded reinstall, not
  model edits to business source. The real pinned package passes the check.
- Transient gateway concurrency/minute limits now carry a finite `minute` header
  and Retry-After, which the client waits for before at most two retries within
  its existing task budget. Daily account/global limits carry `daily`, stop
  without retries, and explain that changing the requirement will not help.
  No quotas were increased, reset, bypassed, or exempted.
- Code-only release `jingyue-private-mTZzKM.zip`, SHA-256
  `da0d0ab49fcbe95f54c6b6134c2bb081c4f9c1192eff3558f34a82a68f72fcfe`,
  deployed and health-verified with public fingerprint
  `0ece258b128e71867b094fed416c2615adaa2c5919dcbd0206b015ca197a5e71`.
  Verification: 867 application tests, 134 deployment tests, typecheck,
  production build, credential scan, and offline Linux Node 22 package checks
  (132 baseline plus 99 source-recovery) passed.
- Public browser regression on the saved QA marketing project
  `70fc28a9-f7e4-47e9-a3ea-ac7d1e13bbae` passed restore/install/typecheck/build/
  preview; example form submission showed an 8,000-yuan result. A whole-page
  reload restored source and preview again without model calls; empty submission
  showed three field errors, then a valid 12,000-yuan submission showed the new
  amount and demo label. Runtime form values reset on reload; this is source and
  preview recovery, NOT business-data persistence. Screenshots outside the repo:
  `jingyue-recovery-public-form-20261006.png` and
  `jingyue-recovery-public-refresh-20261006.png`.
- Fresh real-model generation and the unresolved TS2305 case are still UNVERIFIED
  on this release because the daily allowance is exhausted. The no-model browser
  regression and deterministic fault injection do not replace that acceptance.

## 2026-10-08 — Context-aware conversation continuation (candidate, not deployed)

- Root cause of the reported "继续再试试呢" failure: the retry shortcut did not
  recognize this phrase, allowing intent classification to select preview even
  though runtime startup had failed before source generation. Separately, model
  requests previously retained only eight recent messages and single-file batches
  omitted conversation history, so the original requirement could disappear.
- Every managed model phase (intent, answer, plan, manifest, generate, repair)
  now receives bounded current-project context: original and active task anchors,
  selected earlier user requirements, recent dialogue, and the latest finite run
  outcome. Current source and current diagnostics take precedence over history.
  History truncation is explicit; this is not unlimited history or global memory.
- Explicit retry phrases resume the latest recorded task instead of opening an
  empty preview. "继续排查/解释" answers with context without modifying files.
  Ambiguous continuation, pending plan confirmation, cancellation, negation and
  quoted instructions do not silently grant permission to write source.
- Regression covers the exact reported follow-up, history restored from saved
  JSON, task anchors older than the recent-message window, all six request phases,
  isolated project histories and a simulated startup-failure/retry lifecycle.
  907 application tests, 134 deployment tests, typecheck and production build
  passed. The lifecycle test uses a mocked runtime; it is not real browser or
  provider acceptance and does not resolve the separate generation failures above.
- Public release is pending: the Alibaba Cloud code console requires login again.
  No credentials, quotas, schema, resource settings or public code changed during
  this context-continuity fix. Prior release packages are retained for rollback.
- Additional local live-model probe passed with ONE read-only Qwen Plus call:
  after fourteen intervening discussion messages, "继续排查" correctly identified
  the original portfolio requirement and the pre-generation browser-runtime
  failure, without requesting the requirement again or creating a new plan.
  The exact "继续再试试呢" phrase resumed the recorded task with zero classifier
  calls. This uses synthetic history through the real candidate API/model; no
  user project was created or modified, and no browser compilation was claimed.

## 2026-10-08 — Repair scope and accidental cancellation (candidate)

- Real Qwen Plus generation of the original portfolio query reproduced missing
  shared types, a parent/child callback mismatch, and an explicitly non-nullable
  component returning null. Its broad second repair rewrote unrelated modules
  and exhausted the existing reserved-token budget after 22 model requests.
  This is a failed baseline, not successful acceptance.
- Repair scheduling now has an explicit operation and prioritizes current
  diagnostics over the original creation request. A recheck replaces the active
  diagnostics; previous failures remain audit history, not new repair tasks.
  An unchanged repair manifest gets one bounded correction under the same
  budget. A final no-op retains the original failed check instead of replacing
  its cause with a generic no-change message. Each failed check reports finite
  stage/reason metadata; no raw source, provider response, or credentials.
- Relative code imports are checked before dependency installation. Missing
  shared modules receive concrete repair feedback; binary assets/custom aliases
  remain the compiler's responsibility. Module/props/nullable-return conventions
  are explicit in generation instructions; compiler checks remain enabled.
- Busy Enter/IME confirmation and duplicate submission no longer cancel a run.
  Only the explicit stop action does; leaving a page, manual editing, replacement
  and task deadlines retain separate finite causes. The deadline is reported as
  a failure rather than an invented user cancellation. Limits remain unchanged.
- Replaying the retained failed portfolio candidate through the corrected
  scheduler and REAL Qwen Plus gateway took two requests and changed only the
  offending modal. Full candidate host TypeScript checking passed. This proves
  targeted repair, not WebContainer preview, visual quality, or public rollout.
  Browser end-to-end validation and deployment are recorded separately; do not
  treat the earlier public release as containing these local changes.
- Browser replay on the candidate build generated and compiled the portfolio
  candidate, but hit the shared eight-minute task deadline during the SECOND
  (live-project) build. No compiler failure or user-stop was reported. The
  already saved source subsequently passed build and preview reconnection
  without model regeneration. This is a recovered run, not one-pass acceptance.
- Once (and only once) a real candidate compiler has passed, the controller now
  reserves at least three minutes for live promotion/preview finalization. The
  original pre-compilation deadline, individual process deadlines, model/token
  budgets and repair count stay bounded and unchanged. Fake-clock tests cover
  success in that window and forced cancellation when that window is exhausted.
- Manual preview checks found an additional generated-app quality issue:
  category selection changed state but did not filter the list, and contact
  placeholders were clickable empty anchors. Compiler/initial-mount success
  therefore still does not establish task-specific interaction correctness.
- The live entry additionally duplicated page modules as inline placeholders.
  It explicitly described this as satisfying a "self-contained single file"
  requirement. The batching contract now distinguishes response scope from
  runtime module scope. New projects validate reachability of generated UI
  modules from the HTML entry before compilation; unused modules trigger a
  bounded repair. This graph check is not a substitute for clicking controls.
- A real follow-up edit hit an 8,000-output-token cutoff, retried, then exhausted
  its deadline during repair. It did NOT pass acceptance. Inspection of this
  synthetic project's App.tsx found 7,227 of 15,686 characters were runtime
  editor markers. The scheduler now strips only platform-generated JSX markers
  in its private model/edit snapshot and applies exact edits to that same
  canonical snapshot. Live conflict checks still use exact original bytes;
  only changed files are returned and the writer restores visual-editor markers.
  Application literals, custom IDs, handlers and unchanged live files stay intact.
- Typecheck, 941 application tests and the production build passed after these
  changes. The local acceptance server was restarted on the SAME database and
  unchanged daily model quota. Public rollout remains pending Alibaba console
  login; these local results must not be reported as public acceptance.
- On that final local build the saved portfolio restored through dependency
  installation, build and browser preview (`a60e3c33-73e4-4016-922f-f8a3252b6de6`).
  The next REAL modification completed intent, plan and manifest, then hit the
  unchanged daily 20-call quota BEFORE code generation. The earlier preview and
  source remained available; no quota reset or account substitution was used.
  Therefore the marker-free generation fix still needs live completion testing.
  The release additionally passed 135 deployment tests and offline Linux Node 22
  verification (132 standard checks + 99 source-recovery checks). These checks
  used mocks and are not a substitute for the blocked real-model acceptance.

## 2026-10-08 — Public rollout and daily-quota configuration

- Deployed `jingyue-private-yDTy0d.zip` (SHA-256
  `f7e84828bcf6ede4f0d6942ed8aae26825b3638abb1c9b54e000889707914b33`).
  Public `/healthz` returned 200 with release fingerprint
  `25669485b54c3772846e045bc82e8aa38b3dc1dc5b40e5263b232fdcf71bc083`;
  unauthenticated `/api/models` still returned 401. The preceding candidate
  context, cancellation, repair-scope and marker-removal fixes are now deployed.
- At the user's explicit request, both `JINGYUE_USER_DAILY_REQUESTS` and
  `JINGYUE_GLOBAL_DAILY_REQUESTS` were set to `0` in the existing public function
  and read back after saving. Only these daily counters support unlimited mode.
  Authentication, account capacity, login anti-abuse, short-term rate/concurrency
  limits and finite per-task model/token/retry/runtime budgets remain enabled.
  No counters, accounts, saved projects, credentials or other settings were
  cleared or changed. Model usage continues to incur provider charges.
- Verified 138 deployment tests before the final blank-value guard, then 23
  focused security/account tests with the guard; final package credential scan
  and 132 offline Linux Node 22 checks passed. The application build is the
  previously verified 941-test candidate. Restore positive daily limits BEFORE
  rolling back to the previous release, which does not accept zero values.
- A real public API probe using the existing dedicated QA account passed with
  ONE read-only Qwen Plus call. Fourteen intervening messages did not lose the
  original portfolio request or its pre-generation runtime-startup failure.
  Explicit retry resolved the original task without a classifier/model call.
  This probe used synthetic history, changed no project and is not browser
  generation/compilation/preview acceptance; that run is recorded separately.
- Fresh public browser project `0d883001-0560-4d71-9d3b-2550d62412dd`
  used the exact portfolio request. Chrome already held the user's existing
  account, so this was a separate new test project in that session; it was NOT
  the dedicated QA account and no prior user project was changed. The first run
  (`3c2a1260-c83e-4364-aa1b-705b39cfe06c`) entered bounded repair, then passed
  installation and typechecking but timed out in candidate build. Finite logs
  identify `building/timeout`, not user cancellation or a daily model limit.
  No candidate was promoted. Native browser inspection showed the execution
  tab was backgrounded; this is a possible scheduling factor, not established
  root cause. A foreground continuation is a separate acceptance attempt.
- Foreground continuation `c4abbabb-2649-42ee-9bb1-a7d95590bf56` correctly
  resolved the exact follow-up "继续再试试呢" to the original portfolio request,
  rather than taking the empty-source preview shortcut. It nevertheless failed
  in repair (`repairing/compile`, attempt 1), before promotion or preview.
  The public UI describes this as a candidate syntax failure; the finite log
  alone does not identify the exact offending source. Thus neither public
  generation attempt passes end-to-end acceptance. Do not attribute this second
  failure to background scheduling or claim that removing daily quotas fixes it.
  Evidence outside the repository: `jingyue-public-retest-20261008.png`.

## 2026-10-08 — Continued generation repair (not a status-only handoff)

- Live public-model diagnosis reproduced an undeclared router dependency. The
  repair planner then unnecessarily selected six files. A pure missing-package
  diagnosis is now recomputed against the candidate and restricted to
  `package.json`; mixed local-module errors still use normal planning.
- Batch scheduling places shared modules and leaves before App/main integration.
  Complete-file syntax is checked before retention, with bounded correction of
  only the failing file. Bad syntax never becomes the input for later batches.
- A Vite worker timeout gets one unchanged build retry, not an AI source repair.
  Cancellation, real compiler errors, task deadline and retry limits are retained.
  Timeout logs contain only tool category, timeout, output-present flag and page
  visibility, never source, raw output or credentials.
- A dedicated-account real Qwen Plus run used the original portfolio requirement:
  9 calls, one TS2322 component-contract repair, then actual candidate dependency
  installation, TypeScript and Vite build passed. This diagnostic uses the public
  model gateway but a host compiler; it is NOT browser-preview acceptance.
- 951 application tests, 138 deployment tests, typecheck, production build,
  artifact credential scan and 132 offline Linux Node 22 checks passed.
- Deployed `jingyue-private-JRHlPd.zip`, SHA-256
  `81345264d9f6c388dd5b9c2966a7bf00f85391bad0bf1ea72b997b5c1d397784`.
  Public health returned 200 with release
  `a5ec3d1bd4738892417783d72c94db925fa577d191228e759a97445b3b3bf339`;
  anonymous model access still returned 401. No environment/database changes.
  Public browser continuation is being tested separately before acceptance.
- Public continuation `2e99fc6f-d9d8-45b9-8949-764ff3abf4b3` reached
  installation and typechecking, repaired TS2322/TS2304, then was interrupted
  during build at exactly the shared eight-minute task deadline. This was not
  user cancellation or proof of a Vite worker timeout. It did not pass acceptance.
- Generation retains its eight-minute model allowance and existing call/token/
  repair limits. Candidate installation/typecheck/build now has a separate,
  cumulative six-minute allowance across attempts; a repair cannot reset it.
  Only a successfully compiled candidate receives the existing finalization
  reserve. Fake-clock tests cover both independent and cumulative limits.
- Explicit continuation can restore the last complete candidate and recheck it
  before calling the model. Account/project-scoped metadata binds the task,
  approved plan, live-source hash and candidate hash. Changed tasks, manual
  edits, partial batches, old checkpoints and corrupt metadata do not resume
  automatically. Compilation and preview gates are still required.
- Final regression: 957 application tests, typecheck, production build,
  credential scan and 132 offline Linux Node 22 release checks passed; the
  preceding 138 deployment tests remain applicable (no deployment logic changed).
- Deployed `jingyue-private-cfwQ3p.zip`, SHA-256
  `46364986e2475f6b1f7beeae65374fcc9a55b91bcdc204f442e83ae00c1de29e`.
  Public health returned 200 with release
  `b032f1aa37182807db8e822cf548038c3018628506ca7b63c09056f4525b9afd`;
  anonymous model access remained 401. No environment/database changes.
  Real public continuation of the same portfolio request remains under test;
  the previous legacy checkpoint cannot be reused without its binding metadata.
- On that release the original portfolio requirement passed real public-browser
  candidate and live installation, typecheck, build and preview. Navigation,
  six-to-two category filtering and project-detail open/close were exercised.
  This is one successful generation, not a blanket stability claim.
- A subsequent real contact-form edit (`3ad93a99-3fa3-4541-9a69-aee80af439b1`)
  passed typecheck but both candidate builds hit the 90-second command cap.
  A fresh restore of unchanged, previously validated source failed the same way.
  Direct diagnostic builds of this synthetic project then completed: 117 seconds
  without PostCSS, and 119 seconds WITH the original complete PostCSS/Tailwind
  configuration (about 134 seconds including process startup). Thus this
  reproduction demonstrates a too-short build deadline, not broken source or
  proof of a PostCSS deadlock. No diagnostic configuration was saved to source.
- Browser Vite builds now have a finite 180-second cap and one unchanged retry,
  still within the cumulative candidate/task limits. Successful candidate
  finalization receives at least four minutes for live build and preview.
  Model call/token limits and compile/style/preview checks remain unchanged.
  Build timing telemetry records only duration and candidate/live classification.
  Fake-clock tests cover a 120-second successful build and a genuinely stuck
  build stopped at the hard cap. These fixes require a new public deployment
  and continuation/refresh acceptance, recorded below when verified.
- Final artifact regression: 959 application tests (72 files), typecheck,
  production build, credential scan and 132 offline Linux Node 22 checks passed.
  Deployed `jingyue-private-26zKNR.zip`, SHA-256
  `3e1043730f06913e4c3f56c78c13570d39bf352e0661c9dce87f4d06d1ff6387`.
  Public health returned 200 with release
  `1ab3fc7ff5462a6ad777f09332be753fbf3cf0406977497d3aa1167948398b1e`.
  No environment, account, quota or database settings changed in this deployment.
- Public live-source rebuild on this release completed in 57,421 ms, but its
  automatic preview check failed; starting the same saved server script manually
  rendered the app. This is NOT a passed automatic restore and remains under
  investigation. Added finite preview failure/exit classifications and preserved
  internal exception codes on restore, without logging raw exceptions or source.
- Explicit continuation exposed a separate snapshot replay bug: unchanged
  `package-lock.json` was included in the reconstructed model patch and correctly
  rejected by the path guard. Replay now includes only changed files. Regression
  tests prove an unchanged lock is preserved and a changed lock is still refused,
  before candidate compilation or live writes; no path guard was weakened.
- Regressions with snapshot replay fix: 961 application tests, typecheck,
  production build, credential scan and 132 offline Linux checks passed.
  Deployed `jingyue-private-F51IyL.zip`, SHA-256
  `7bde175503f7d4c5a15f91dd215931d16e236b7535545d967bb0bcf3a1df9d25`.
  Public health returned 200 with release
  `699af3c0121f0fdbbac4ad7aa349a657307cc2eb809967e3a18ff97275e747de`.
  Automatic public restore/continuation is being checked on this exact package.
- On `699af3c…`, public automatic restore completed its live build in 47,153 ms
  and reached the real preview without manual server startup. Anonymous model
  access remained 401. Explicit “继续再试试呢” then retained the prior contact-form
  task and compiled its recovered candidate in 66,168 ms without the previous
  unchanged-lockfile rejection. Final live-preview and interaction checks are
  still pending; the earlier intermittent preview failure is not considered
  disproved by this single successful restore.
- The recovered contact-form edit subsequently completed the live build in
  69,917 ms and automatically reached preview. Browser interaction checks passed:
  three empty-field messages; an invalid email rejected; a valid synthetic entry
  produced the explicit demo-only success message and retained entered content.
  Existing six-item gallery filtering to two development items and opening/
  closing project details also passed. No email was sent (the generated form is
  client-only). Whole-workbench refresh of the newly saved source is under test.
- Whole-workbench refresh then completed its build in 77,257 ms and automatically
  opened the preview. The new demo disclaimer and all three required-field errors
  remained present after refresh. Project `0d883001-0560-4d71-9d3b-2550d62412dd`
  therefore passes this specific continuation, interaction and source-restoration
  test. Synthetic form entry is ordinary in-memory demo state, not a claim of
  business-data persistence. Evidence: `jingyue-public-form-pass-20261008.jpg`
  outside the repository. Browser tests used the existing user session without
  logging it out; the earlier isolated API test used the dedicated QA account.
- A fresh public run of the user's exact marketing-Agent requirement on the same
  release did NOT pass: `84abea03-5e06-4f02-9a81-3fba5ed33e41`, run
  `2d1b05d9-a029-4050-ba29-d6b0917db498`. After one preflight correction, actual
  typechecking reported TS2345/TS7006; repair removed TS7006 but TS2345 remained.
  Its candidate was not promoted. The successful portfolio case does not count
  as acceptance of this marketing case.
- Read-only follow-up exposed a diagnostic context gap: only the finite outcome
  was sent, not the actual latest check. Answers can now use bounded/redacted
  diagnostics only when their run id matches this conversation's latest outcome;
  stale/cross-run context is rejected and candidate/live status is explicit.
  Actual compiler failures are also inspectable in the existing local runtime
  terminal; server/console telemetry remains finite and never receives raw text.
- 966 application tests, typecheck, production build, credential scan and 132
  offline Linux checks passed. Deployed `jingyue-private-IEN5Kr.zip`, SHA-256
  `e07d34f4e641aae25955c26891ea62c53c47f2710b6cd5b1d88339dde983a6ad`;
  public health returned 200 with release
  `710d801df0e2e8b086b3419c0dca41c245360f234b1472f5a9a1ad23e43fb14c`.
  This improves diagnosis, not a claim that the remaining marketing type error
  is repaired. Continuation of that same retained candidate follows.
- The continued marketing candidate exposed the actual error:
  `MarketingForm.tsx(26,17)` passed `(prev: string[]) => string[]` where a callback
  required a `string[]` value. Annotating the updater parameter fixed TS7006 but
  could not fix TS2345. Read-only follow-up on `710d801d…` now correctly identified
  the exact location and mismatch from this run's diagnostic, without code writes.
- An ineffective repair response also stopped the outer loop early. It now
  receives correction within the remaining two-repair limit while preserving
  the original diagnostic. No retry budget is reset and no unchanged response
  can clear a failed compile. Compiler-observed updater/value errors include
  bounded contract-repair guidance; source is never automatically cast or edited.
- 972 application tests, typecheck, production build, 50 targeted deployment
  tests, credential scan and 132 offline Linux checks passed. Package
  `jingyue-private-3ZuGyD.zip`, SHA-256
  `e1576a4ab1ab8346d3f8edbae9fdc13fa74a4a3b3c319978ba8d4914096e30ba`,
  release `a114ced3b8c696969aa46582d3ca8874faea29ed30a2d6e6459295c3d4283bd2`.
  Public continuation of the retained marketing candidate remains the acceptance
  gate; offline checks alone do not establish that it has been repaired.
- Public health confirmed `a114ced3…` (200). The same marketing candidate was
  resumed by “继续再试试呢”, run `c0277b84-0f45-41e8-993c-d152cdfbc4ca`.
  Its actual TS2345 was observed again, then the model's repair passed strict
  typechecking and the candidate build (59,998 ms). This is an actual correction,
  not a cast/disabled check or a replacement project. Live preview follows.
- Marketing continuation passed live build (61,462 ms), automatic preview and
  cloud source save. The actual browser accepted an edited goal, toggled a second
  audience and changed the budget slider. Clicking Generate added a clearly
  marked example proposal including the entered goal/audiences. UI testing also
  found missing required-field validation (an empty goal produced a proposal),
  so this is not claimed as complete UX acceptance. A real follow-up code-edit
  request now adds blank/whitespace/audience validation and explicit budget
  display, keeping the existing modules and demo-only scope.
- First follow-up compiled (candidate 42,029 ms/live 66,589 ms), but clicking
  revealed a semantic gap: the form expected an error prop while its parent
  merely returned on invalid inputs. The app no longer added an invalid proposal
  but displayed no feedback. This was not marked a UX pass. A second targeted
  real-model edit connected the error state. Run
  `f16b4668-4084-4d97-9719-e3064ed84f3a` initially produced TS2322, then automatic
  repair passed strict typechecking and candidate build (119,984 ms) without
  manual source modification. Final preview/interaction verification follows.
- Second follow-up passed live build (90,168 ms) and automatic preview. Clicking
  confirmed: whitespace goal plus no audience is rejected with visible feedback,
  no-audience-only is rejected, invalid submissions preserve the two example
  proposals, and valid submission clears feedback/adds exactly one proposal with
  the actual goal, selected audience and 2,000-yuan budget. Everything remains
  labelled example data. Screenshot: `jingyue-public-marketing-pass-20261008.jpg`
  outside this repository. Whole-page source recovery and a fresh unassisted
  generation of the original marketing query are now being tested.
- Whole-page marketing recovery built successfully (155,824 ms) but failed the
  old 15-second mount probe. Fresh original-query project
  `f05d6470-1ba6-40f3-b655-c55cc0794ecd` generated and compiled without source
  errors (candidate 115,036 ms/live 99,319 ms), then reproduced that same probe
  failure. QA explicitly stopped the old client's inappropriate model repair;
  this cancellation is operator-driven, not an unexplained system stop. Source
  had already been validated and saved. Neither run is claimed as a preview pass.
- Preview verification now allows a finite 60-second dev-module mount window;
  no mounted root without an observed exception is inconclusive infrastructure
  failure, not repairable source evidence. It preserves the dev server for a
  same-source recheck. Real runtime/overlay errors still fail immediately, and
  success still requires the bound frame/run/attempt plus actual root content.
  Probe-execution tests cover a 30-second delayed mount, a never-mounting page,
  host deadlines, real runtime errors, cancellation and reuse without rebuilding.
  All 977 application tests and typecheck passed; final package verification and
  public source-restoration checks are in progress.
- Final preview-fix package passed production build, credential scan and 132
  offline Linux checks. Artifact `jingyue-private-pzFEKM.zip`, SHA-256
  `c89263c9d68daf9a8a6b7a820df06451595c74a6f4f684faabdad67ed7c62019`;
  release `5a423913bb424f0eca92db5029e0f0578ea29a67fdd7b4cba8d7bb023e6d9de5`.
  Code-only upload submitted; public fingerprint and real refresh results follow.
- Public health confirmed `5a423913…` (200), with anonymous model access still
  denied (401). Both saved marketing projects automatically restored into real
  previews after whole-page reload. Fresh-query project restore built in 67,414
  ms; the repaired form project restored in 85,907 ms. The latter again rejected
  whitespace goals with visible feedback and produced a proposal containing the
  edited goal/audience/2,000-yuan budget on valid submission. This validates source
  recovery, not persistence of the generated app's in-memory form data.
- Fresh-query visual/interaction QA confirmed styled controls, audience toggles
  and budget allocation, but found missing demo disclosure and unsupported
  performance guarantees. A real request to fix these, while preserving the
  budget/buttons, was misrouted to read-only explanation: a broad negation regex
  treated “不要改预算、受众和生成/重置按钮” as a veto on the entire edit. The
  routing patch distinguishes explicit whole-task no-code instructions from local
  preservation constraints; ambiguous scope still goes to model classification,
  with the full original request. The exact regression and existing read-only
  boundaries pass targeted tests; public replay remains required.
- Scoped-intent repair passed 988 application tests, typecheck, production build,
  credential scan and 132 offline Linux checks. Code-only package
  `jingyue-private-aQuUtI.zip`, SHA-256
  `715a29c4eee9ba1d685456ead2abbee4c99b26d4039f070a91839ad8ba919f8a`,
  release `108b764d677f79a972635b259739d3726775b687f5a804b4213ee4b7faa057df`.
  Submitted for public deployment; no environment/database/auth configuration
  changed. Exact-query public replay follows rather than inferring behavior from
  mocked classifier tests.
- Public fingerprint confirmed `108b764d…` (200), anonymous model access 401.
  Fresh marketing project restored automatically again on this release (76,239
  ms live build, actual preview visible). Re-submitted the exact previously
  misrouted scoped-edit request in the same project for real-model verification.
- Exact scoped-edit replay now entered planning/generation rather than read-only
  explanation, then passed candidate typecheck/build (88,194 ms). No manually
  patched generated files, no weakened compiler settings and no altered query.
  Live promotion/preview and the preserved-controls UI checks remain pending.
- Scoped-edit replay also passed live build (82,257 ms), automatic preview and
  cloud source save. Only `src/App.tsx` and
  `src/components/CampaignPlanDisplay.tsx` were marked changed in the file tree;
  the form component remained unchanged. Both requested demo disclosures are
  visible and unsupported CTR/CPL guarantees are absent. Actual clicks verified
  changed goal, Z-generation + newlywed audiences, a 1-wanyuan budget displayed
  in the proposal, then Reset restoring the original goal/audience/50-wanyuan
  budget. Screenshot `jingyue-public-marketing-intent-pass-20261008.jpg` is saved
  outside Git. One final whole-page reload of this updated source is underway.
- Final updated-source reload passed live build (97,798 ms) and actual preview
  mounting. Both demo disclosures and the edited strategy copy survived. Goal
  edits, audience selection and Generate were clicked again successfully after
  reload. Budget keyboard automation timed out at the browser-control layer in
  this final repeat; its prior 1-wanyuan and Reset checks passed before reload,
  so this repeat is not claimed as an additional keyboard pass. Final screenshot:
  `jingyue-public-final-pass-20261008.jpg` outside Git. Browser-sandbox refresh
  still reinstalls/rebuilds and is slow; these finite cases do not establish that
  every future generated project will succeed first try. No standalone Netlify
  publish was performed in this repair cycle.

### 2026-10-09: six managed repair rounds

- Per user request, the default managed-task repair ceiling is six (previously
  two), excluding the initial generation. Planning, generation and compiler
  failures still share the existing bounded task; this is not a separate budget
  for each error category or a guarantee of six model calls.
- Client run state, saved outcome annotations, request correlation and the
  server diagnostic endpoint accept rounds 0–6; older outcomes remain readable.
  Local OpenCode task instructions use the same ceiling. Public OpenCode/cloud
  sandbox capabilities are not enabled by this change.
- The 32-call / 160,000-reserved-token task budgets, finite deadlines, explicit
  cancellation, authentication and unchanged-source/unchanged-error stop guards
  remain in force and may stop a run before round six. Invalid candidates still
  cannot replace current source or preview before verification.
- Regression coverage includes a third repair after two generation failures,
  success on the sixth repair, exhaustion after exactly six repairs, and finite
  logging/persisted outcomes without source or credential leakage. Public
  release verification is recorded separately after actual deployment.
- Release validation passed: 992 application tests, typecheck, production build,
  28 gateway/diagnostic tests, credential scan and 132 offline Linux checks.
  Code-only package `jingyue-private-daXad8.zip`, SHA-256
  `d6f09240376a8fb99e35352e72ccac1871a2162bff7654d74bf74384c8c47131`;
  release `d9772c1fcea4e0a93b7fbec5f0e51ce75487a0b2d5911b3fb4b9324b28dbd562`.
  Public `/healthz` returned 200 with that exact fingerprint; anonymous model
  access remains 401. No environment/database/auth configuration was changed.
  Existing open clients must reload to use the new repair ceiling; deployment
  does not automatically restart already-failed tasks.
- Public continuation of original failed project
  `844a76b7-63a9-4e72-bf37-6995c3556e0c` loaded `Header-yWQRMDgT.js` and recovered
  its candidate instead of regenerating the request. Run
  `d416f5dc-0ba3-4935-b446-c49513c35159` reproduced TS2305 (the nonexistent
  `react-icons/fi` export `FiSparkles`), then the real model repaired it.
  Candidate typecheck/build passed (14,888 ms build), final live build passed
  (15,622 ms), and the actual marketing preview and cloud-saved status appeared.
  Screenshot `jingyue-six-repairs-public-20261009.jpg` is outside Git. This is a
  candidate-continuation/build/preview pass, not a new from-zero generation,
  six forced real-model failures, or a complete visual/business acceptance.

### 2026-10-09: thirty managed repair rounds

- Follow-up user request increases the repair ceiling from six to thirty,
  excluding initial generation. It gives changing candidates more opportunities
  to resolve real validation errors without altering the existing workspace UI.
- The controller, resumed task state, request traces, saved outcome parser and
  server event validation now support rounds 0–30. Saved outcomes accept canonical
  two-digit rounds, retain old records, and reject round 31, leading zeros,
  fractions, negative numbers and arbitrary diagnostic payloads.
- Existing 32-call / 160,000-reserved-token budgets, finite deadlines,
  authentication, explicit cancellation and unchanged-source/unchanged-error
  guards remain unchanged. Multiple model requests can occur within one repair
  round; thirty is a ceiling, not a promise to spend thirty rounds per task.
  Candidate verification is still required before replacing source or preview.
- Regression cases exercise exhaustion after thirty repairs, success on repair
  thirty with a single candidate promotion, and round-trip saved results and
  authenticated diagnostics through round thirty. These use controlled fixtures,
  not thirty intentionally induced paid model failures. Actual release and
  public smoke-test results are recorded after deployment.
