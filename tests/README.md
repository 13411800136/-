# 测试导航

版本：v1.4.0 / 2026-11-14

| 层级 | 目录/命令 | 依赖 | 是否写库 | 结果记录 |
| --- | --- | --- | --- | --- |
| 纯逻辑单测 | `backend/tests/unit`；`cd backend; npm run test:unit` | Node 24 | 否 | 本目录报告 |
| API + 真实 DB 集成 | `backend/tests/integration`；`cd backend; npm run test:integration` | 临时 SQLite | 写临时库，结束删除 | 本目录报告 |
| 全部后端测试 | `cd backend; npm run test` | 临时 SQLite | 是（临时） | `tests/reports/2026-11-03-acceptance.md` |
| 浏览器端到端 | 根目录；`npm run test:e2e` | 已构建前端 + 运行中服务 + Edge | 写真实演示库（合成订单） | `tests/evidence/e2e/`、Playwright 报告 |
| HTTP 验收冒烟 | 根目录；`npm run test:acceptance` | 运行中服务 | 写真实演示库（合成订单） | `tests/reports/acceptance-run.txt` |
| 备份 | 根目录；`node scripts/backup.mjs` | 运行库可读 | 写 `backups/` | `tests/reports/` |
| 恢复 | 根目录；`node scripts/restore.mjs --backup <dir> --to <new>` | 备份目录 | 只写新隔离目录 | `tests/reports/` |
| 上传准备检查 | 根目录；见 `GITHUB.md` | Node 24 + Git | 否（干净目录另建） | `reports/2026-11-09-github-readiness.md` |

## 隔离防线

- 集成测试由 `backend/tests/helpers.ts` 为每个测试环境创建操作系统临时目录，数据库、上传目录、public 目录都在其中；结束后删除。
- 每个测试文件使用独立数据库；不同文件可并行，互不共享状态。
- E2E 使用本机演示库和合成账号；运行前建议 `npm run setup` 并从干净数据开始；测试会创建新订单，不会删除既有数据。
- 备份/恢复脚本恢复目标必须是非空检查的新目录，不覆盖当前运行库。

## 测试家族

1. **单元**：金额解析/格式化、利润、毛利率、日期/时区、成品身份键。
2. **集成**：认证/会话、角色/部门/字段权限、建单/采购/到货/生产/质检/包装/发货、幂等重放与冲突、库存并发/首建竞争、事务中途失败回滚、通知、看板、异常、审计、导出、附件、岗位历史、内部消息、现场建档、质检不合格返工/报废、订单流水。
3. **浏览器 E2E**：五角色完整闭环 + 网络响应丢失/草稿恢复/同键重试。
4. **交付与恢复**：干净目录 `npm ci`/迁移/种子/构建/启动；备份恢复到新隔离目录并用独立实例核对。

## 已知未执行

- F 场景中 A05/A08/A09/A13/A16/A17/A21/A25 未选做；A11 多部门生产、A14/A15 相关批量发货已用 v1.2/v1.3 增量测试覆盖。
- 未做生产级高并发压测（SQLite 单写者）；只做两连接正确性测试，不宣称性能指标。
- 未做跨浏览器矩阵（仅 Edge/Chromium）；响应式在 1440/1024/390 检查。
- 未做故障注入之外的网络代理/断网设备级测试；应用层“响应丢失”已用 Playwright 路由模拟。
