# 功能状态表：R01-R27

版本：v1.3.0 / 2026-11-09
状态定义：**已验收**＝当前版本有真实执行证据；**已实现待验收**＝代码完成但未跑对应场景；**部分实现**＝只完成申报切片；**未实现**；**不适用**＝范围表明确允许或明确不启用。未执行不填“通过”。

## 1. M 必做逐项状态

| 需求 | 层级 | 状态 | 实现位置 | 验收证据 | 限制/说明 |
| --- | --- | --- | --- | --- | --- |
| R01 身份与会话 | M | **已验收** | `modules/auth/routes.ts`、`common/auth.ts`、`common/crypto.ts` | `auth.test.ts`、`master-session.test.ts`、E2E 五角色切换 | 管理员为单一 ADMIN 角色；账户生命周期增强为 F |
| R02 基础数据 | M | **已验收** | `modules/master/routes.ts`、`migrations/001_init.sql` | `master-session.test.ts`（编码冲突、改名快照、停用引用、员工创建/停用） | 修改停用不破坏历史；无物理删除 |
| R03 业务订单 | M | **已验收** | `modules/orders/routes.ts`、`orders/service.ts` | `order-flow.test.ts`、E2E 建单 | 单产品；订单号并发安全；无编辑/取消 |
| R04 采购 | M | **已验收** | `modules/purchases/routes.ts` | `order-flow.test.ts`（一单一采购单、价格快照） | 单采购单/单配件；不自动分单 |
| R05 到货 | M | **已验收** | `modules/purchases/routes.ts` | `order-flow.test.ts`（幂等、超量、权限） | 一次/多次累计；M 演示一次到齐 |
| R06 电镀 | M | **不适用** | `orders/service.ts` 阶段投影；无电镀接口 | `order-flow.test.ts` 断言 `PLATING:NOT_APPLICABLE`；页面显示不适用 | 范围表明确 M 不启用；不生成伪事件 |
| R07 生产 | M + v1.2 | **已验收** | `modules/production/routes.ts` | `order-flow.test.ts`、`order-ops.test.ts`（多部门 60+40、反馈、超量、幂等） | 支持多任务/多部门；任务累计≤订单量 |
| R08 单价开关 | M | **已验收** | `modules/production/routes.ts`、`serializeTask` | `order-flow.test.ts`（关闭无 unitPrice，开启后 1.20） | 仅该任务工艺价；其他成本不泄露 |
| R09 质检 | M | **已验收** | `modules/qc/routes.ts` | `order-flow.test.ts`（录入/放行分离、部分合格拒绝、重复 PASS） | 一次全检全合格；返工/报废 F 未选做 |
| R10 包装 | M | **已验收** | `modules/packing/routes.ts` | `order-flow.test.ts`（未放行拒绝、超量拒绝） | 单产品；数量≤放行/应交 |
| R11 发货 | M | **已验收** | `modules/shipping/routes.ts` | `order-flow.test.ts`（超发拒绝、足量完成） | 支持多次累计；M 一次发足 |
| R12 撤销/删除 | M + v1.2 | **已实现（M 边界 + 12h 撤销）** | `modules/cancellations/routes.ts`、`orders/routes.ts` | `auth.test.ts`（五类入口 409）、`order-ops.test.ts`（12h/超时/越权） | 仅待采购订单 12h 内管理员可撤销；其他入口仍拒绝；不删除记录 |
| R13 配件库存 | M | **已验收** | `modules/inventory/routes.ts` | `inventory.test.ts`（增减、非负、幂等、流水） | 手工调整；不自动扣库 |
| R14 成品库存 | M | **已验收** | `modules/inventory/routes.ts` | `inventory.test.ts`（唯一身份、首建并发、最终 2） | `productKey` 规范化；首次必须正向 |
| R15 利润 | M | **已验收** | `common/money.ts`、`orders/service.ts` | `money.test.ts`、`order-flow.test.ts`（878.00 / 70.24%） | 预计利润；无电镀成本；非财务结算 |
| R16 时间线与状态 | M | **已验收** | `common/events.ts`、`orders/service.ts` | `order-flow.test.ts`（13 事件、9 阶段）、E2E 截图 | 直接 PATCH 状态 409；电镀 N/A |
| R17 附件 | M + F | **已验收** | `modules/attachments/routes.ts` | `export-attachment.test.ts`、`f-extensions.test.ts`（PNG/伪装/越权） | PDF/PNG/JPG≤20MB；删除/清理 F 未选做 |
| R18 导入 | M | **不适用** | 无导入接口；基础数据页面维护 | 范围表 M 允许不提供；README/PRD 说明 | F 导入未选做；不提供空壳 |
| R19 导出 | M + F | **已验收** | `modules/exports/routes.ts` | `export-attachment.test.ts`、`f-extensions.test.ts`（库存 xlsx） | 订单列表 + 库存台账；其他报表 F 未选做 |
| R20 通知 | M + F | **已验收** | `common/events.ts`、`modules/notifications/routes.ts`、`reminders.ts` | `order-flow.test.ts`、`notifications-dashboard.test.ts`、`f-extensions.test.ts` | 关键事件通知；未读一致；7 天/逾期交期提醒每日去重 |
| R21 看板 | M | **已验收** | `modules/dashboard/routes.ts`、`DashboardPage.tsx` | `notifications-dashboard.test.ts`（状态和=总数）、看板截图 | 真实数据；空集 0；无虚构效率 |
| R22 异常上报 | M | **已验收** | `modules/exceptions/routes.ts` | `notifications-dashboard.test.ts`（关联、跨部门、不改数量） | 上报/查看；处理状态 F 未启用 |
| R23 审计 | M | **已验收** | `common/audit.ts`、`modules/audit/routes.ts` | `order-flow.test.ts`、`notifications-dashboard.test.ts`（脱敏/只读） | 关键写操作 + 失败；管理员检索为 F 切片 |
| R24 重试与弱网 | M | **已验收** | `frontend/src/lib/api.ts`、`hooks.ts`、各表单 | `network-retry.spec.ts`（结果未知、草稿恢复、同键重试仅一单） | 持久待同步队列 F 未选做；本版本机草稿 |
| R25 可靠性 | M | **已验收** | `db/database.ts`、`common/idempotency.ts`、各 service | `inventory.test.ts`（两连接并发/同键并发）、`atomicity.test.ts`（中途失败回滚）、全部 44 测试 | 事务/约束/幂等/条件更新；测试见报告 |
| R26 环境交付 | M | **已验收** | `config.ts`、`migrate.ts`、`seed.ts`、`scripts/backup|restore` | 干净目录安装/迁移/构建/启动（日志）、备份恢复新实例核对 | 单机；无远程部署 |
| R27 AI 与文档 | M | **已验收** | PRD/README/AGENTS/CONSTRAINTS/docs/tasks/tests | 文档索引、追溯表、测试报告、AI 说明 | 与当前版本一致；未实现项如实标注 |

