# 质量约束：厂序 FactoryFlow

版本/日期/维护者：v1.0 / 2026-11-03 / 李嘉磊。
适用范围与基线：第三轮考核 M 最低实现 + 已申报 F 切片 + v1.2 用户追加增强；基线为当前仓库 `v1.3.1`。

| 维度 | 本项目不可降低的规则 | 具体执行位置/验证方法 | 证据位置 |
| --- | --- | --- | --- |
| 数据真实性 | 页面只读真实 API/数据库；失败不塞样例数据；空列表就是空 | `frontend/src/lib/api.ts`、各页面 loading/error/empty；后端查询真实表 | 集成测试、E2E、空状态截图 |
| 持久化与恢复 | 写操作落 SQLite；刷新、重启、换浏览器仍可读；备份恢复到新环境 | `backend/src/db/*`、`scripts/backup.mjs`、`restore.mjs` | `tests/reports/2026-11-03-acceptance.md`、恢复实例核对 |
| 身份权限 | 服务端会话主体；角色、部门、对象、字段、文件分别校验；不接受 body 冒充 | `common/auth.ts`、各路由 `requireRole`、service 部门/对象检查 | A01/A02 集成测试、E2E 多角色 |
| 数量与状态 | 正整数；到货/反馈/检验/包装/发货逐层闸门；状态只由动作推进 | 各模块 service 守卫；`buildOperationSummary`；`state-and-quantity.md` | 集成测试逐项 409；时间线 13 事件 |
| 幂等与并发 | 写意图绑定 actor+operation+key+请求摘要；同键同体返回原结果；库存条件更新不丢更新 | `common/idempotency.ts`；库存 `UPDATE ... WHERE quantity + ? >= 0`；唯一约束 | A19/A20 测试；两连接并发最终 3 |
| 金额与日期 | 整数分计算；两位小数；毛利率约定；北京时间自然日；日期不跨 UTC 偏移 | `common/money.ts`、`common/time.ts`、前端 `format.ts` | 单测 A22；`70.24%` 页面/测试 |
| 失败与可观测性 | 真实错误码/中文提示；未知结果不报成功；事务回滚；审计脱敏；requestId | `app.ts` 错误处理、`common/audit.ts`、`runIdempotent` | A30/A31 测试；日志/审计截图 |
| 测试与证据 | 不删跳测试、不降低断言、不伪造通过；失败保留并复测 | `backend/tests/**`、`tests/e2e/**`、`tests/reports/**` | 44/44 单测集成、2/2 E2E |
| 配置与隐私 | 秘密/运行库/浏览器会话不入包；测试库隔离；生产禁用演示模式 | `.env.example`、`.gitignore`、`loadConfig` 生产校验 | `.gitignore`、README、测试临时目录 |
| 可复现交付 | 锁文件、迁移、合成种子、配置模板、实测 README、干净启动 | `package-lock.json`、`backend/migrations/`、`seed.ts`、README | 构建/启动/恢复实测记录 |
| AI 协作与贡献 | 审查 diff；说明继承与本人工作；关键改动有测试与复测 | `AGENTS.md`、`docs/ai-collaboration.md` | 文档与 Git 历史 |

## 不可接受的“过关”方式

- 用前端假数据、mock 响应或硬编码金额让页面好看；
- 只隐藏按钮、不在服务端校验；
- 用 `findFirst` 未发现就无条件 `create` 处理库存首次创建；
- 用“事务”声明代替并发实测；
- 删除失败测试、跳过 E2E、关闭 `strict`；
- 把未实现 F 写成“已完成”，或把 M 未完成写成“不适用”；
- 在日志、审计、截图中出现明文密码、令牌、真实客户/员工信息。

## 变更记录

| 日期 | 规则旧值/新值 | 理由与影响 | 受影响检查 | 批准者 |
| --- | --- | --- | --- | --- |
| 2026-11-03 | 初始建立 | 项目启动，确定 M 范围与验证方式 | 全部 | 李嘉磊 |
| 2026-11-03 | 增加“未知结果”与审计脱敏检查 | 修复错误处理器/上传测试时补充 | A30/A31 | 李嘉磊 |

性能、容量或覆盖率若另定指标，需写明环境、样本、命令、阈值和确认者；本项目不虚构生产级指标。
