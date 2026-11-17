# 状态、数量与金额口径

版本：v1.4.0 / 2026-11-09
关联：[PRD](../PRD-factory.md) · [API 合同](api-contract.md) · [数据字典](data-dictionary.md)

## 1. 订单主状态

| 状态 | 合法下一状态 | 触发动作 | 必要条件/守卫 |
| --- | --- | --- | --- |
| `PENDING_PURCHASE` 待采购 | `PURCHASING` | 建立采购单 | 客户启用；一单一采购单；供应商/配件启用 |
| `PURCHASING` 采购中 | `IN_PRODUCTION` | 下发生产 | 采购全部到货（累计=采购量）；任务数量可拆分，累计分配≤订单量；部门/人员有效 |
| `PENDING_PURCHASE` 待采购 | `CANCELLED`（派生） | 管理员 12h 内撤销 | 无采购单；创建时间≤12h；原因必填；`cancelled_at` 留痕 |
| `IN_PRODUCTION` 生产中 | `IN_PRODUCTION` | 新增生产任务 | 任务累计分配仍小于订单量；部门有效 |
| `IN_PRODUCTION` 生产中 | `PENDING_QC` | 下发质检 | 全部任务反馈完成；任务总量覆盖订单量 |
| `PENDING_QC` 待质检 | `QC_DONE` | 管理员处置 | 所有记录已处置；合格量累计 ≥ 应交量 |
| `PENDING_QC` 待质检 | `IN_PRODUCTION` | 处置 REWORK / SCRAP | 记录不合格数 > 0；退回补产 |
| `QC_DONE` 质检已放行 | `PACKING` | 下发包装 | 放行量 > 已包装量 |
| `PACKING` 包装中 | `SHIPPING` | 管理员确认发货 | 已包装量 ≥ 订单应交数量 |
| `SHIPPING` 待发货 | `COMPLETED` | 物流发货 | 本次数量 ≤ min(已包装−已发, 应交−已发)；累计=应交 |
| `COMPLETED` 已完成 | 无正常下一态 | — | 正常新增动作拒绝；撤销 F 未启用 |

M 没有 `PARTIAL_ARRIVED`、返工回流、混合批次等 F 状态。状态是摘要，具体动作以 `/orders/:id/operation-summary` 的 `allowedActions` 和数量为准；前端不根据中文文案推断。

## 2. 数量来源与公式

| 数量 | 来源 | 公式/说明 |
| --- | --- | --- |
| 订单应交 `ordered` | `order_items.quantity` | 单明细 |
| 采购量 `purchased` | `purchase_items.quantity` | 可与订单量不同；PRD 说明物料计划依据 |
| 到货量 `arrived` | `SUM(arrival_records.quantity)` | 累计不得超过 `purchased` |
| 任务量 `taskQuantity` | `production_orders.quantity` | M 必须等于 `ordered` |
| 完成量 `produced` | `SUM(production_feedbacks.quantity)` | 累计不得超过任务量 |
| 检验量 `inspected` | `qc_records.inspected_qty` | M 必须等于 `produced` |
| 合格量 `qualified` | `qc_records.qualified_qty` | 合格 + 不合格 = 检验量 |
| 放行量 `released` | 已处置记录（PASS/REWORK/SCRAP）的 `qualified_qty` 之和 | 判定不合格只作废不合格部分，不吞掉已合格数量 |
| 已包装 `packed` | `SUM(packing_records.quantity)` | 不得超过 `released` 与 `ordered` |
| 已发货 `shipped` | `SUM(shipment_records.quantity)` | 不得超过已包装与应交 |

### 可包装/可发货

```text
可包装剩余 = 已放行合格量 − 已包装累计量
可发货剩余 = min(已包装累计量 − 已发货累计量, 订单应交量 − 已发货累计量)
```

- 包装：`0 < 本次包装 ≤ 可包装剩余`；M 单产品。
- 发货：`0 < 本次发货 ≤ 可发货剩余`；足量（累计=应交）才置 `COMPLETED`。
- 已完成订单正常新增包装/发货拒绝；不通过“改一条数量”破坏账目。

## 3. 动作守卫矩阵

| 动作 | 角色 | 前置 | 成功变化 | 拒绝 |
| --- | --- | --- | --- | --- |
| 建单 | ADMIN | 客户启用；单明细；数量>0；单价≥0；交期≥今天 | 订单 + 明细；PENDING_PURCHASE | 400 |
| 建采购 | ADMIN | PENDING/PURCHASING；无采购单；供应商/配件启用 | PO + 明细；PURCHASING | 409/400 |
| 到货 | LOGISTICS | 订单 PURCHASING；累计+本次≤采购量 | 到货记录；通知 | 403/409 |
| 下发/新增生产 | ADMIN | 到齐；可多任务，累计≤订单量；部门类别 PRODUCTION；人员同部门 | 任务；IN_PRODUCTION | 409/400 |
| 生产反馈 | PRODUCTION | 本部门；IN_PRODUCTION；累计+本次≤任务量 | 反馈；通知 | 404/409 |
| 下发质检 | ADMIN | IN_PRODUCTION；全部任务完成且总量覆盖订单；无 QC | PENDING_QC | 409 |
| 质检录入 | QC | PENDING_QC；逐任务全检；合格+不合格=检验量；≤完成量 | QC 记录；不合格时通知管理员 | 409 |
| 质检处置 | ADMIN | QC 未决策；PASS 仅限无不合格；REWORK/SCRAP 需有不合格 | PASS→QC_DONE；REWORK/SCRAP→IN_PRODUCTION | 409 |
| 下发包装 | ADMIN | QC_DONE；放行>已包装 | PACKING | 409 |
| 包装 | PACKING | PACKING；≤可包装 | 包装记录；通知 | 409 |
| 确认发货 | ADMIN | PACKING；已包装≥应交 | SHIPPING | 409 |
| 发货 | LOGISTICS | SHIPPING；≤可发货 | 发货记录；足量 COMPLETED | 409 |