## 1.3 v1.3.0 F 切片

| 能力 | 状态 | 实现位置 | 证据 |
| --- | --- | --- | --- |
| 交期提醒（7 天/逾期，每日去重） | **已验收** | `notifications/reminders.ts` | `f-extensions.test.ts` |
| 附件 PNG/JPG 扩展 | **已验收** | `attachments/routes.ts`、`OrderPanels.tsx` | `f-extensions.test.ts`（PNG/伪装） |
| 库存台账 xlsx | **已验收** | `exports/routes.ts`、`InventoryPage.tsx` | `f-extensions.test.ts`（文件/鉴权） |

## 1.2 v1.2.0 用户追加增强（非原 M）

| 能力 | 状态 | 实现位置 | 证据 |
| --- | --- | --- | --- |
| 附件上限 20MB | **已验收** | `config.ts`、`OrderPanels.tsx` | 浏览器 6MB PDF 上传；原附件测试 |
| 多部门并行生产 | **已验收** | `production/routes.ts`、订单详情生产卡、`ProductionModal` | `order-ops.test.ts`；多部门截图 |
| 生产反馈完成即进历史 | **已验收** | 生产队列/历史查询、`ProductionPage.tsx` | 浏览器反馈历史截图 |
| 客户税号/地址选填 | **已验收** | `master/routes.ts`、`MasterDataPage.tsx`、迁移 003 | `order-ops.test.ts` |
| 12h 管理员撤销 | **已验收** | `orders/routes.ts`、`CancelOrderModal` | `order-ops.test.ts`；撤销截图 |
| 批量确认发货 | **已验收** | `orders/batch/confirm-shipment`、订单列表 | `order-ops.test.ts`；批量截图 |
| 部门管理入口 | **已验收** | `MasterDataPage.tsx` 部门页签 | 浏览器验证 |

## 1.1 v1.1.0 协作增强（非 R 编号）

