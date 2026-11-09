# 架构说明：厂序 FactoryFlow

版本/基线：v1.3.0 / 2026-11-09
关联：[PRD](../PRD-factory.md) · [接口合同](api-contract.md) · [数据字典](data-dictionary.md) · [状态与数量](state-and-quantity.md)

## 1. 系统上下文

```text
浏览器（管理员桌面 / 现场平板）
        │  HTTPS/HTTP 同源
        ▼
┌─────────────────────────────────────────┐
│ Node.js 24 + Fastify 5                  │
│  /api/v1/*        API（Cookie 会话）     │
│  /*               静态前端（生产构建）   │
└──────────────┬──────────────────────────┘
               │ node:sqlite（同步驱动）
               ▼
        SQLite 文件 + WAL
        data/factory.db
        data/uploads/*.pdf
```

外部依赖只有 Node 运行时和 npm 包；没有云服务、消息队列、Redis、对象存储或邮件服务。业务通知存数据库，页面轮询未读数；附件存本地受控目录。

## 2. 模块与职责

| 路径 | 职责 | 输入/输出 |
| --- | --- | --- |
| `backend/src/server.ts` | 读取配置、打开数据库、校验迁移、监听、优雅退出 | 环境变量 → HTTP 服务 |
| `backend/src/app.ts` | 插件、错误处理、静态文件、路由组装、requestId | 请求 → 统一响应 |
| `common/auth.ts` | 会话令牌哈希、Cookie/Bearer 认证、角色守卫、Origin 校验 | 请求 → `request.auth` |
| `common/idempotency.ts` | `actor+operation+key` 作用域、请求摘要、结果回放 | 写意图 → 原结果/冲突 |
| `common/events.ts` | 订单时间线、管理员通知、去重键 | 业务事件 → `order_timeline/notifications` |
| `common/audit.ts` | 审计写入、敏感字段递归脱敏 | 操作 → `audit_logs` |
| `common/money.ts` / `time.ts` | 整数分、利润、北京时间日期 | 值对象 |
| `modules/auth` | 登录、登出、me、演示账号 | 会话 |
| `modules/master` | 客户/供应商/配件/部门/员工 | 基础数据 |
| `modules/orders` | 建单、列表、详情、汇总、利润、阶段、时间线 | 订单聚合 |
| `modules/purchases` | 采购单、到货登记、到货查询 | 采购/到货 |
| `modules/production` | 生产下发、现场任务、反馈、单价开关 | 生产 |
| `modules/qc` | 质检下发、队列、录入、管理员 PASS | 质检 |
| `modules/packing` | 包装下发、队列、包装录入、汇总 | 包装 |
| `modules/shipping` | 物流队列、确认发货、发货登记、历史与汇总 | 发货 |
| `modules/inventory` | 配件/成品台账、原子调整、流水 | 库存 |
| `modules/attachments` | PDF 上传/列表/下载、类型与大小校验 | 附件 |
| `modules/exports` | 订单 xlsx（筛选、鉴权、空表头） | 文件 |
| `modules/notifications` | 未读、已读、全部已读 | 通知 |
| `modules/dashboard` | 状态、生产、利润、临期、库存汇总 | 看板 |
| `modules/exceptions` | 现场异常上报/查看、订单选项 | 异常 |
| `modules/messages` | 内部消息：收件人、收件箱/已发送、未读、已读、职责范围订单关联 | 沟通 |
| `modules/audit` | 管理员审计检索、禁止改删 | 审计 |
| `modules/cancellations` | 五个撤销/删除入口统一 409；v1.2 待采购 12h 撤销在 orders 模块受控实现 | 边界 |

前端：

