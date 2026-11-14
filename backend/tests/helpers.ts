import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';

export interface TestEnv {
  dir: string;
  config: AppConfig;
  db: AppDatabase;
  app: FastifyInstance;
  apps: FastifyInstance[];
  close: () => Promise<void>;
}

const PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';

export async function createTestEnv(
  options: { connections?: number; maxUploadBytes?: number; logLevel?: string } = {}
): Promise<TestEnv> {
  const connections = options.connections ?? 1;
  const dir = mkdtempSync(join(tmpdir(), 'factory-test-'));
  const config = loadConfig({
    nodeEnv: 'test',
    logLevel: options.logLevel ?? 'silent',
    databasePath: join(dir, 'test.db'),
    uploadDir: join(dir, 'uploads'),
    publicDir: join(dir, 'public'),
    authPepper: PEPPER,
    demoMode: true,
    sessionTtlHours: 1,
    appOrigins: ['http://localhost'],
    maxUploadBytes: options.maxUploadBytes ?? 5 * 1024 * 1024,
    archiveDir: join(dir, 'archives')
  });
  mkdirSync(config.uploadDir, { recursive: true });
  const db = new AppDatabase(config.databasePath);
  migrate(db);
  seedDatabase(db, { includeDemoOrders: false, authPepper: config.authPepper });
  const apps: FastifyInstance[] = [];
  const databases: AppDatabase[] = [db];
  const app = await buildApp({ db, config, serveStatic: false });
  apps.push(app);
  for (let index = 1; index < connections; index += 1) {
    const extraDb = new AppDatabase(config.databasePath);
    databases.push(extraDb);
    apps.push(await buildApp({ db: extraDb, config, serveStatic: false }));
  }

  return {
    dir,
    config,
    db,
    app,
    apps,
    close: async () => {
      for (const instance of apps) await instance.close();
      for (const database of databases) {
        try {
          database.close();
        } catch {
          // 已关闭时忽略。
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

export async function login(app: FastifyInstance, username: string, password = 'Demo@2026'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: { username, password }
  });
  if (response.statusCode !== 200) throw new Error(`登录失败 ${username}: ${response.body}`);
  const raw = response.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw[0] : raw;
  if (!cookie) throw new Error('登录响应没有 Set-Cookie');
  return cookie.split(';')[0]!;
}

export async function call(
  app: FastifyInstance,
  cookie: string | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  idempotencyKey?: string
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers,
    ...(payload === undefined ? {} : { payload })
  });
}

export function key(prefix = 'test'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export interface SeedIds {
  customerId: string;
  supplierId: string;
  partId: string;
  departmentId: string;
  productionUserId: string;
}

export function masterIds(db: AppDatabase): SeedIds {
  const customer = db.get<{ id: string }>("SELECT id FROM customers WHERE code = 'CUS-001'")!;
  const supplier = db.get<{ id: string }>("SELECT id FROM suppliers WHERE code = 'SUP-001'")!;
  const part = db.get<{ id: string }>("SELECT id FROM parts WHERE code = 'PART-001'")!;
  const department = db.get<{ id: string }>("SELECT id FROM departments WHERE code = 'PROD-A'")!;
  const user = db.get<{ id: string }>("SELECT id FROM users WHERE username = 'prod'")!;
  return {
    customerId: customer.id,
    supplierId: supplier.id,
    partId: part.id,
    departmentId: department.id,
    productionUserId: user.id
  };
}

export function futureDate(days = 14): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
