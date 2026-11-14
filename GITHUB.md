# GitHub 上传准备

本文只记录上传前的检查和命令；**没有远程地址时不会自动推送**。当前项目版本为 `v1.3.0`，默认分支 `master`，上传时可改为 `main`。

## 1. 上传前必须确认

| 检查 | 命令/位置 | 期望 |
| --- | --- | --- |
| 工作区干净 | `git status --short` | 没有未提交文件 |
| 提交与标签 | `git log -1 --oneline`、`git tag --list` | 有 `v1.3.0` 标签 |
| 无运行数据 | `git ls-files` | 不出现 `data/`、`backups/`、`uploads/`、`node_modules/`、`dist/` |
| 无真实秘密 | 仓库搜索 `AUTH_PEPPER`、`auth-secret`、`C:\\Users` | 只有占位值或代码里的变量名 |
| 测试 | `npm run typecheck && npm run test && npm run build` | 类型通过、44/44、构建成功 |
| 演示数据 | `.env.example`、`backend/src/db/seed.ts` | 只有合成账号；密码仅用于本机演示 |
| 许可 | 仓库根目录 | 尚未添加 `LICENSE`；公开前由作者决定许可证 |

`.gitignore` 已忽略 `.env`、`data/`、`backups/`、`uploads/`、`node_modules/`、`backend/dist/`、`frontend/dist/`、测试运行产物和日志。它**不能**清除已经进入 Git 历史的文件，所以推送前仍要检查 `git ls-files`。

## 2. 建议的首次上传

先在 GitHub 网页创建空仓库，建议先选 **Private**，确认内容后再决定是否公开；不要勾选自动生成 README、`.gitignore` 或 LICENSE，避免和本地首次提交冲突。

```powershell
cd <你的本地项目目录>

# 1) 最后检查
npm run typecheck
npm run test
npm run build
git status --short
git log -1 --oneline
git tag --list

# 2) 打版本标签（如果还没有）
git tag -a v1.3.0 -m "厂序 FactoryFlow v1.3.0"

# 3) 关联远程；把 <你的账号>/<仓库名> 换成实际值
git remote add origin https://github.com/<你的账号>/<仓库名>.git

# 4) 使用 main（可选，但 GitHub 默认常用 main）
git branch -M main

# 5) 首次推送分支和标签
git push -u origin main
git push origin v1.3.0
```

如果远程已经存在且是空仓库，`git push -u origin main` 即可；如果远程有历史，先 `git fetch origin`、比较差异，不要直接强推。

## 3. 上传后验证

不要只看到 GitHub 页面有文件就认为完成。用一份新目录模拟接手者：

```powershell
git clone <你的仓库地址> factory-system-check
cd factory-system-check
npm ci
npm run setup
npm run build
npm start
```

然后访问 <http://127.0.0.1:8787>，用 `.env.example`/README 中的合成演示账号登录，新建一张订单并走一次到货，确认：

- 页面和 API 正常；
- 数据写入新生成的 `data/factory.db`；
- `data/`、`.env`、`node_modules/` 没有出现在仓库文件列表；
- GitHub Actions 的 `CI` 工作流为绿色。

## 4. 私有/公开与许可

- 仓库里的客户、员工、订单、附件都是合成数据，但**仍然建议先 Private**，确认没有误传本机路径、日志或截图后再公开。
- 当前根目录没有 `LICENSE`。如果没有明确选择许可证，默认保留所有权利；不要在没有授权的情况下宣称 MIT/Apache。
- 第三方依赖的许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- 不要在 Issue、Actions 日志或提交里写真实密码、令牌、数据库地址；`.env.example` 只放占位值。

## 5. 本次实际结果（2026-11-14）

- 仓库：<https://github.com/13411800136/->
- 远程仓库原本只有占位 README（`5af57be`）；已合并两边历史并保留项目说明。
- `main` 已推送，提交 `5adf563`；`v1.3.0` 标签已推送。
- GitHub Actions `CI` 首次运行（run #1）结果为 **success**。
- 仓库当前为 Public；根目录没有 `LICENSE`，公开状态由作者决定。
- 没有上传运行数据库、附件、`.env` 或 `.auth-secret`。
- E2E 未放入 CI（需要浏览器），仍按 README 在本机执行。
