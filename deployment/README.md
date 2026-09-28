# 鲸月工作台：阿里云私有体验部署

这是 **当前 Bolt / Onlook / 百炼工作台** 的独立部署入口，不是旧 `atoms-demo` 制品，也不是公开多租户生产系统。现有受限内测已部署至香港 FC，域名、HTTPS 和项目持久化已接通；2026-09-28 已切换独立账号注册登录，当前账号模式配置以 [ACCOUNTS.md](ACCOUNTS.md) 为准。下方 Basic 配置保留用于理解旧入口，不能当作当前多用户部署方案。验收范围及未完成项见根目录 [JINGYUE.md](../JINGYUE.md)。

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
