import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomToken, hashPassword, hashToken, verifyPassword } from '../../common/crypto.js';
import { AppError, errors } from '../../common/errors.js';
import { nowIso } from '../../common/time.js';
import { ok } from '../../common/http.js';
import { validate } from '../../common/validation.js';
import { createAuthenticate, clearSessionCookie, setSessionCookie, SESSION_COOKIE } from '../../common/auth.js';
import { writeAudit } from '../../common/audit.js';
import { newId } from '../../common/crypto.js';
import type { AppContext, AuthUser, Role } from '../../common/types.js';

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(64, '用户名过长'),
  password: z.string().min(1, '请输入密码').max(128, '密码过长')
});

interface LoginRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  department_id: string | null;
  department_name: string | null;
  department_category: string | null;
  is_super_admin: number;
  active: number;
  session_version: number;
  password_hash: string;
  password_salt: string;
}

function toAuthUser(row: LoginRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name,
    departmentCategory: row.department_category,
    isSuperAdmin: row.is_super_admin === 1
  };
}

interface Attempt {
  count: number;
  resetAt: number;
}
const loginAttempts = new Map<string, Attempt>();

function assertNotLocked(key: string): void {
  const attempt = loginAttempts.get(key);
  if (!attempt) return;
  if (attempt.resetAt < Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  if (attempt.count >= 5) {
    const seconds = Math.ceil((attempt.resetAt - Date.now()) / 1000);
    throw new AppError('RATE_LIMITED', `登录失败次数过多，请 ${seconds} 秒后再试`, {
      retryAfterSeconds: seconds
    });
  }
}

function recordFailure(key: string): void {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
    return;
  }
  existing.count += 1;
}

function clearFailures(key: string): void {
  loginAttempts.delete(key);
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);

  app.post('/auth/login', async (request, reply) => {
    const input = validate(loginSchema, request.body);
    const username = input.username.toLowerCase();
    const rateKey = `${username}|${request.ip}`;
    assertNotLocked(rateKey);

    const row = db.get<LoginRow>(
      `SELECT u.id, u.username, u.display_name, u.role, u.department_id, u.password_hash,
              u.password_salt, u.is_super_admin, u.active, u.session_version,
              d.name AS department_name, d.category AS department_category
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.username = ?`,
      username
    );

    const passwordOk =
      row && row.active === 1
        ? verifyPassword(input.password, row.password_salt, row.password_hash, config.authPepper)
        : false;

    if (!row || !passwordOk) {
      recordFailure(rateKey);
      writeAudit(db, {
        requestId: request.id,
        actor: null,
        action: 'AUTH_LOGIN',
        resourceType: 'SESSION',
        result: 'FAILURE',
        errorCode: 'UNAUTHENTICATED',
        detail: `用户名或密码错误：${username}`
      });
      throw errors.unauthenticated('用户名或密码不正确');
    }

    clearFailures(rateKey);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
    const sessionId = newId();
    db.tx(() => {
      db.run(
        `INSERT INTO sessions(id, user_id, token_hash, session_version, created_at, expires_at, last_seen_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        sessionId,
        row.id,
        hashToken(token, config.authPepper),
        row.session_version ?? 1,
        nowIso(),
        expiresAt.toISOString(),
        nowIso()
      );
      db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
      writeAudit(db, {
        requestId: request.id,
        actor: { id: row.id, displayName: row.display_name },
        action: 'AUTH_LOGIN',
        resourceType: 'SESSION',
        resourceId: sessionId,
        result: 'SUCCESS'
      });
    });
    setSessionCookie(reply, config, token, expiresAt);
    reply.header('Cache-Control', 'no-store');
    const user = toAuthUser(row);
    return ok(reply, request, { user, expiresAt: expiresAt.toISOString() });
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return ok(reply, request, { user: request.auth!.user });
  });

  app.post('/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    db.tx(() => {
      db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), auth.sessionId);
      writeAudit(db, {
        requestId: request.id,
        actor: auth.user,
        action: 'AUTH_LOGOUT',
        resourceType: 'SESSION',
        resourceId: auth.sessionId,
        result: 'SUCCESS'
      });
    });
    clearSessionCookie(reply, config);
    return ok(reply, request, { loggedOut: true });
  });

  app.get('/auth/demo-accounts', async (request, reply) => {
    if (!config.demoMode) throw errors.notFound('演示账号入口未启用');
    const accounts = db.all<{
      username: string;
      display_name: string;
      role: Role;
      department_name: string | null;
    }>(
      `SELECT u.username, u.display_name, u.role, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.active = 1 ORDER BY
         CASE u.role WHEN 'ADMIN' THEN 0 WHEN 'LOGISTICS' THEN 1 WHEN 'PRODUCTION' THEN 2 WHEN 'QC' THEN 3 ELSE 4 END,
         u.username`
    );
    reply.header('Cache-Control', 'no-store');
    return ok(
      reply,
      request,
      accounts.map((account) => ({
        username: account.username,
        displayName: account.display_name,
        role: account.role,
        departmentName: account.department_name,
        password: config.demoPassword
      }))
    );
  });

  // 便于管理员在受控环境下校验密码哈希算法；不暴露任何账户信息。
  app.get('/auth/password-policy', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.send({
      data: { minLength: 8, maxLength: 72, algorithm: 'scrypt(N=16384,r=8,p=1)', storage: 'salted-hash' }
    });
  });
}

// 保留给测试/管理脚本使用，便于验证哈希函数与登录行为一致。
export function hashForSeed(password: string, pepper: string): { hash: string; salt: string } {
  return hashPassword(password, pepper);
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}
