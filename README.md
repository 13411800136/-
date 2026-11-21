# 厂序 FactoryFlow · 工厂业务协同管理系统

第三轮考核项目 · v1.4.0 · 2026-11-14

仓库：<https://github.com/13411800136/->
[![CI](https://github.com/13411800136/-/actions/workflows/ci.yml/badge.svg)](https://github.com/13411800136/-/actions/workflows/ci.yml)

厂序是一个前后端一体的工厂业务协同系统：让一张客户订单从建单、采购、到货，走到生产、质检、包装、发货和完成。管理员在后台看全局，物流、生产、品控、包装在各自现场工作台处理本职任务。身份、权限、数量、金额、状态、幂等、并发和审计都由服务端与真实数据库保证。

本仓库只包含**合成演示数据**，不包含真实客户、员工、密码、运行数据库或浏览器会话。

## 1. 用途、版本与功能状态

- 产品版本：`1.8.0`
- 交付基线：2026-11-21 工作区版本（`v1.8.0`；Git 提交号由交付时仓库记录）
- 运行形态：单进程 Node.js 服务，生产模式同时提供 `/api/v1` 与构建后的前端静态文件
- 核心闭环：管理员建单 → 采购 → 物流到货 → 管理员下发生产 → 生产反馈 → 管理员下发质检 → 品控录入（可含不合格）→ 管理员 PASS/返工/报废 → 必要时补产复检 → 下发包装 → 包装 → 管理员确认发货 → 物流发货 → 完成
- v1.1.0 增强：退出登录二次确认；物流/品控/包装历史记录；现场与管理员之间的内部消息；基础数据字段名按客户/供应商/配件区分；已完整到货的任务自动离开待办队列
- v1.2.0 增强：订单附件上限 20MB；生产按部门拆多个任务并行；生产反馈完成即离开待办并进入历史；客户税号/地址选填；管理员 12 小时内撤销待采购订单并留痕；订单列表批量确认发货
- v1.3.0 F 切片：7 天内/逾期交期提醒（每日去重）；附件支持 PDF/PNG/JPG；库存台账 xlsx 导出
- v1.3.1 视觉：以「工位轨道」重做界面层（`styles/line-theme.css`），功能、接口与数据不变；方向与评审见 [设计方向](docs/design-direction.md)
- v1.4.0 业务：建单/采购可直接输入新客户、供应商、配件并自动建档；品控可上报不合格并由管理员返工或报废；新增订单流水页（实时成本与利润）
- v1.5.0 动效：按钮加入挤压、交错、形变、故障、视差、粒子、遮罩揭示七种效果；纯视觉，遵循 `prefers-reduced-motion`，可单独关闭
- v1.6.0 运营：Particular 风格粒子与统一 1.1s 时长；通知可删除/清理已读；订单分页增强；按月归档已完成订单到 `ARCHIVE_DIR`（本机为「过去订单」），列表默认隐藏归档单
- v1.7.0 协同与视觉：现场异常支持受理/解决闭环并通知上报人；订单可撤回（进行中）与删除（已撤销/已完成，标记删除）；界面改为奶油玻璃主题（立体方块背景、毛玻璃、大圆角按钮、白色流水按钮）
- v1.8.0 通知与视觉：通知可删除且不会当天重新生成，支持全选/批量删除/批量已读；背景换成蓝天白墙插画并转为蓝调主题；审计日志改为自然语言描述

**M 必做范围已实现并验收**，逐项状态、实现位置与证据见 [功能状态表](docs/feature-status.md)。少量 F 切片（通知全部已读、管理员审计检索、停用账号撤销旧会话、多部门生产、图片附件、库存导出、交期提醒）单独标注；多产品、电镀、多采购、导入、采购/生产等更多报表 F 未选做，代码中不提供可用入口。v1.2.0 按用户追加要求扩展了多部门生产任务、12 小时订单撤销、批量确认发货；v1.3.0 增加交期提醒、图片附件、库存导出；v1.4.0 增加现场建档、质检不合格返工/报废、订单流水，均单独记录，不冒充原 M 范围。已知问题见第 11 节。

## 2. 环境要求

| 项目 | 已验证版本/条件 | 核验方式 |
| --- | --- | --- |
| 操作系统 | Windows 11（本机） | `winver` |
| 浏览器 | Microsoft Edge（Chromium）1440×900；1024×768 与 390×844 已做响应式检查 | Playwright `channel: msedge` |
| Node.js | `v24.20.0` | `node --version` |
| npm | `11.19.0` | `npm --version` |
| 数据库 | Node 内置 `node:sqlite`（SQLite，WAL 模式），无需单独安装 | `node -e "require('node:sqlite')"` |
| 端口 | 后端/单进程 `8787`；Vite 开发 `5173` | `.env` 或 `PORT` |

只有一个权威锁文件：根目录 `package-lock.json`（npm workspaces）。不要混用 pnpm/yarn 安装。

## 3. 目录与文档导航

```text
factory-system/
├─ README.md                 本文件：启动、演示、排错、交付
├─ PRD-factory.md            需求分析与范围取舍
├─ AGENTS.md                 AI/协作者进入仓库的约定
├─ CONSTRAINTS.md            不可降低的质量底线与验证位置
├─ CHANGELOG.md              版本变更与已知限制
├─ .env.example              配置模板（无真实秘密）
├─ package.json / package-lock.json
├─ backend/
│  ├─ migrations/001_init.sql
│  ├─ src/{server,app,config}.ts
│  ├─ src/common/            认证、错误、幂等、金额、时间、审计、事件
│  ├─ src/modules/           auth/master/orders/purchases/production/qc/packing/shipping/
│  │                         inventory/attachments/exports/notifications/dashboard/
│  │                         exceptions/audit/cancellations
│  ├─ src/db/                数据库封装、迁移、合成种子
│  ├─ scripts/acceptance/    针对运行中服务的验收脚本（可选）
│  └─ tests/{unit,integration}/
├─ frontend/
│  ├─ src/app/               认证、路由保护、应用外壳
│  ├─ src/pages/admin/       管理员页面
│  ├─ src/pages/tablet/      物流/生产/品控/包装/异常
│  ├─ src/components/        通用 UI 与 Toast
│  ├─ src/lib/               API 客户端、类型、格式化、草稿/幂等 hook
│  └─ src/styles/global.css  设计系统与响应式
├─ tests/
│  ├─ e2e/                   Playwright 浏览器闭环
│  ├─ evidence/              截图证据
│  ├─ reports/               实际测试、备份/恢复记录
│  └─ README.md              测试入口导航
├─ scripts/backup.mjs        数据库 + 附件一致性备份
├─ scripts/restore.mjs       恢复到新隔离目录并校验
├─ docs/                     架构、接口、数据、权限、状态、运维、追溯、ADR
└─ tasks/                    plan / todo / progress
```

文档入口：

- [PRD](PRD-factory.md) · [架构](docs/architecture.md) · [接口合同](docs/api-contract.md)
- [数据字典](docs/data-dictionary.md) · [状态与数量](docs/state-and-quantity.md) · [权限](docs/permissions.md)
- [功能状态](docs/feature-status.md) · [运维手册](docs/operations.md) · [测试记录](tests/reports/2026-11-03-acceptance.md)
- [实施计划](tasks/plan.md) · [任务清单](tasks/todo.md) · [AI 协作说明](docs/ai-collaboration.md)

## 4. 配置

复制 `.env.example` 为 `.env`（可选；开发环境缺少时会在 `data/.auth-secret` 自动生成认证 pepper）。

| 配置键 | 读取位置 | 用途 | 是否必填/安全占位值 |
| --- | --- | --- | --- |
| `NODE_ENV` | `backend/src/config.ts` | 运行模式；生产必须显式提供 `AUTH_PEPPER` | `development` |
| `HOST` / `PORT` | `config.ts` / `server.ts` | 监听地址与端口 | `127.0.0.1` / `8787` |
| `DATABASE_PATH` | `config.ts` / db | SQLite 文件路径 | `data/factory.db` |
| `UPLOAD_DIR` | `config.ts` / attachments | PDF 存储目录 | `data/uploads` |
| `PUBLIC_DIR` | `config.ts` / app | 前端构建产物目录 | `frontend/dist` |
| `APP_ORIGIN` | `common/auth.ts` | 写请求 Origin 白名单，逗号分隔 | 见模板 |
| `SESSION_TTL_HOURS` | `auth` | 会话有效期 | `12` |
| `COOKIE_SECURE` | `auth` | HTTPS 部署时设 `true` | `false` |
| `DEMO_MODE` | `auth` | 是否暴露演示账号列表 | `true`（生产必须 `false`） |
| `DEMO_PASSWORD` | seed/auth | 合成演示账号密码 | `Demo@2026` |
| `MAX_UPLOAD_MB` | `attachments` | PDF 大小上限 | `5` |
| `AUTH_PEPPER` | `crypto` | 密码/会话哈希 pepper | 开发自动生成；生产必填 ≥32 字符 |
| `LOG_LEVEL` | `server` | 日志级别 | `info` |
| `BACKUP_DIR` | 脚本 | 备份目录 | `backups` |

前端只读取构建期资源，不存在可进入浏览器的数据库口令或后端密钥。测试与运行库通过 `DATABASE_PATH` 隔离；集成测试使用操作系统临时目录并在结束后删除。

## 5. 从干净环境安装与初始化

在项目根目录执行（已验证 Node 24.20.0 / npm 11.19.0）：

```powershell
# 1. 按锁文件安装（不要删除 package-lock.json 后强装）
npm ci

# 2. 创建数据库结构（幂等；已应用迁移不会重复执行）
npm run migrate

# 3. 写入合成演示数据（需显式确认；重复执行不重复插入演示订单）
npm run seed

# 4. 构建后端与前端（生产单进程模式）
npm run build
```

`npm run setup` 等价于 `migrate + seed`。种子只写入合成账号与四条演示订单，不清空已有业务数据；生产环境不要执行演示种子。

数据库结构由 `backend/migrations/*.sql` 管理，迁移校验和记录在 `schema_migrations`；已应用迁移被篡改会明确失败。演示数据由 `backend/src/db/seed.ts` 写入，重复执行通过编码/订单号去重。

## 6. 启动、访问与停止

### 推荐：生产单进程

```powershell
# 根目录
npm run build
npm start
```

- 前端与 API 同源：<http://127.0.0.1:8787>
- 登录页：<http://127.0.0.1:8787/login>
- 健康检查：`GET /api/v1/health`
- 就绪检查：`GET /api/v1/ready`（执行数据库查询）
- API 前缀：`/api/v1`

停止：在运行终端按 `Ctrl+C`。若端口被占用：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object OwningProcess
# 确认进程归属后再停止；不要盲杀未知 PID
```

### 开发双进程（可选）

```powershell
npm run dev
# API: http://127.0.0.1:8787
# Web: http://127.0.0.1:5173（Vite 代理 /api 到 8787）
```

`localhost` 与 `127.0.0.1` 是不同 Origin；默认两者都在 `APP_ORIGIN` 中。改端口必须同步 `.env`、代理与 README。

### 演示账号（全部为合成数据）

| 账号 | 角色 | 部门 | 演示职责 |
| --- | --- | --- | --- |
| `admin` | 管理员 | — | 建单、采购、下发、放行、发货、成本/库存/审计 |
| `logistics` | 物流 | 物流部 | 到货登记、发货登记 |
| `prod` | 生产 | 生产一部 | 本部门生产反馈 |
| `prod2` | 生产 | 生产二部 | 跨部门隔离演示 |
| `qc` | 品控 | 品控部 | 全合格质检录入 |
| `pack` | 包装 | 包装部 | 包装录入 |

密码统一为 `Demo@2026`。登录页“演示身份”可一键填入；这些凭据只用于本机合成演示，生产环境必须关闭 `DEMO_MODE` 并更换账号。

种子另有四条演示订单：`SO-DEMO-0001` 已完成（销售 1250 / 采购 252 / 生产 120 / 利润 878 / 毛利率 70.24%）、`SO-DEMO-0002` 待采购、`SO-DEMO-0003` 采购中、`SO-DEMO-0004` 生产中。

## 7. 检查与演示

### 7.1 自动化检查

| 检查 | 工作目录 | 实际命令 | 依赖/写库 | 结果与报告 |
| --- | --- | --- | --- | --- |
| 后端类型检查 | `backend` | `npm run typecheck` | 不写库 | 通过 |
| 前端类型检查 | `frontend` | `npm run typecheck` | 不写库 | 通过 |
| 生产构建 | 根目录 | `npm run build` | 生成 `backend/dist`、`frontend/dist` | 通过 |
| 单元 + 集成测试 | `backend` | `npm run test` | 每个测试使用临时 SQLite，结束删除 | **57/57 通过**（2026-11-21） |
| 浏览器闭环 | 根目录 | `npm run test:e2e` | 真实服务 + 真实 SQLite；创建合成订单 | **2/2 通过**（Edge，1440×900） |
| HTTP 验收冒烟 | 根目录 | `npm run test:acceptance` | 运行中的服务 + 合成订单 | **19/19 通过**（含幂等/权限/利润/导出/库存） |
| 备份 | 根目录 | `node scripts/backup.mjs` | 只读源库 + 写 `backups/` | 通过（含数据库 + 附件） |
| 恢复 | 根目录 | `node scripts/restore.mjs --backup <目录> --to <新目录>` | 写入新隔离目录，不覆盖源库 | 通过（integrity ok、数量/附件校验） |

单测与集成测试覆盖：认证/会话失效、角色与部门隔离、价格裁剪、建单/采购/到货/多部门生产/质检/包装/发货、幂等同键同体与异体、库存并发与首次创建、利润 Decimal 口径、xlsx 导出鉴权、PDF/PNG 附件伪装/越权、通知未读一致与交期提醒、审计脱敏、异常上报边界。实际记录见 [测试记录](tests/reports/2026-11-03-acceptance.md)。

### 7.2 现场演示顺序（约 5 分钟）

1. `admin` 登录，看板展示真实订单状态、生产进度、利润和临期订单。
2. 新建一张 10 件订单（单价 12.50），在详情建立采购（12 件 × 2.10）。
3. 退出，`logistics` 登录，登记到货 12 件；退出，`admin` 下发生产（工艺单价 1.20）。
4. 退出，`prod` 登录，提交 10 件反馈；退出，`admin` 下发质检。
5. `qc` 登录，提交 10 件全检全合格；`admin` 登录，处置 PASS → 下发包装。
6. `pack` 登录，包装 10 件；`admin` 确认发货；`logistics` 发货 10 件。
7. 回到 `admin` 订单详情：状态“已完成”、预计利润 87.80、毛利率 70.24%、13 条时间线。
8. 展示库存页手工 +10/-3、负库存拒绝、同键重试不重复；审计页查看 requestId 与脱敏前后值。
9. 刷新页面、重启服务，数据仍在；退出后用其他浏览器/账号看不到管理员数据。
10. v1.4 现场建档：建单时选择「＋ 新客户」直接输入名称，保存后详情即显示新客户，基础数据页出现自动编码。
11. v1.4 不合格流程：再造一张 5 件订单推进到待质检，`qc` 录 1 件不合格（原因必填）→ `admin` 处置弹窗中 PASS 不可点，选「退回返工」→ 订单回到生产中并提示补产 1 件；补产复检后才会放行。
12. v1.4 订单流水：看板利润卡点「查看订单流水」→ 实时合计、瀑布条与按订单明细；撤销单单独列出且不计入合计。

### 7.3 失败/边界演示

- 未登录直接访问 `/api/v1/inventory/parts/adjust` → 401；伪造 `x-role` 无效。
- 用 `prod2` 反馈 `prod` 部门任务 → 404，数据不变。
- 到货超过采购量、包装超过放行量、发货超过可发量 → 409，累计不变。
- 同幂等键不同请求体 → 409；同键同体重试 → 原结果。
- 直接 `PATCH /orders/:id/status` → 409；管理员撤销仅限待采购且创建 12 小时内，其他五类撤销入口仍返回 409；业务记录没有删除入口。
- 停掉后端刷新页面 → 明确错误/结果未知，不显示样例数据。
- 质检不合格却直接 PASS → 409；未补产就下发复检 → 409；上一轮未处置就复检 → 409。

## 8. 交付/部署方式

本期按**本地单机交付**验收，不做远程云部署，也不虚构域名/HTTPS 结果。生产单进程由 `npm start` 启动；前端静态文件由 `PUBLIC_DIR` 指向的 `frontend/dist` 提供，API 同源，无需 CORS。

- 运行数据：`data/factory.db` 与 `data/uploads/`（均被 `.gitignore` 忽略）
- 进程日志：默认 stdout/stderr；`LOG_LEVEL` 控制级别，请求头中的 Cookie/Authorization 已 redact
- 配置：通过环境变量或 `.env` 注入，不打包 `.env`
- 版本与依赖：根 `package-lock.json`；Node 版本记录在 README
- 源码包与数据备份分开：备份目录不进入源码包；恢复验证见第 9 节

## 9. 备份、恢复与回退

### 备份

```powershell
node scripts/backup.mjs
# 或指定目录
node scripts/backup.mjs --out backups/答辩前
```

脚本用 `VACUUM INTO` 生成一致性数据库快照，复制 `uploads/`，并写 `manifest.json`（时间、迁移、行数、数据库/附件 SHA-256）。备份目录默认 `backups/`，已被忽略。

### 恢复到新隔离环境

```powershell
node scripts/restore.mjs --backup backups/<备份目录> --to backups/restore-check
```

脚本拒绝覆盖非空目录；校验 manifest、数据库 SHA-256、`PRAGMA integrity_check`、订单/明细/附件数量和每个附件哈希。实际恢复验证结果见 [恢复记录](tests/reports/2026-11-03-acceptance.md)。

恢复后可用独立端口和路径启动核对：

```powershell
$env:PORT=8788
$env:DATABASE_PATH="$PWD\backups\restore-check\factory.db"
$env:UPLOAD_DIR="$PWD\backups\restore-check\uploads"
npm start
```

### 回退

- 代码回退：`git checkout <上一版本>` 只回退代码，**不能**回退 schema 或数据。
- 迁移回退：当前有 `001_init.sql`、`002_internal_messages.sql`、`003_orders_customers_batch.sql`；后续变更应新增迁移并评估兼容性，禁止直接改历史迁移或对运行库执行 reset。
- 数据回退：使用备份恢复到新隔离目录并核对，确认后再切换运行路径；不要用 Git 回退代替数据库恢复。

## 10. 常见问题

| 现象 | 如何定位 | 处理与风险 |
| --- | --- | --- |
| 启动报“数据库尚未初始化” | 是否执行过迁移 | 运行 `npm run migrate`，再 `npm run seed`；不要删除现有库 |
| 端口 8787 被占用 | `Get-NetTCPConnection -LocalPort 8787` | 确认进程归属后停止，或改 `PORT` 并同步文档/代理 |
| 登录 401“用户名或密码不正确” | 是否用了演示密码；账号是否停用 | 用登录页演示身份填入；生产不使用固定演示密码 |
| 页面 404 / API 404 | 是否先 `npm run build`；路径是否 `/api/v1` | 单进程模式需要 `frontend/dist`；API 前缀固定。替换 `dist` 后需重启服务，静态路由在启动时注册 |
| 写请求返回 409 `IDEMPOTENCY_CONFLICT` | 同一幂等键被用于不同内容 | 刷新确认状态；新业务意图换新键，不要复用旧键 |
| 到货/包装/发货被 409 拒绝 | 查看 `error.details` 的 available/remaining | 按剩余量调整；不要绕过前端直接改库 |
| 上传 415/413 | 是否 PDF/PNG/JPG、≤20MB、魔数有效 | 转成真实文件；超限文件压缩或走线下 |
| 页面显示“结果未知” | 网络中断或 5xx | 不要新建第二笔；先刷新/查询，再用原键重试 |
| 重启后会话失效 | 会话有效期/账号停用 | 重新登录；停用账号会撤销旧会话 |
| `node:sqlite` 出现实验性警告 | Node 24 内置模块提示 | 功能正常；生产可关注 Node 版本文档，不关闭类型/测试 |

## 11. 限制、贡献与许可

### 已知限制（如实记录）

- **单机 SQLite**：写事务串行化，适合本考核与单机演示；多实例/高并发部署需迁移 PostgreSQL，并重新验证锁与隔离级别。
- **M 范围简化**：单产品、一订单一采购单、单配件、无电镀；质检支持不合格上报与返工/报废处置（v1.4.0），但不支持部分交付；多产品/多批次/导入未选做。v1.2.0 已扩展为多生产任务/多部门并行，并提供 12 小时待采购订单撤销与批量确认发货；v1.3.0 增加交期提醒、图片附件与库存导出。
- **删除为标记删除**：v1.7.0 的订单删除只置 `deleted_at`，不物理删除，避免外键级联与审计断链；需要彻底清理时先备份再单独处理。
- **附件**：PDF/PNG/JPG、≤20MB；同一文件重复上传会产生两条元数据（附件本身不做幂等去重），删除/清理策略为 F 未选做。
- **登录限流**：进程内计数，重启后清零；单进程演示足够，分布式部署需共享存储。
- **审计检索**：管理员可按资源/结果/关键词过滤，但“完整审计管理、前后值历史增强”为 F 切片，未宣称完整实现。
- **无远程部署/HTTPS**：本地 HTTP；生产需反向代理、TLS、真实密钥与备份策略，另行评估。
- **演示数据**：所有客户、员工、电话、订单、附件均为虚构；不要导入真实个人或客户数据。

### 贡献与 AI 使用

本项目由本人独立完成需求分析、范围取舍、数据/状态设计、实现整合、测试与文档。开发过程中使用 AI 编码助手协助生成部分初版代码、测试骨架和文档草稿；本人对业务规则、权限边界、数量公式、数据库约束、测试断言和最终结果负责，并实际执行了本文记录的命令。具体的输入、判断、修改与复测见 [AI 协作说明](docs/ai-collaboration.md)。未以完整工厂参考工程为起点，未提交真实凭据或运行数据库。

### 许可

考核提交用途；第三方依赖遵循各自许可证（Fastify、React、Vite、ExcelJS、Zod、Lucide 等），清单见 [第三方声明](THIRD-PARTY-NOTICES.md)。根目录尚未添加 `LICENSE`；在未确认权属前不声明可对外开源。

## 12. GitHub 上传与接手

上传步骤、远程仓库命令、公开/私有取舍和上传后验证见 [GITHUB.md](GITHUB.md)。安全边界与禁止提交内容见 [SECURITY.md](SECURITY.md)，本次干净安装/备份恢复检查见 [GitHub 准备记录](tests/reports/2026-11-09-github-readiness.md)。

仓库自带 `.github/workflows/ci.yml`：推送到 `main`/`master` 或发起 PR 时，在 Node 24 上执行 `npm ci`、类型检查、57 个后端测试和构建；E2E 需要浏览器，未放进 CI，仍按本文命令在本机执行。

---

**快速开始**：`npm ci` → `npm run setup` → `npm run build` → `npm start` → 打开 <http://127.0.0.1:8787>。
