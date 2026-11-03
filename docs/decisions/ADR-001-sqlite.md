# ADR-001：SQLite + 单进程部署

- 日期：2026-11-03
- 状态：已接受
- 关联：R13/R14/R25/R26；A18/A19/A20/A32/A33

## 背景

三至四周内需要从零交付真实认证、事务、幂等、库存并发、迁移与恢复。可用环境是 Windows 单机，没有 Docker/PostgreSQL；需要尽量减少外部依赖，让别人按 README 一次启动。

## 选项

1. PostgreSQL + Prisma/Fastify：事务/约束成熟，但需安装数据库、生成客户端、迁移引擎，环境失败风险高。
2. SQLite + better-sqlite3：成熟同步驱动，但要本地编译原生模块。
3. SQLite + Node 24 内置 `node:sqlite`：零原生依赖，支持事务、约束、WAL、`RETURNING`，与运行时同版本。
4. 浏览器 IndexedDB/localStorage：不满足“真实后端/数据库”和跨浏览器一致。

## 决定

选择 3：Node 24 + `node:sqlite`，单进程 Fastify 同时提供 API 与前端静态文件。

- 写事务 `BEGIN IMMEDIATE`，`busy_timeout=5000`，WAL。
- 库存用条件 UPDATE + 受影响行数；首次创建用 UNIQUE + 重读。
- 迁移用手写 SQL runner，记录 checksum。
- 备份用 `VACUUM INTO` + 附件复制 + manifest；恢复校验 integrity/行数/哈希。

## 后果

正面：零外部服务、Windows 可直接启动、事务/约束真实、迁移透明、测试可用临时文件数据库。

负面：SQLite 单写者，不适合多实例水平扩展；并发测试只能证明当前部署形态下的正确性，不能证明高吞吐；未来若多用户/多机，需要迁移 PostgreSQL 并重新验证隔离级别、锁、连接池和迁移。

## 验证

- 两连接并发 -7：一次成功，最终 3；首次 +1：一个身份、最终 2、两流水。
- 注入通知写入失败：到货/时间线/通知/审计/幂等全部回滚。
- 干净目录安装/迁移/构建/启动通过；备份恢复到新实例通过。

## 回退

如迁移 PostgreSQL：保留现有 API 合同与测试，替换数据访问层；先做双写/只读对比或一次性离线迁移，备份并演练恢复，不能直接用 Git 回退替代数据迁移。
