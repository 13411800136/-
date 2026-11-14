# API 合同：厂序 FactoryFlow

版本：v1.3.1（2026-11-09）
前缀：`/api/v1`；Content-Type：`application/json`（附件上传为 multipart，导出为 xlsx）。
成功：`{ "data": ..., "requestId": "..." }`；失败：`{ "error": { "code": "...", "message": "...", "details": ... }, "requestId": "..." }`。

认证：HttpOnly Cookie `fx_session`（浏览器）或 `Authorization: Bearer <token>`（脚本；登录不返回 token，需从 Cookie 取）。写操作若用 Cookie，校验 `Origin`。

## 1. 通用约定

| 项 | 约定 |
| --- | --- |
| 角色 | `ADMIN`、`LOGISTICS`、`PRODUCTION`、`QC`、`PACKING` |
| 幂等 | 关键写操作要求 `Idempotency-Key: 8-128 位 [A-Za-z0-9_-]`；同键同体返回原结果，同键异体 409 |
| 分页 | `page` 从 1 起，`pageSize` 1-100；稳定排序 `created_at DESC, id DESC` |
| 日期 | `dueDate` 为 `YYYY-MM-DD`（北京时间日期语义）；事件为 ISO8601 UTC |
| 金额 | 输入 `unitPrice` 为字符串/数字，最多两位小数；输出 `unitPrice`/`amount` 为两位小数字符串；数据库整数分 |
| 数量 | 正整数（`1..1,000,000`） |
| 空列表 | `items: []`，不返回样例数据 |
| 错误码 | `VALIDATION_ERROR(400)`、`UNAUTHENTICATED(401)`、`FORBIDDEN(403)`、`NOT_FOUND(404)`、`CONFLICT(409)`、`STOCK_INSUFFICIENT(409)`、`INVALID_STATE(409)`、`QUANTITY_EXCEEDED(409)`、`FEATURE_NOT_ENABLED(409)`、`FILE_TOO_LARGE(413)`、`UNSUPPORTED_FILE_TYPE(415)`、`RATE_LIMITED(429)`、`INTERNAL_ERROR(500)` |
| requestId | 服务端生成 UUID，响应头 `X-Request-Id`，审计可关联 |

## 2. 端点清单

### 2.1 会话与账户

| 方法/路径 | 角色 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `POST /auth/login` | 公开 | 用户名/密码登录；设置 Cookie；限流 5 次/10 分钟 | — |
| `GET /auth/me` | 已认证 | 当前主体、角色、部门 | — |
| `POST /auth/logout` | 已认证 | 撤销当前会话 | — |
| `GET /auth/demo-accounts` | 公开（仅 DEMO_MODE） | 合成演示账号；生产返回 404 | — |
| `GET /auth/password-policy` | 公开 | 返回密码长度与哈希算法说明 | — |
| `GET /users` | ADMIN | 员工账号列表（可按 `role`/`search`） | — |
| `POST /users` | ADMIN | 新增员工账号（用户名、姓名、角色、部门、初始密码） | — |
| `PATCH /users/:id` | ADMIN | 修改姓名/部门/启停/重置密码；停用或改密撤销旧会话 | — |

### 2.2 基础数据

| 方法/路径 | 角色 | 说明 |
| --- | --- | --- |
| `GET/POST /customers`、`PATCH /customers/:id` | ADMIN | 客户；编码唯一；停用不删除 |
| `GET/POST /suppliers`、`PATCH /suppliers/:id` | ADMIN | 供应商 |
| `GET/POST /parts`、`PATCH /parts/:id` | ADMIN | 配件（名称、规格、单位） |
| `GET/POST /departments` | ADMIN | 部门列表/新增（类别 PRODUCTION/LOGISTICS/QC/PACKING） |

### 2.3 订单

| 方法/路径 | 角色 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `GET /orders` | ADMIN | 列表；`status`、`keyword`、分页 | — |
| `POST /orders` | ADMIN | 建单（单明细）；订单号后端生成 | 必需 |
| `GET /orders/:id` | ADMIN | 详情 + summary + profit + stages | — |
| `GET /orders/:id/timeline` | ADMIN | 时间线事件 | — |
| `GET /orders/:id/profit` | ADMIN | 利润 | — |
| `GET /orders/:id/operation-summary` | ADMIN | 数量与 allowedActions | — |
| `GET /order-statuses` | ADMIN | 状态枚举与中文 | — |
| `PATCH /orders/:id/status` | ADMIN | **明确拒绝** 409，防止绕过动作 | — |
| `DELETE /orders/:id` | ADMIN | **明确拒绝** 409 | — |

### 2.4 采购、到货、生产

