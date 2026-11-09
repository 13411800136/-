# 权限与字段可见性

版本：v1.3.0 / 2026-11-09

权限由**后端**执行：路由角色守卫 + 服务层对象/部门校验 + 输出字段裁剪 + 文件鉴权。前端 `ProtectedRoute` 与隐藏按钮只是交互辅助，不能作为授权依据。

## 1. 角色与资源矩阵

| 动作/资源 | ADMIN | LOGISTICS | PRODUCTION | QC | PACKING |
| --- | --- | --- | --- | --- | --- |
| 订单列表/详情/利润/审计/库存管理 | 全部 | 否 | 否 | 否 | 否 |
| 客户/供应商/配件/部门/员工维护 | 是 | 否 | 否 | 否 | 否 |
| 建单/采购/下发/质检处置/触发送货 | 是 | 否 | 否 | 否 | 否 |
| 到货登记 | 查看/受控修正（本版无修正入口） | 是 | 否 | 否 | 否 |
| 发货登记 | 查看 | 是 | 否 | 否 | 否 |
| 生产任务查看 | 全部 | 否 | 仅本部门 | 否 | 否 |
| 生产反馈 | 否（只下发） | 否 | 仅本部门 | 否 | 否 |
| 质检录入 | 查看/下发 | 否 | 否 | 是 | 否 |
| 包装录入 | 查看/下发 | 否 | 否 | 否 | 是 |
| 单价（销售/采购/利润） | 全部 | 无 | 仅 `priceVisible=1` 的该任务工艺价 | 无 | 无 |
| 附件上传/下载 | 是 | 否 | 否 | 否 | 否 |
| 订单 xlsx 导出 | 是 | 否 | 否 | 否 | 否 |
| 通知读取/已读 | 仅自己的 | — | — | — | — |
| 异常上报 | 否（查看/处理） | 自己职责 | 自己部门任务 | 自己职责 | 自己职责 |
| 内部消息 | 可发给所有启用账号；可收所有角色消息 | 可发给管理员/其他角色 | 可发给管理员/其他角色 | 可发给管理员/其他角色 | 可发给管理员/其他角色 |
| 撤销订单 | 仅 ADMIN；待采购且创建≤12h；已采购/超时拒绝 | 否 | 否 | 否 | 否 |
| 批量确认发货 | 仅 ADMIN；PACKING 且包装足量 | 否 | 否 | 否 | 否 |
| 部门管理 | 仅 ADMIN 可新增 | 否 | 否 | 否 | 否 |
| 审计检索 | 是（只读） | 否 | 否 | 否 | 否 |
| 修改/删除审计 | 否（409） | 否 | 否 | 否 | 否 |

`ADMIN` 的“高权限管理员/普通管理员”区分属于 F 账户管理，本版只有一个管理员角色。`is_super_admin` 字段已保留，但当前不用于区分能力。

## 2. 对象级校验

| 资源 | 规则 | 实现位置 |
| --- | --- | --- |
| 生产任务 | `production_orders.department_id = auth.user.department_id`；跨部门返回 404（不暴露资源存在） | `production/routes.ts` |
| 生产指派人员 | 必须是启用中的 PRODUCTION，且属于目标部门 | 下发生产 |
| 到货 | 只有 LOGISTICS；采购项必须属于当前订单 | `purchases/routes.ts` |
| 质检 | 只有 QC；订单必须 PENDING_QC；任务存在 | `qc/routes.ts` |
| 包装 | 只有 PACKING；订单必须 PACKING；数量≤放行剩余 | `packing/routes.ts` |
| 发货 | 只有 LOGISTICS；订单必须 SHIPPING；数量≤可发货 | `shipping/routes.ts` |
| 异常 | 现场角色只能关联职责范围内订单；PRODUCTION 校验部门任务 | `exceptions/routes.ts` |
| 通知 | 只能读/标记 `recipient_id = 自己` 的通知 | `notifications/routes.ts` |
| 内部消息 | 只能读/标记 `recipient_id = 自己` 的消息；发送人只能看自己的已发送；关联订单必须属于职责范围 | `messages/routes.ts` |
| 订单撤销 | 仅 ADMIN；服务端校验 `cancelled_at IS NULL`、`status=PENDING_PURCHASE`、无采购/生产、创建≤12h；原因必填 | `orders/routes.ts` |
| 批量确认发货 | 仅 ADMIN；逐单校验 PACKING、包装量≥订单量；任一失败整批不执行 | `orders/routes.ts` |
| 库存导出 | 仅 ADMIN；xlsx 文件 | `exports/routes.ts` |
| 附件 | 管理员；订单必须存在；下载按附件 ID + 存储键，不暴露本地路径 | `attachments/routes.ts` |
| 订单导出 | 管理员；筛选条件由服务端重新执行 | `exports/routes.ts` |
| 库存 | 管理员；来源订单若提供必须存在 | `inventory/routes.ts` |

