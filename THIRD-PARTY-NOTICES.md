# 第三方依赖声明

本项目使用 npm 包；下表列出直接依赖及其许可证（以安装包内 `package.json` 为准）。间接依赖的许可证随 `package-lock.json` 锁定，发布前应使用组织允许的许可证扫描工具复核。

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| Fastify | HTTP 服务 | MIT |
| @fastify/cookie | Cookie 解析 | MIT |
| @fastify/multipart | 附件上传 | MIT |
| @fastify/static | 前端静态文件 | MIT |
| Zod | 输入 Schema | MIT |
| ExcelJS | xlsx 导出 | MIT |
| dotenv | 本地环境变量 | BSD-2-Clause |
| React / React DOM | 前端 UI | MIT |
| React Router DOM | 前端路由 | MIT |
| Vite / @vitejs/plugin-react | 前端构建 | MIT |
| lucide-react | 图标 | ISC |
| TypeScript | 类型检查/编译 | Apache-2.0 |
| tsx | TypeScript 运行入口 | MIT |
| @playwright/test | 浏览器 E2E | Apache-2.0 |
| @types/node、@types/react、@types/react-dom | 类型声明 | MIT |

本项目根目录暂未添加 `LICENSE`。在作者明确选择许可证前，不声明项目源码可对外开源；第三方依赖仍遵循各自许可证。