| 方法/路径 | 角色 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `POST /orders/:id/purchase-orders` | ADMIN | 一单一采购单、单配件 | 必需 |
| `GET /purchase-orders/:id` | ADMIN | 采购单 + 明细 + 到货 | — |
| `GET /orders/:id/arrivals` | ADMIN | 该订单到货汇总 | — |
| `POST /purchase-items/:id/arrivals` | LOGISTICS | 登记本次到货；累计≤采购量 | 必需 |
| `POST /orders/:id/production-orders` | ADMIN | 下发生产任务；到齐后可拆多部门；累计分配≤订单量 | 必需 |
| `POST /orders/batch/confirm-shipment` | ADMIN | 批量确认包装足量订单发货；1-50 张；整批校验 | 必需 |
| `POST /orders/:id/cancel` | ADMIN | 12h 内撤销待采购订单；原因必填 | 必需 |
| `GET /production-orders/:id` | ADMIN | 任务详情与反馈 | — |
| `PATCH /production-orders/:id/price-visibility` | ADMIN | 单价开关 | 必需 |
| `GET /tablet/production/my-tasks` | PRODUCTION | 本部门进行中任务；价格裁剪 | — |
| `GET /tablet/production/history` | PRODUCTION | 本部门历史任务 | — |
| `POST /production-orders/:id/feedbacks` | PRODUCTION | 本部门反馈；累计≤任务量 | 必需 |
| `GET /orders/:id/production` | ADMIN | 生产任务汇总 | — |
| `GET /tablet/logistics/history` | LOGISTICS | 到货/发货历史（最近 100 条） | — |
| `GET /tablet/qc/history` | QC | 质检录入/处置历史（最近 100 条） | — |
| `GET /tablet/packing/history` | PACKING | 包装历史（最近 100 条） | — |

### 2.5 质检、包装、发货

| 方法/路径 | 角色 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `POST /orders/:id/dispatch-qc` | ADMIN | 生产全部完成后下发质检 | 必需 |
| `GET /tablet/qc/queue` | QC | 待录入质检任务 | — |
| `POST /production-orders/:id/qc-records` | QC | 一次全检全合格 | 必需 |
| `POST /qc-records/:id/decision` | ADMIN | 仅 PASS；REWORK/SCRAP 409 | 必需 |
| `GET /orders/:id/qc` | ADMIN | 质检记录 | — |
| `POST /orders/:id/dispatch-packing` | ADMIN | 放行后可下发 | 必需 |
| `GET /tablet/packing/queue` | PACKING | 可包装任务 | — |
| `POST /orders/:id/packing-records` | PACKING | 数量≤可包装剩余 | 必需 |
| `GET /orders/:id/packing-summary` | ADMIN | 放行/包装/发货汇总 | — |
| `POST /orders/:id/trigger-shipment` | ADMIN | 包装达到应交量后触发 | 必需 |
| `GET /tablet/logistics/queue` | LOGISTICS | 到货/发货队列；无价格 | — |
| `POST /orders/:id/shipments` | LOGISTICS | 数量≤可发/应交剩余；足量完成 | 必需 |
| `GET /orders/:id/shipping-summary` | ADMIN | 发货汇总 | — |

### 2.6 撤销/删除边界

| 方法/路径 | 角色 | 结果 |
| --- | --- | --- |
| `POST /arrival-records/:id/cancel` | 已认证 | 409 `FEATURE_NOT_ENABLED`（F 未启用） |
| `POST /production-feedbacks/:id/cancel` | 已认证 | 409 |
| `POST /qc-records/:id/cancel` | 已认证 | 409 |
| `POST /packing-records/:id/cancel` | 已认证 | 409 |
| `POST /shipment-records/:id/cancel` | 已认证 | 409 |
| `DELETE /{上述资源}/:id` | 已认证 | 409，业务记录不允许删除 |

### 2.7 库存

| 方法/路径 | 角色 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `GET /inventory/parts?search=` | ADMIN | 配件及其现存量（无记录显示 0） | — |
| `GET /inventory/products?search=` | ADMIN | 成品库存 | — |
| `POST /inventory/parts/adjust` | ADMIN | `{partId,delta,reason,sourceOrderId?}`；非零整数 | 必需 |
| `POST /inventory/products/adjust` | ADMIN | `{productName,spec,delta,reason,sourceOrderId?}` | 必需 |
| `GET /inventory/parts/:id/logs` | ADMIN | `:id` 为配件 ID；流水 | — |
| `GET /inventory/products/:id/logs` | ADMIN | `:id` 为成品库存 ID；流水 | — |

### 2.8 附件、导出、通知、看板、异常、审计、健康