## 3. 字段级裁剪

| 响应 | 现场角色可见 | 不可见 |
| --- | --- | --- |
| `/tablet/production/my-tasks` | 订单号、产品、规格、数量、工艺、交期、完成量、部门、任务 ID | 销售价、采购价、利润；工艺单价仅 `priceVisible=1` 时可见 |
| `/tablet/logistics/queue` | 订单号、产品、采购/到货/包装/发货数量、交期 | 任何单价、金额、客户联系方式、利润 |
| `/tablet/qc/queue` | 订单号、产品、规格、任务数量、完成量、工艺、部门、交期 | 价格、成本、客户联系方式 |
| `/tablet/packing/queue` | 订单号、产品、规格、应交/放行/已包/剩余、交期 | 价格、成本、利润 |
| 通知 | 标题、正文、资源 ID、事件类型 | 其他接收人通知 |
| 错误 | 统一错误码/中文说明/必要 details | SQL、堆栈、文件路径、令牌、账号存在性 |

实现方式：每个对外序列化器显式选择字段；生产任务用 `includePrice = row.price_visible === 1 && actor.role === 'PRODUCTION'`，管理员另行返回价格。不是递归删除字段名。

## 4. 认证与会话

- 登录：用户名 + 密码；`scrypt` 与 `timingSafeEqual`；错误统一“用户名或密码不正确”。
- 会话：随机 32 字节 token，数据库只存 `sha256(token|pepper)`；HttpOnly + SameSite=Lax Cookie；默认 12h。
- 失效：过期、登出撤销、账号 `active=0`、`session_version` 不匹配 → 401。
- 停用/改密：递增 `session_version` 并撤销全部会话；旧 Cookie 下一次受保护请求失效。
- 写请求（Cookie 认证）：校验 `Origin` 在 `APP_ORIGIN`；Bearer 用于脚本/测试，避免浏览器 CSRF 面。
- 登录限流：同一用户名+IP 10 分钟内 5 次失败 → 429（进程内 Map；重启清零，已知限制）。

## 5. 文件权限

- 上传：仅 ADMIN；PDF/PNG/JPG；扩展名、MIME、文件头三者一致；≤20MB。
- 存储：随机 UUID 文件名，目录由配置指定；数据库存原始名与存储键；拒绝路径穿越。
- 下载：仅 ADMIN；按数据库存储键读取；`Content-Disposition` 使用安全文件名；缺失返回 404。
- 失败：元数据写入失败删除物理文件；上传失败不影响已有订单；重复上传会生成新元数据（附件不做幂等去重，已知限制）。

## 6. 权限测试证据

| 场景 | 预期 | 证据 |
| --- | --- | --- |
| 无凭证/伪造 x-role 写库存 | 401，无流水 | `tests/integration/auth.test.ts` |
| 物流访问库存/订单管理 | 403 | 同上 |
| 生产访问管理员订单 | 403 | 同上 |
| PROD-B 反馈 PROD-A 任务 | 404，数量不变 | `order-flow.test.ts` |
| 现场角色导出/下载附件 | 403 | `export-attachment.test.ts` |
| 管理员删除审计/异常处置 | 409 | `notifications-dashboard.test.ts` |
| 生产单价开关前后 | 关闭无 `unitPrice`，开启后 `1.20` | `order-flow.test.ts` |
| 修改订单状态/删除订单 | 409，无修改 | `auth.test.ts` |

浏览器侧用管理员与五个现场账号实际切换验证，见 [E2E 截图](../tests/evidence/e2e/) 与 [测试记录](../tests/reports/2026-11-03-acceptance.md)。