| 路径 | 职责 |
| --- | --- |
| `frontend/src/app/AuthContext.tsx` | 会话恢复、登录/退出、角色首页 |
| `app/ProtectedRoute.tsx` | 路由级角色保护（不替代后端） |
| `app/AppShell.tsx` | 侧边导航、通知角标、响应式外壳 |
| `lib/api.ts` | 同源 fetch、错误映射、结果未知、文件上传/下载 |
| `lib/hooks.ts` | `useAsync`、本机草稿、稳定幂等键 |
| `pages/admin/*` | 看板、订单、建单、详情、库存、基础数据、通知、审计、异常 |
| `pages/tablet/*` | 物流、生产、品控、包装、异常 |
| `pages/MessagesPage.tsx` | 各角色的内部消息收件箱/已发送/发消息 |
| `components/ui.tsx` / `Toast.tsx` | 按钮、字段、模态框、状态、表格、提示 |

## 3. 一次真实请求路径：库存调整

以 `POST /api/v1/inventory/parts/adjust` 为例：

```text
页面 InventoryPage
  → api.post(path, body, intentKey)
  → Fastify 路由 /inventory/parts/adjust
  → createAuthenticate（Cookie → sessions → users → request.auth）
  → requireAdmin（角色）
  → validate(zod：partId、非零整数 delta、原因、幂等键)
  → runIdempotent（BEGIN IMMEDIATE）
       ├─ 查 idempotency_requests（actor+operation+key）
       ├─ 同键同摘要且已完成 → 返回原 data
       ├─ 同键异摘要 → 409 IDEMPOTENCY_CONFLICT
       ├─ 保留 IN_PROGRESS
       ├─ 读 part_inventory（不存在且 delta<0 → 409）
       ├─ UPDATE ... SET quantity = quantity + ?, version = version + 1
       │        WHERE part_id = ? AND quantity + ? >= 0
       ├─ 检查 changes = 1，读取实际 before/after
       ├─ 写 inventory_logs（before + delta = after）
       ├─ 写 audit_logs（脱敏）
       └─ 保存幂等结果
  → 200 {data:{inventoryId,before,delta,after,logId},requestId}
  → 前端刷新台账/流水
```

关键点：

- 操作者来自会话，不接受 body 的 `actorId`。
- 输入在路由层用 zod 校验，数据库再用 CHECK/FK/UNIQUE 兜底。
- 数量判断与更新在同一写事务内；条件 UPDATE 检查受影响行数。
- 业务记录、流水、审计、幂等结果同事务提交；失败整体回滚。
- 前端不乐观加数，成功后才刷新。

## 4. 事务、幂等与并发

### 事务

`AppDatabase.tx()` 使用 `BEGIN IMMEDIATE`，默认 `busy_timeout=5000`；不支持异步事务（SQLite 驱动同步），文件生成/Excel 生成等异步工作放在事务外。嵌套调用复用外层事务，避免部分提交。

### 幂等

| 项 | 设计 |
| --- | --- |
| 作用域 | `actor_id + operation + key`，数据库 UNIQUE |
| 请求绑定 | `operation + 规范化 payload` 的 SHA-256 |
| 同键同体 | 返回保存的原业务结果（附 `Idempotent-Replayed: true`） |
| 同键异体 | 409 `CONFLICT`，details.code=`IDEMPOTENCY_CONFLICT` |
| 进行中 | 409 `CONFLICT`，details.code=`IDEMPOTENCY_IN_PROGRESS` |
| 过期 | 默认 72h；过期返回 409，要求刷新确认，不悄悄变成新业务 |
| 保存时机 | 与业务写入同一事务，成功后置 `COMPLETED` 并保存 data |
| 适用 | 建单、采购、到货、生产下发/反馈、质检录入/处置、包装、发货、库存增减、单价开关等 |

### 并发

- 库存使用条件更新（见上），而不是“读 10、算 3、写 3”。
- 首次创建依赖 UNIQUE（`part_inventory.part_id`、`product_inventory.product_key`），冲突后重读并原子更新；两连接并发 +1 最终数量 2、两条流水。
- 订单/采购编号使用 `counters` 原子递增 + `RETURNING`，订单号/采购号 UNIQUE。
- 到货/反馈/包装/发货的数量判断在事务内重新读取累计值。
- SQLite 是单写者：并发测试证明当前进程/多连接下不丢更新；多实例高并发不是本交付的部署形态。

