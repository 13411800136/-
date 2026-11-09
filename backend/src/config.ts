import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = resolve(BACKEND_ROOT, '..');

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databasePath: string;
  uploadDir: string;
  publicDir: string;
  appOrigins: string[];
  sessionTtlHours: number;
  cookieSecure: boolean;
  demoMode: boolean;
  demoPassword: string;
  maxUploadBytes: number;
  authPepper: string;
  logLevel: string;
  projectRoot: string;
  backupDir: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function resolvePath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ? value.trim() : fallback;
  return isAbsolute(candidate) ? candidate : resolve(PROJECT_ROOT, candidate);
}

function loadPepper(nodeEnv: string): string {
  const fromEnv = process.env.AUTH_PEPPER?.trim();
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (fromEnv) throw new Error('AUTH_PEPPER 至少需要 32 个字符');
  if (nodeEnv === 'production') {
    throw new Error('生产环境必须提供 AUTH_PEPPER（至少 32 字符），拒绝使用默认值启动');
  }
  const secretFile = resolve(PROJECT_ROOT, 'data/.auth-secret');
  if (existsSync(secretFile)) {
    const existing = readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  mkdirSync(dirname(secretFile), { recursive: true });
  const generated = randomBytes(48).toString('base64url');
  writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  dotenv.config({ path: resolve(PROJECT_ROOT, '.env'), quiet: true });
  const nodeEnv = (overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV 非法：${nodeEnv}`);
  }
  const port = Number(overrides.port ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1-65535 的整数');
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 20);
  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0 || maxUploadMb > 50) {
    throw new Error('MAX_UPLOAD_MB 必须是 0-50 之间的数字');
  }
  const rawOrigins = overrides.appOrigins ?? [
    process.env.APP_ORIGIN ?? 'http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:5173,http://localhost:5173'
  ];
  const appOrigins = rawOrigins
    .flatMap((origin) => origin.split(','))
    .map((origin) => origin.trim())
    .filter(Boolean);
  const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  if (!Number.isFinite(sessionTtlHours) || sessionTtlHours < 1 || sessionTtlHours > 168) {
    throw new Error('SESSION_TTL_HOURS 必须是 1-168 之间的数字');
  }

  const config: AppConfig = {
    nodeEnv,
    port,
    host: process.env.HOST ?? '127.0.0.1',
    databasePath: resolvePath(process.env.DATABASE_PATH, 'data/factory.db'),
    uploadDir: resolvePath(process.env.UPLOAD_DIR, 'data/uploads'),
    publicDir: resolvePath(process.env.PUBLIC_DIR, 'frontend/dist'),
    appOrigins,
    sessionTtlHours,
    cookieSecure: bool(process.env.COOKIE_SECURE, nodeEnv === 'production'),
    demoMode: bool(process.env.DEMO_MODE, nodeEnv !== 'production'),
    demoPassword: process.env.DEMO_PASSWORD ?? 'Demo@2026',
    maxUploadBytes: Math.round(maxUploadMb * 1024 * 1024),
    authPepper: overrides.authPepper ?? loadPepper(nodeEnv),
    logLevel: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    projectRoot: PROJECT_ROOT,
    backupDir: resolvePath(process.env.BACKUP_DIR, 'backups')
  };
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.uploadDir, { recursive: true });
  return { ...config, ...overrides };
}

export const PROJECT_PATHS = { backendRoot: BACKEND_ROOT, projectRoot: PROJECT_ROOT };