## 4. 幂等与并发

- 每次业务意图由前端生成稳定随机键；网络失败/结果未知时复用，不生成新键。
- 作用域 `actor + operation + key`；请求摘要绑定资源与业务字段。同键同体返回原结果，同键异体 409。
- 库存：写事务内条件更新 `quantity = quantity + ? WHERE quantity + ? >= 0`，检查 changes；首次创建靠 UNIQUE + 重读。
- 到货/反馈/包装/发货：在 `BEGIN IMMEDIATE` 事务内重新读取累计，再写本次记录。
- 两路 -7 从 10 并发：只一次成功，最终 3；两路首次 +1：一个身份，最终 2、两笔流水（自动化测试）。

## 5. 金额

```text
销售额   = Σ(订单数量 × 销售单价)
采购成本 = Σ(采购数量 × 采购单价)
电镀成本 = 0（M 不启用）
生产成本 = Σ(有效生产反馈数量 × 工艺单价)
利润     = 销售额 − 采购成本 − 电镀成本 − 生产成本
毛利率   = 销售额 = 0 ? 0.00 : round(利润 / 销售额 × 100, 2)
```

- 数据库存整数分；示例：100×12.50=125000，120×2.10=25200，100×1.20=12000，利润 87800（878.00），毛利率 70.24%。
- 每笔明细乘积按分计算后汇总；不使用二进制浮点。
- 允许负利润，不静默归零；销售额为 0 时毛利率显示 0.00。
- 这是**订单快照预计利润**，不是回款、现金流或财务结算；不包含报废损失、返工额外工费、税、运费等。

## 6. 日期与时区

- 业务时区固定 `Asia/Shanghai`（UTC+08:00）。
- 交期 `due_date` 是日期语义，不是时间点；校验真实日历日期，不早于北京时间今天。
- 事件 `created_at` 存 UTC ISO8601；页面按北京时间展示。
- 看板“临期”从今天到第 7 天按北京时间自然日计算；完成订单不再临期。
- 备份 manifest、测试记录写明执行时间与时区。

## 7. 状态投影（9 阶段）

| key | 标签 | 完成条件 | 备注 |
| --- | --- | --- | --- |
| ORDER | 建单 | 订单存在 | 事件 ORDER_CREATED |
| PURCHASE | 采购 | 采购单存在 | PURCHASE_CREATED |
| ARRIVAL | 到货 | 到货累计=采购量 | ARRIVAL_RECORDED |
| PLATING | 电镀 | — | M 固定 NOT_APPLICABLE，不伪造事件 |
| PRODUCTION | 生产 | 反馈累计=任务量 | PRODUCTION_FEEDBACK |
| QC | 质检 | 管理员 PASS | QC_PASSED |
| PACKING | 包装 | 包装累计=应交 | PACKING_RECORDED |
| SHIPPING | 发货 | 发货累计=应交 | SHIPMENT_RECORDED |
| COMPLETED | 完成 | 状态 COMPLETED | ORDER_COMPLETED |

时间线只显示实际发生的事件；不是前端点亮的流程图。v1.2 的撤销仅管理员对 12h 内待采购订单执行，写入 `ORDER_CANCELLED`；其他撤销/删除入口仍不启用。

## 8. 拒绝示例（可复现）

| 场景 | 结果 |
| --- | --- |
| 到货 120 后再到货 1（采购 120） | 409 `QUANTITY_EXCEEDED`，累计仍 120 |
| 生产任务 100，反馈 99 后再反馈 2 | 409，累计仍 99 |
| 质检 100 件录 99 合格 + 2 不合格 | 400（数量不守恒）或 409（部分合格 F 未启用） |
| 未 PASS 就让包装录入 | 409 `INVALID_STATE` |
| 放行 100、已包 100，再包 1 | 409，累计仍 100 |
| 已发 60/100，再发 41 | 409，累计仍 60 |
| 两个 -7 从 10 并发 | 一个 200、一个 409，最终 3 |
| 同键到货 120 重试 | 返回原记录，累计仍 120 |
| 同键改成 119 | 409 `IDEMPOTENCY_CONFLICT` |

## 撤回与删除（v1.7.0）

- 撤回：进行中订单（非已完成/已撤销）由管理员撤回，原因必填；写 `withdrawn_at`、`withdraw_reason`，并置 `cancelled_at`。
- 删除：仅已撤销/已撤回或已完成订单可删除；写 `deleted_at`，列表、看板、流水、归档查询均隐藏，详情返回 404；审计与时间线保留。