| 能力 | 状态 | 实现位置 | 证据 |
| --- | --- | --- | --- |
| 退出登录二次确认 | **已验收** | `frontend/src/app/AppShell.tsx` | 浏览器：取消保持登录、确认后跳转登录 |
| “确认发货”文案统一 | **已验收** | 订单详情、包装/发货区、物流队列 | 浏览器截图 |
| 物流/品控/包装历史记录 | **已验收** | `shipping/routes.ts`、`qc/routes.ts`、`packing/routes.ts` 与页面页签 | `order-flow.test.ts`、物流历史截图 |
| 现场与管理员内部消息 | **已验收** | `modules/messages/routes.ts`、`pages/MessagesPage.tsx`、`002_internal_messages.sql` | `messages.test.ts`、消息截图 |
| 完整到货任务离开待办 | **已验收** | 物流队列 SQL 增加累计到货 < 采购量 | `order-flow.test.ts`、实际订单历史截图 |
| 基础数据字段名按实体区分 | **已验收** | `MasterDataPage.tsx` | 浏览器：客户名称/供应商名称/配件名称 |

## 2. F 选做与状态

本版按用户追加要求完成了少量低风险 F 切片（R07 多部门、R17 图片、R19 库存导出、R20 交期提醒），其余明确未选做；未把 F 计入 M 完成度。

| 需求 | 是否选做 | 状态 | 已实现切片/边界 | 证据 |
| --- | --- | --- | --- | --- |
| R01 F 账户生命周期 | 部分 | **切片已验收** | 停用账号/重置密码撤销旧会话；角色变更、受控设备、管理员账户管理未做 | `master-session.test.ts` |
| R07 F 多部门/分批反馈 | 部分 | **切片已验收** | 多任务/多部门并行、逐任务反馈与质检；部门任意顺序回流、超量授权未做 | `order-ops.test.ts` |
| R09 F 部分合格/返工/报废 | 否 | 未选做 | UI 与 API 明确拒绝 REWORK/SCRAP；只支持全合格 | `order-flow.test.ts` |
| R12 F 10 分钟撤销 | 否 | 未选做 | 五个入口统一 409，不删除记录；仅额外实现 12h 待采购撤销 | `auth.test.ts`、`order-ops.test.ts` |
| R17 F 多类型/多层级/软删除 | 部分 | **切片已验收** | 订单级 PDF/PNG/JPG、20MB；多层级、软删除/清理未做 | `f-extensions.test.ts` |
| R19 F 多报表/历史 | 部分 | **切片已验收** | 订单 + 库存 xlsx；采购/生产/质检/发货报表、完整导出历史未做 | `f-extensions.test.ts` |
| R20 F 分类/交期提醒 | 部分 | **切片已验收** | 全部已读、7 天/逾期交期提醒每日去重；分类筛选未做 | `f-extensions.test.ts` |
| R21 F 高级筛选/指标 | 否 | 未选做 | 仅 M 的状态/生产/利润/临期/库存汇总 | 看板截图 |
| R23 F 审计管理增强 | 部分 | **切片已验收** | 管理员按资源/结果/关键词检索与前后值；完整审计管理未做 | `notifications-dashboard.test.ts` |
| R02/R03/R04/R05/R06/R07/R08/R10/R11/R13/R14/R15/R16/R18/R22/R24/R25/R26/R27 的 F | 否 | 未选做 | 多产品、多批次、电镀、部门流转、超产、多供应商、自动提醒、导入、持久队列等均未实现 | 不提供入口，避免空壳 |

## 3. 未执行/未验收清单

| 项 | 原因 | 现状 |
| --- | --- | --- |
| A05/A08/A09/A11/A13/A16/A17/A21/A25 等 F 场景 | 未选做对应 F | 不要求执行；未实现入口 |
| 多用户高并发压测 | 无生产规模数据；SQLite 单写者 | 不宣称指标；仅两连接并发正确性测试 |
| 远程 HTTPS/部署 | 本机交付 | README 明确本地验收；生产需另行配置 |
| 定时交期提醒/补执行 | F 未选做 | 无任务调度入口 |
| 跨浏览器矩阵 | 只验证 Edge/Chromium | 响应式在 1440/1024/390 检查；其他浏览器未宣称 |

## 4. 结论

- R01-R27 中 24 项 M **已验收**；R06、R18 按范围表 **不适用**；R12 为 M 边界并增加用户要求的 12h 待采购撤销；v1.1/v1.2/v1.3 的协作与扩展单列，不冒充原 M 范围。
- F 只有 R01/R07/R17/R19/R20/R23 的明确切片，其余未选做；未把 F 计入 M 完成度。
- 失败与修复历史保留在测试报告；没有删测试、放宽断言或关闭类型检查。
