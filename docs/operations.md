# 运行与维护手册

版本：v1.1.0 / 2026-11-09
README 是入口；本文件记录较长的运维细节。

## 1. 安装与初始化

```powershell
npm ci
npm run setup      # migrate + seed（合成数据）
npm run build
npm start
```

- `npm ci` 只使用根 `package-lock.json`；不要混用 pnpm/yarn。
- `npm run migrate` 可重复执行；已应用迁移按 checksum 校验，改写历史迁移会失败。
- `npm run seed` 只写合成账号与四条演示订单；重复执行按用户名/编码/订单号去重，不清空业务数据。
- 生产环境：`NODE_ENV=production`、`DEMO_MODE=false`、显式 `AUTH_PEPPER`（≥32 字符）、`COOKIE_SECURE=true`、独立数据库/附件路径、关闭公开演示入口。

## 2. 配置检查

启动时 `loadConfig()` 校验：

- `NODE_ENV` 合法；`PORT` 1-65535；`SESSION_TTL_HOURS` 1-168；`MAX_UPLOAD_MB` 0-50。
- 生产缺少 `AUTH_PEPPER` 直接失败；开发缺省会在 `data/.auth-secret` 生成随机 secret（权限 0600，已忽略）。
- 数据库目录与上传目录自动创建；缺迁移由 `assertSchemaReady` 明确报错并退出。
- `APP_ORIGIN` 为写请求 Origin 白名单；`localhost` 与 `127.0.0.1` 必须分别列。

## 3. 启动与停止

### 单进程（推荐）

```powershell
npm start
# http://127.0.0.1:8787
```

后台运行（仅本机演示）：

```powershell
Start-Process node -ArgumentList 'backend/dist/server.js' -WorkingDirectory (Get-Location)
```

停止：前台 `Ctrl+C`；后台先确认端口归属：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
Get-Process -Id <PID> | Select-Object Id,ProcessName,Path
Stop-Process -Id <PID>
```

### 开发

```powershell
npm run dev
# API 8787 + Vite 5173，/api 代理
```

## 4. 健康检查

| 检查 | 路径 | 含义 |
| --- | --- | --- |
| 存活 | `GET /api/v1/health` | 进程能响应；不查数据库 |
| 就绪 | `GET /api/v1/ready` | 执行 `SELECT 1`；数据库不可用返回 500 |
| 静态页 | `GET /` / `GET /login` | 生产构建存在时返回 HTML |
| 审计/日志 | `X-Request-Id` | 每个响应带 requestId；用于排查 |

`health` 不泄露版本/路径/连接串。就绪检查不应作为业务健康唯一指标；业务失败通过错误码与审计定位。

## 5. 日志

- Fastify 结构化日志输出 stdout/stderr；`LOG_LEVEL=silent|error|warn|info|debug`。
- 请求头 `authorization`/`cookie` 与响应 `set-cookie` 已 redact。
- 500 日志包含 `err` 与 `requestId`，但不返回给客户端。
- 审计表 `audit_logs` 是业务追溯来源；包含成功与失败、requestId、操作者、资源、脱敏前后值。
- 日志轮转/集中收集不在本项目范围内；生产需由外部进程管理。

## 6. 数据库与迁移

- 位置：`DATABASE_PATH`；WAL 文件与 `-shm` 同目录。
- 迁移：`backend/migrations/NNN_*.sql`；运行 `npm run migrate`。
- 已应用迁移不可改；新增字段/表必须新建迁移，并在测试库与恢复环境验证。
- 禁止在运行库执行 `DROP`/批量 `DELETE`/`reset`；开发重置只能对明确的本机演示库执行。
- 备份前确认业务写入低峰；`VACUUM INTO` 生成一致快照，但备份期间仍有新写入时，快照点由 SQLite 决定；manifest 记录时间与哈希。

## 7. 备份

```powershell
node scripts/backup.mjs
node scripts/backup.mjs --out backups/答辩前
```

输出目录包含：

```text
factory.db        VACUUM INTO 一致性快照
uploads/          附件文件
manifest.json     时间、迁移、行数、数据库/附件 SHA-256
```

保留策略：本脚本不自动删除；建议至少保留答辩前、提交前两份，分别存放；不要提交到 Git。

## 8. 恢复

```powershell
node scripts/restore.mjs --backup backups/<备份> --to backups/restore-check
```

- 拒绝覆盖非空目录；不触碰源库。
- 校验数据库 SHA-256、`PRAGMA integrity_check`、订单/明细/附件数量、附件哈希。
- 恢复后用独立端口/路径启动核对：

```powershell
$env:PORT=8788
$env:DATABASE_PATH="$PWD\backups\restore-check\factory.db"
$env:UPLOAD_DIR="$PWD\backups\restore-check\uploads"
npm start
```

实际验证：恢复实例读取 `SO-20261103-0001`（COMPLETED、利润 87.80），附件 PDF 下载 200；见 `tests/reports/restore-runtime-check.txt`。

## 9. 发布与回退

- 发布：锁定版本 → `npm ci` → `npm run build` → 迁移 → 启动 → 健康/就绪 → 一条新订单闭环。
- 代码回退：Git 回退代码；**不**回退 schema/数据。
- 数据回退：用备份恢复到新目录并核对；确认后再切换 `DATABASE_PATH`/`UPLOAD_DIR`。
- 迁移兼容：新增迁移应先评估旧代码能否读新结构；不可逆变更需先备份并演练恢复。
- 当前有两个迁移：`001_init.sql`（初始结构）、`002_internal_messages.sql`（内部消息）；没有远程发布、蓝绿/容器编排。

## 10. 排错

| 现象 | 定位 | 处理 |
| --- | --- | --- |
| 启动“数据库尚未初始化” | 是否运行 migrate | `npm run migrate`；检查 `DATABASE_PATH` |
| 端口占用 | `Get-NetTCPConnection` | 确认进程归属后停止或改端口 |
| 登录 401 | 账号/密码/停用；登录限流 | 使用演示账号；等待限流；查看审计 AUTH_LOGIN |
| 403 | 角色/部门/Origin | 检查账号角色与 `APP_ORIGIN`；不要用前端绕过 |
| 409 数量 | `error.details` 的 available/remaining | 按剩余量调整；刷新后重试 |
| 409 幂等 | `details.code` | 同键同体重试；新意图换键 |
| 413/415 | 文件大小/类型/魔数 | 使用真实 PDF≤5MB |
| 500 | requestId + 服务日志 | 查看事务是否回滚；不要重复提交直到确认 |
| 静态页 404 | `frontend/dist` 是否存在 | `npm run build`；检查 `PUBLIC_DIR` |
| 数据不一致 | 库存流水/时间线/审计/幂等表 | 用备份恢复；不要手改运行库 |

## 11. 安全运维

- 不把 `.env`、`data/`、`backups/`、浏览器会话、日志中的敏感内容提交或发给 AI。
- 生产关闭 `DEMO_MODE`，更换演示密码，限制 `APP_ORIGIN`，使用 HTTPS 且 `COOKIE_SECURE=true`。
- 定期备份并做恢复演练；备份文件按敏感数据保管。
- 审计不可改删；管理员检索也走只读接口。
- 附件目录只允许应用进程读写；不要暴露为静态目录。
