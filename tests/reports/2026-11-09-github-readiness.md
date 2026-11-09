# GitHub 上传准备检查记录

- 版本：`v1.3.0`
- 执行日期：2026-11-09（Asia/Shanghai）
- 环境：Windows 11、Node.js `v24.20.0`、npm `11.x`
- 目的：确认当前仓库可作为干净源码上传 GitHub，而不是只验证本机 `node_modules`/运行库。

## 1. 仓库卫生

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `git status --short` | 上传准备文件之外无未提交内容 | 提交后应为空 |
| `git ls-files` 检查运行目录 | 通过 | 未跟踪 `data/`、`backups/`、`uploads/`、`node_modules/`、`.env`、`.auth-secret` |
| 本机绝对路径 | 通过 | 已把 `tests/reports/clean-room-*.log` 转 UTF-8 并替换为 `<workspace>` |
| 演示凭据 | 明确标注 | `Demo@2026` 只用于本机合成演示，生产必须关闭 `DEMO_MODE` |
| 许可证 | 未声明项目许可 | 根目录没有 `LICENSE`；公开前由作者决定，第三方声明见 `THIRD-PARTY-NOTICES.md` |
| CI | 已添加 | `.github/workflows/ci.yml`：Node 24，`npm ci` + 类型检查 + 44 测试 + 构建 |

## 2. 本机验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（backend + frontend） |
| `npm run test` | **44/44 通过** |
| `npm run build` | 通过（backend tsc + frontend Vite） |
| `npx playwright test` | **2/2 通过**（完整闭环 + 响应丢失重试） |

## 3. 干净目录验证（v1.3.0）

在独立目录复制源码（不含 `node_modules`、`data`、`backups`、`dist`、`.git`）后执行：

```text
npm ci                  → 397 packages installed
npm run setup           → 应用 3 个迁移：001、002、003；合成数据就绪
npm run build           → backend/frontend 构建成功
PORT=8899 node backend/dist/server.js
```

验证结果：

- `GET /api/v1/health` → `200`
- `POST /api/v1/auth/login`（admin / 演示密码）→ `200`
- `GET /api/v1/auth/me` → `200`，返回管理员合成身份
- 初始化数据库含 4 张演示订单、6 个演示账号、0 个附件

备份/恢复：

```text
node scripts/backup.mjs
node scripts/restore.mjs --backup <backup-dir> --to <new-dir>
```

- 备份 manifest：`users=6, orders=4, orderItems=4, attachments=0`
- 恢复：`integrity=ok`，migrations 为 001/002/003，附件校验 0 个
- 恢复目录为新目录，未覆盖运行库

## 4. 未执行 / 已知限制

- **没有执行 `git push`**：尚未提供 GitHub 远程地址；上传命令见 `GITHUB.md`。
- 没有创建 GitHub 仓库、没有选择开源许可证。
- CI 未运行浏览器 E2E；E2E 需要 Edge/Playwright 浏览器，仍按 README 在本机执行。
- `npm ci` 输出 `inflight`、`glob`、`uuid` 的 deprecated 警告；锁文件安装成功，未阻断测试与构建。
- 本记录是 GitHub 准备检查，不替代 `2026-11-03-acceptance.md` 中的 A01-A35 验收记录。
