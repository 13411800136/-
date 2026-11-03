# AGENTS：厂序 FactoryFlow 仓库协作说明

本文件写给进入本仓库的 AI 编码助手与协作者。它不提供运行时鉴权；真正的权限、事务与约束在代码、数据库和测试中。

## 项目背景与依据

- 用途：工厂订单协同系统（管理员 + 物流/生产/品控/包装现场角色）。
- 技术栈：Node.js 24 + TypeScript + Fastify 5 + `node:sqlite`（SQLite）+ React 19 + Vite 7。
- 优先阅读：`README.md` → `PRD-factory.md` → `CONSTRAINTS.md` → `docs/architecture.md` → 当前改动涉及的 `docs/*` 与 `backend/src/modules/*`。
- 需求冲突：以任务包 M 范围与 `PRD-factory.md` 为准；发现文档与实现冲突，先记录问题并询问提交者，不自行把 M 降为 F、不删除测试、不放宽断言。
- 结果依据：只认当前版本源码与 `tests/reports/` 的真实执行记录；“计划”“模板”“历史通过”不等于当前通过。

## 开工流程

1. 说明目标、涉及文件、风险、是否需要迁移/改接口。
2. 先读现有实现与测试，保留已有修改；不要覆盖未提交的工作。
3. 改动跨接口/数据/权限时，先更新合同与测试，再改实现。
4. 涉及数据库结构：新增 `backend/migrations/NNN_*.sql`，禁止改写已应用迁移；评估兼容与恢复方式。
5. 涉及金额、数量、状态、权限：先找 `docs/state-and-quantity.md`、`docs/permissions.md` 与现有纯逻辑/集成测试，不凭直觉改。
6. 改完运行第 5 节命令，保留失败与复测记录。

## 目录与实现约定

- 后端入口：`backend/src/server.ts` 读取配置；`app.ts` 组装插件/路由；业务模块在 `backend/src/modules/`。
- 公共能力：`common/auth.ts`（会话/角色）、`common/idempotency.ts`（意图绑定）、`common/audit.ts`（脱敏审计）、`common/events.ts`（时间线/通知）、`common/money.ts`（整数分）。
- 数据访问：模块内直接使用 `AppDatabase` 的参数化查询；写事务用 `db.tx()`（`BEGIN IMMEDIATE`）。不要在事务外做“先读后写”的数量判断。
- API：统一前缀 `/api/v1`，成功 `{data,requestId}`，失败 `{error:{code,message,details?},requestId}`。所有关键写操作要求 `Idempotency-Key`。
- 金额：数据库存整数分；接口对外输出两位小数字符串；禁止二进制浮点参与金额计算。
- 时间：事件存 UTC ISO8601；业务日/交期按 `Asia/Shanghai`；日期字符串不要经浏览器 UTC 转换。
- 身份：操作者从认证会话取，绝不接受 body 的 `actorId`、`x-role` 或前端自报角色。
- 权限：前端隐藏按钮只是交互；路由角色守卫 + 服务层对象/部门/字段校验，两者都要有。
- 价格：生产任务仅当 `priceVisible=1` 时在**生产角色**响应中返回 `unitPrice`；其他现场角色与列表不得泄露采购价/销售价/利润。
- 状态：只能通过受控动作推进；不提供通用状态 PATCH；未支持撤销返回 409 `FEATURE_NOT_ENABLED`。
- 文件：附件只接受 PDF、≤5MB、校验扩展名/MIME/魔数；服务端存储键，禁止路径拼接用户输入。
- 前端：请求统一走 `frontend/src/lib/api.ts`；写提交使用 `useIntentKey`；网络错误显示“结果未知”并用原键重试；表单草稿只存本机，不含密码。

## 数据与操作安全

不得读取/外传真实秘密、个人资料、运行数据库、`.env`、浏览器会话。测试必须使用临时 SQLite 与合成账号；不得把测试指向真实库。

以下操作必须先获得提交者明确确认：

- 对 `data/factory.db` 执行 reset、drop、批量 update/delete；
- 运行 seed 覆盖/清理业务数据；
- 备份恢复覆盖现有目录；
- 部署、远程推送、删除迁移/回滚 schema；
- 修改 `.env` 中的生产密钥或关闭认证/权限检查。

禁止：用假数据掩盖接口失败、删除或跳过失败测试、降低断言、关闭 TypeScript 严格检查、在日志/审计中记录明文密码或令牌。

## 实际验证入口

| 检查 | 工作目录 | 命令 | 风险/依赖 | 结果记录位置 |
| --- | --- | --- | --- | --- |
| 后端类型 | `backend` | `npm run typecheck` | 只读 | 本文件/CI 输出 |
| 前端类型 | `frontend` | `npm run typecheck` | 只读 | 本文件/CI 输出 |
| 单元 + 集成 | `backend` | `npm run test` | 每个测试独立临时 DB；会写临时目录 | `tests/reports/2026-11-03-acceptance.md` |
| 构建 | 根目录 | `npm run build` | 写 `dist/` | 构建日志/README |
| 浏览器闭环 | 根目录 | `npm run test:e2e` | 需要已启动服务 + Edge；会创建合成订单 | `tests/evidence/e2e/`、`tests/reports/` |
| 备份 | 根目录 | `node scripts/backup.mjs` | 读源库、写 `backups/` | `tests/reports/` |
| 恢复 | 根目录 | `node scripts/restore.mjs --backup <dir> --to <new>` | 只写新隔离目录 | `tests/reports/` |

不得编造脚本；未执行必须标“未执行”。

## 完成与交接

每次完成应汇报：

1. 改动文件与行为；
2. 实际执行的命令、结果（通过/失败/未执行）；
3. 数据/接口/权限/迁移影响；
4. 失败与已知问题；
5. 回退方式与剩余风险。

必须同步更新：受影响的接口合同、数据字典、状态/数量、权限、功能状态、测试记录和版本说明。不要只改代码不改文档，也不要把“已实现”写成“已验收”。