| 方法/路径 | 角色 | 说明 |
| --- | --- | --- |
| `POST /orders/:id/attachments` | ADMIN | multipart `file`；PDF/PNG/JPG ≤20MB；扩展名/MIME/魔数一致 |
| `GET /exports/inventory.xlsx` | ADMIN | 配件/成品两个工作表的库存台账 |
| `POST /departments` | ADMIN | 新增部门；名称、类别（PRODUCTION/LOGISTICS/QC/PACKING） |
| `PATCH /customers/:id` | ADMIN | 客户名称/联系方式/税号/地址；税号地址选填 |
| `GET /orders/:id/attachments` | ADMIN | 附件列表 |
| `GET /attachments/:id/download` | ADMIN | 鉴权下载，`Content-Disposition` |
| `GET /exports/orders.xlsx` | ADMIN | 按 `status`/`keyword` 导出真实数据 |
| `GET /exports/history` | ADMIN | 从审计读取导出记录（F 切片，不是完整导出历史） |
| `GET /notifications?unreadOnly=1` | ADMIN | 通知列表 + unreadCount |
| `GET /notifications/unread-count` | ADMIN | 未读数 |
| `POST /notifications/:id/read` | ADMIN | 只能操作自己的通知 |
| `POST /notifications/mark-all-read` | ADMIN | 全部已读（F 切片） |
| `GET /dashboard/summary` | ADMIN | 状态/生产/利润/临期/库存/最近订单 |
| `GET /dashboard/order-stats` | ADMIN | 状态计数 |
| `GET /dashboard/profit-stats` | ADMIN | 利润汇总 |
| `GET /dashboard/production-kanban` | ADMIN | 生产进度 |
| `GET /dashboard/due-soon` | ADMIN | 7 天内临期 |
| `GET /dashboard/inventory-overview` | ADMIN | 库存概览 |
| `POST /tablet/exceptions` | 现场角色 | 关联职责内订单上报异常 |
| `GET /tablet/exceptions` | 现场角色 | 自己的异常 |
| `GET /tablet/order-options` | 现场角色 | 可关联订单选项 |
| `GET /exceptions` | ADMIN | 全部异常 |
| `GET /exceptions/:id` | 上报人/ADMIN | 异常详情 |
| `PATCH /exceptions/:id` | ADMIN | 409（处理状态 F 未启用） |
| `GET /audit-logs` | ADMIN | 分页/资源/结果/关键词筛选 |
| `DELETE/PATCH /audit-logs/:id` | ADMIN | 409，审计不可改删 |
| `GET /messages/recipients` | 已认证 | 可联系的其他启用账号（排除自己） |
| `GET /messages/inbox` | 已认证 | 收件箱 + 未读数 |
| `GET /messages/sent` | 已认证 | 已发送消息 |
| `GET /messages/unread-count` | 已认证 | 未读消息数 |
| `POST /messages` | 已认证 | 发消息；`recipientId`、`body`、可选 `orderId`；需幂等键 |
| `POST /messages/:id/read` | 接收人 | 标记自己的消息已读 |
| `GET /health` | 公开 | 进程存活 |
| `GET /ready` | 公开 | 数据库查询就绪 |

## 3. 接口卡示例

### 3.1 建单

- 需求/场景：R03 / A04
- 方法路径：`POST /orders`
- 认证/角色：ADMIN；`Idempotency-Key` 必需
- 请求：

```json
{
  "customerId": "cust-uuid",
  "dueDate": "2026-11-17",
  "note": "交期约定（合成）",
  "item": {
    "partId": "part-uuid",
    "productName": "精密传动箱体",
    "spec": "TB-220 / 阳极氧化",
    "quantity": 100,
    "unitPrice": "12.50"
  }
}
```

- 成功 201：`{"data":{"id":"...","orderNo":"SO-20261103-0001","status":"PENDING_PURCHASE","statusLabel":"待采购"},"requestId":"..."}`
- 拒绝：客户不存在/停用 400；数量 0/-1/小数 400；交期早于今天 400；缺少幂等键 400；同键异体 409。
- 事务/表：`orders`、`order_items`、`order_timeline`、`audit_logs`、`idempotency_requests` 同事务。
- 重试：同键同体返回原订单（`Idempotent-Replayed: true`），不生成第二张。

### 3.2 到货登记

- 需求/场景：R05 / A07
- 方法路径：`POST /purchase-items/:id/arrivals`
- 角色：LOGISTICS
- 请求：`{"quantity":120,"note":"一次到齐"}`
- 成功 201：`{"data":{"id":"...","arrivedQty":120,"purchasedQty":120,"remainingQty":0,"fullyArrived":true}}`
- 拒绝：非物流 403；数量≤0 或非整数 400；累计超采购量 409 `QUANTITY_EXCEEDED`；同键异体 409。
- 事务/表：`arrival_records`、`order_timeline`、`notifications`、`audit_logs`、`idempotency_requests`。
- 通知：每个到货记录一条管理员通知，`dedupe_key=arrival:<id>:<adminId>`。

### 3.3 成品库存调整

