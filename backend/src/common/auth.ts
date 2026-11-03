import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { errors } from './errors.js';
import { hashToken } from './crypto.js';
import { nowIso } from './time.js';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import type { AuthUser, Role } from './types.js';

export const SESSION_COOKIE = 'fx_session';

interface UserRow {
  session_id: string;
  session_version: number;
  user_session_version: number;
  last_seen_at: string;
  id: string;
  username: string;
  display_name: string;
  role: Role;
  department_id: string | null;
  department_name: string | null;
  department_category: string | null;
  is_super_admin: number;
  active: number;
}

function toAuthUser(row: UserRow): AuthUser {
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

function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function isMutating(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * 服务端会话认证：只接受 HttpOnly Cookie 或 Bearer 会话令牌，
 * 从不信任 body 中的 actorId / x-role 等自报身份。
 */
export function createAuthenticate(
  db: AppDatabase,
  config: AppConfig
): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const cookieToken = request.cookies[SESSION_COOKIE];
    const bearerToken = readBearer(request);
    const token = bearerToken ?? cookieToken;
    if (!token) throw errors.unauthenticated();

    const row = db.get<UserRow>(
      `SELECT s.id AS session_id, s.session_version, s.last_seen_at,
              u.id, u.username, u.display_name, u.role, u.department_id, u.is_super_admin, u.active,
              u.session_version AS user_session_version,
              d.name AS department_name, d.category AS department_category
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      hashToken(token, config.authPepper),
      nowIso()
    );
    if (!row || row.active !== 1) throw errors.unauthenticated('登录状态已失效，请重新登录');
    if (row.session_version !== row.user_session_version) {
      throw errors.unauthenticated('登录状态已失效，请重新登录');
    }

    if (isMutating(request.method) && !bearerToken) {
      const origin = request.headers.origin;
      if (origin && !config.appOrigins.includes(origin)) {
        throw errors.forbidden('请求来源不在允许列表中');
      }
    }

    const lastSeen = Date.parse(row.last_seen_at);
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000) {
      db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), row.session_id);
    }

    request.auth = { user: toAuthUser(row), sessionId: row.session_id, viaCookie: !bearerToken };
  };
}

export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const auth = request.auth;
    if (!auth) throw errors.unauthenticated();
    if (!roles.includes(auth.user.role)) throw errors.forbidden('当前角色不能执行该操作');
  };
}

export const requireAdmin = requireRole('ADMIN');

export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.auth) throw errors.unauthenticated();
  return request.auth.user;
}

export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure
  });
}
