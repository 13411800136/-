# ADR-002：不透明会话 + scrypt

- 日期：2026-11-03
- 状态：已接受
- 关联：R01/R08；A01/A02

## 背景

需要真实认证、服务端角色、会话撤销、停用账号立即失效，且不引入外部身份服务。密码不能明文或弱哈希存储；预算内不引入 bcrypt/argon2 原生依赖。

## 选项

1. JWT（无状态）+ bcrypt：前端可读 token，撤销困难；bcrypt 原生依赖。
2. JWT + 服务端黑名单：仍需会话表，复杂度增加。
3. 不透明随机 token + 数据库会话 + scrypt：服务端可撤销，零原生依赖。
4. 仅前端角色/姓名选择：不满足真实认证。

## 决定

选择 3。

- 密码：`scrypt(N=16384,r=8,p=1)` + 16 字节随机 salt + 服务端 pepper；`timingSafeEqual` 校验。
- 会话：32 字节随机 token，数据库只存 `sha256(token|pepper)`；HttpOnly、SameSite=Lax Cookie，默认 12h。
- 认证：Cookie 或 Bearer；每次请求 join users/sessions，检查过期、revoked、active、session_version。
- 写请求 Cookie 认证校验 Origin；登录限流 5 次/10 分钟（进程内）。
- 停用/改密：递增 session_version 并撤销全部会话。
- 角色变更未实现（F 账户管理），避免旧权限继续使用。

## 后果

正面：可服务端撤销、无前端 token 暴露、无签名密钥轮换、依赖少；权限变更即时生效；测试可直接用 Set-Cookie。

负面：每次请求一次会话查询（有索引，量小）；进程内限流重启清零、不适合多实例；Cookie 需要正确配置 Origin/HTTPS。

## 验证

- 无凭证/伪造 x-role 401；错误密码通用 401；登出后 401；停用后旧会话与登录 401。
- 现场角色访问管理员接口 403；价格字段按角色裁剪。
- 生产缺 `AUTH_PEPPER` 明确失败；开发自动生成本地 secret 且不打包。

## 回退

若改为 JWT：保留 `users/sessions` 作为撤销与审计来源，增加 token 版本/黑名单；不能只删除会话检查，否则停用与越权防护会退化。
