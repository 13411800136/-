# 文档索引

版本：v1.1.0 / 2026-11-09
本目录与仓库根文档共同构成当前版本的设计合同。历史/失效内容不得混入当前入口；如后续替代，在此标注“已替代”。

| 文档 | 回答什么问题 | 状态 |
| --- | --- | --- |
| [../README.md](../README.md) | 别人如何安装、启动、演示、排错、备份恢复 | 当前 |
| [../PRD-factory.md](../PRD-factory.md) | 为谁解决什么问题、范围、页面、规则、取舍、验收 | 当前 |
| [../AGENTS.md](../AGENTS.md) | AI/协作者先读什么、允许改什么、如何验证 | 当前 |
| [../CONSTRAINTS.md](../CONSTRAINTS.md) | 哪些质量底线不可降低、在哪里执行 | 当前 |
| [architecture.md](architecture.md) | 模块边界、请求路径、事务/幂等/并发、静态文件 | 当前 |
| [api-contract.md](api-contract.md) | 方法路径、认证、Schema、错误、幂等、事务、示例 | 当前 |
| [data-dictionary.md](data-dictionary.md) | 表、字段、类型、约束、索引、关系、敏感性 | 当前 |
| [state-and-quantity.md](state-and-quantity.md) | 状态迁移、数量公式、动作守卫、金额/日期语义 | 当前 |
| [permissions.md](permissions.md) | 角色/对象/字段/文件权限与测试证据 | 当前 |
| [feature-status.md](feature-status.md) | R01-R27 的 M/F 状态、实现位置、证据、限制 | 当前 |
| [operations.md](operations.md) | 配置、健康、日志、迁移、备份恢复、回退、排错 | 当前 |
| [traceability.csv](traceability.csv) | 需求→实现→接口→表→测试→结果 | 当前 |
| [ai-collaboration.md](ai-collaboration.md) | AI 输入、判断、修改、失败与复测，本人贡献 | 当前 |
| [decisions/ADR-001-sqlite.md](decisions/ADR-001-sqlite.md) | 为什么 SQLite + 单进程 | 已接受 |
| [decisions/ADR-002-session-auth.md](decisions/ADR-002-session-auth.md) | 为什么 opaque session + scrypt | 已接受 |
| [decisions/ADR-003-scope.md](decisions/ADR-003-scope.md) | 为什么选这些 M 简化、不做哪些 F | 已接受 |
| [../tasks/plan.md](../tasks/plan.md) | 三至四周如何排期、依赖、风险、里程碑 | 当前 |
| [../tasks/todo.md](../tasks/todo.md) | 可执行任务、验收标准、实际结果 | 当前 |
| [../tasks/progress.md](../tasks/progress.md) | 当前摘要、阻塞、下一步 | 当前 |
| [../tests/README.md](../tests/README.md) | 测试入口、隔离、证据、未执行项 | 当前 |
| [../tests/reports/2026-11-03-acceptance.md](../tests/reports/2026-11-03-acceptance.md) | 实际命令、结果、失败修复、A01-A35 对照 | 当前 |

文档维护规则：

- 改接口/表/状态/权限时，同步更新对应合同与测试；不能只改代码。
- “已实现”不等于“已验收”；证据只认当前版本实际执行。
- 历史失败记录追加保留，不覆盖；被替代的设计放 `archive/` 并标明原因（本版暂无）。
- 路径、命令、端口必须与 README 和源码一致；不能写不存在的脚本。
