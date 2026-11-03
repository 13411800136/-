import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';

export type Role = 'ADMIN' | 'LOGISTICS' | 'PRODUCTION' | 'QC' | 'PACKING';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: '管理员',
  LOGISTICS: '物流',
  PRODUCTION: '生产',
  QC: '品控',
  PACKING: '包装'
};

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  departmentCategory: string | null;
  isSuperAdmin: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  viaCookie: boolean;
}

export interface AppContext {
  db: AppDatabase;
  config: AppConfig;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