- 需求/场景：R14/R25 / A18/A19/A20
- 方法路径：`POST /inventory/products/adjust`
- 角色：ADMIN；`Idempotency-Key` 必需
- 请求：`{"productName":"精密传动箱体","spec":"TB-220","delta":-7,"reason":"演示领用","sourceOrderId":null}`
- 成功 200：`{"data":{"inventoryId":"...","before":10,"delta":-7,"after":3,"logId":"...","productKey":"精密传动箱体|tb-220"}}`
- 首次创建：`delta` 必须 >0；不存在时负数 409；并发两次 +1 最终 2、两笔流水。
- 并发扣减：两个 -7 从 10 开始，只有一个成功，另一个 409 `STOCK_INSUFFICIENT`，最终 3。
- 表：`product_inventory`、`inventory_logs`、`audit_logs`、`idempotency_requests`。

### 3.4 发货登记

- 需求/场景：R11 / A15
- 方法路径：`POST /orders/:id/shipments`
- 角色：LOGISTICS
- 请求：`{"quantity":60,"carrier":"顺程物流（演示）","trackingNo":"DEMO-TRK-1"}`
- 成功 201：`{"data":{"id":"...","shippedQty":60,"orderedQty":100,"completed":false,"orderStatus":"SHIPPING"}}`
- 拒绝：管理员未确认发货 409；数量超 `min(已包装-已发, 应交-已发)` 409；已完成继续发 409。
- 足量时：订单置 `COMPLETED`，追加 `ORDER_COMPLETED` 时间线并通知管理员。

### 3.5 内部消息

- 场景：现场角色发现到货破损，联系管理员；管理员也可以联系现场。
- 方法路径：`POST /messages`
- 认证：任意启用角色；`Idempotency-Key` 必需
- 请求：`{"recipientId":"user-uuid","orderId":"order-uuid","body":"外箱有人为破损，请确认是否换货。"}`
- 成功 201：`{"data":{"id":"...","recipientName":"系统管理员"}}`
- 拒绝：接收人停用/不存在 400；给自己发 400；关联订单不在职责范围 404；重复键异体 409。
- 读取：`GET /messages/inbox`（返回未读数）、`GET /messages/sent`、`POST /messages/:id/read`（仅接收人）。
- 表：`internal_messages`、`audit_logs`、`idempotency_requests`；消息只追加，不提供删除。
- 交期提醒（F）：读取 `GET /notifications` 或 `GET /notifications/unread-count` 时补齐；7 天内/逾期、未完成/未撤销订单，每订单每天一条。

### 3.6 订单扩展操作（v1.2）

- 多部门生产：`POST /orders/:id/production-orders` 可多次调用；`quantity` 为本次拆分数量，累计不得超过订单应交量。订单在 `IN_PRODUCTION` 时仍可新增任务，但不能超过剩余可分配量。
- 撤销：`POST /orders/:id/cancel`，请求 `{"reason":"客户临时取消"}`。仅 ADMIN；仅 `PENDING_PURCHASE` 且无采购/生产；创建时间 ≤12 小时；写入 `cancelled_at/cancelled_by/cancel_reason`、`ORDER_CANCELLED` 时间线和审计。成功返回有效状态 `CANCELLED`；超时 `409` 且 `details.code=CANCEL_WINDOW_EXPIRED`。
- 批量确认发货：`POST /orders/batch/confirm-shipment`，请求 `{"orderIds":["..."]}`，1-50 张、去重。逐单校验 `PACKING` 且已包装量≥订单量；任一不满足整批 409，不部分执行。
- 客户税号/地址：`POST/PATCH /customers` 可选 `taxNo`、`address`；不传或空串不报错。

## 4. 前端状态与错误映射

| 情况 | 前端表现 | 是否可重试 |
| --- | --- | --- |
| 400 参数错误 | 字段/表单错误，保留输入 | 修改后新意图（新键） |
| 401 会话失效 | 跳转登录，提示重新登录 | 重新登录 |
| 403 越权 | 显示真实拒绝，不假装成功 | 否 |
| 404 资源不存在/无权 | 显示不存在或无权 | 否 |
| 409 数量/状态/幂等冲突 | 展示 `details` 中的剩余量/状态 | 同键同体重试；异体换键 |
| 413/415 文件 | 明确类型/大小 | 修改文件 |
| 网络中断/5xx | “结果未知”，保留草稿与幂等键 | 原键重试/刷新确认 |
| 2xx 成功 | 用服务端结果刷新，不做乐观加数 | — |

## 5. 合同与实现一致性

接口实现位于 `backend/src/modules/*/routes.ts`；前端调用位于 `frontend/src/lib/api.ts` 与各页面。修改路径/字段时必须同时更新本文件、`docs/state-and-quantity.md`、`docs/permissions.md` 和测试。当前版本已通过集成测试与浏览器闭环验证，见 [测试记录](../tests/reports/2026-11-03-acceptance.md)。