## 5. 认证与会话

```text
POST /auth/login
  → 查 users（username COLLATE NOCASE）
  → scrypt(password|pepper, salt, 64) 与哈希 timingSafeEqual
  → 生成 32 字节随机 token；数据库存 sha256(token|pepper)
  → HttpOnly + SameSite=Lax Cookie（Secure 按配置）
  → 审计 AUTH_LOGIN
```

后续请求：Cookie 或 `Authorization: Bearer` → sessions join users/departments → 检查过期、revoked、active、`session_version`。写请求若使用 Cookie，校验 Origin 是否在 `APP_ORIGIN`；Bearer 用于脚本/测试。

密码存储：`scrypt(N=16384,r=8,p=1)` + 16 字节随机 salt + pepper；数据库只存 hash/salt。生产必须配置 `AUTH_PEPPER`；开发缺省自动生成 `data/.auth-secret`（被忽略，不打包）。

停用账号或重置密码会递增 `users.session_version` 并撤销该用户全部会话。角色变更不在本版提供（F 账户管理），避免旧权限继续使用。

## 6. 价格裁剪

- 管理员响应包含销售价、采购价、利润、生产成本。
- 物流/品控/包装的队列响应不查询或序列化价格列。
- 生产任务仅当 `price_visible=1` 时，对**生产角色**返回 `unitPrice`；管理员始终可看。
- 附件、导出需要管理员；普通角色请求返回 403。
- 不依赖“递归删除字段名”这种易漏方式；每个对外序列化器显式选择字段。

## 7. 静态文件与端口

生产单进程由 `@fastify/static` 提供 `frontend/dist`，SPA 未命中时回退 `index.html`；API 路由优先。前端与 API 同源，不需要 CORS。开发模式 Vite 5173 代理 `/api` 到 8787；Origin 白名单同时包含两者。

`localhost` 与 `127.0.0.1` 不视为同一 Origin；默认配置包含两者。

## 8. 数据与文件

- 数据库：`data/factory.db`（WAL、`synchronous=NORMAL`、`foreign_keys=ON`）。
- 附件：`data/uploads/<uuid>.pdf`，数据库存原始名、MIME、大小、SHA-256、存储键；下载时鉴权并设置 `Content-Disposition`。
- 备份：`VACUUM INTO` 生成一致性快照 + 复制附件 + manifest；恢复到新目录后 `integrity_check` 与哈希校验。
- 运行数据、备份、`.env`、构建产物都在 `.gitignore` 中。

## 9. 取舍与限制

| 决定 | 备选 | 理由 | 影响 |
| --- | --- | --- | --- |
| SQLite + 单进程 | PostgreSQL + Prisma | 零外部服务、事务/约束真实、Windows 易复现 | 单写者；多实例需迁移 |
| 手写迁移 runner | ORM 迁移 | 结构透明、校验和、无生成器依赖 | 需要自己维护 SQL |
| Opaque 会话 + scrypt | JWT + bcrypt | 可服务端撤销、无签名密钥轮换问题 | 每次请求查会话表（有索引） |
| 手写业务守卫 | 通用状态机库 | 数量/部门/角色规则交织，显式代码更易审计 | 规则集中在 service，需测试覆盖 |
| 单产品/单采购 | 完整 F 模型 | 三至四周优先 M 可靠性；v1.2 已扩展多生产任务 | 多产品等 F 未选做 |

## 10. 决策记录

- [ADR-001：SQLite 与单进程部署](decisions/ADR-001-sqlite.md)
- [ADR-002：不透明会话与 scrypt](decisions/ADR-002-session-auth.md)
- [ADR-003：M 范围与不做清单](decisions/ADR-003-scope.md)
