import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPassword, newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { idParam, requiredText, shortText, validate } from '../../common/validation.js';
import type { AppContext, AuthUser, Role } from '../../common/types.js';

const codeSchema = z
  .string()
  .trim()
  .min(2, '编码至少 2 位')
  .max(32, '编码最多 32 位')
  .regex(/^[A-Za-z0-9_-]+$/, '编码仅允许字母、数字、下划线和短横线');

const masterCreate = z.object({
  code: codeSchema,
  name: requiredText(80, '名称'),
  contact: shortText(80, '联系方式').default('')
});

const masterPatch = z.object({
  name: requiredText(80, '名称').optional(),
  contact: shortText(80, '联系方式').optional(),
  active: z.boolean().optional()
});

const customerCreate = masterCreate.extend({
  taxNo: shortText(50, '税号').default(''),
  address: shortText(200, '地址').default('')
});

const customerPatch = masterPatch.extend({
  taxNo: shortText(50, '税号').optional(),
  address: shortText(200, '地址').optional()
});

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  active: z.enum(['0', '1']).optional()
});

const partCreate = z.object({
  code: codeSchema,
  name: requiredText(80, '名称'),
  spec: shortText(120, '规格').default(''),
  unit: shortText(20, '单位').default('件')
});

const partPatch = z.object({
  name: requiredText(80, '名称').optional(),
  spec: shortText(120, '规格').optional(),
  unit: shortText(20, '单位').optional(),
  active: z.boolean().optional()
});

const departmentCreate = z.object({
  name: requiredText(40, '部门名称'),
  category: z.enum(['PRODUCTION', 'LOGISTICS', 'QC', 'PACKING'])
});

const userCreate = z.object({
  username: z
    .string()
    .trim()
    .min(3, '用户名至少 3 位')
    .max(32, '用户名最多 32 位')
    .regex(/^[A-Za-z0-9_]+$/, '用户名仅允许字母、数字和下划线'),
  displayName: requiredText(40, '姓名'),
  role: z.enum(['ADMIN', 'LOGISTICS', 'PRODUCTION', 'QC', 'PACKING']),
  departmentId: z.string().min(1).nullable().optional(),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位')
});

const userPatch = z.object({
  displayName: requiredText(40, '姓名').optional(),
  departmentId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位').optional()
});

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function assertCodeWritable(
  db: AppContext['db'],
  table: 'customers' | 'suppliers' | 'parts',
  id: string,
  actor: AuthUser,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  requestId: string,
  columnMap: Record<string, string> = {}
): void {
  const sets: string[] = [];
  const params: Array<string | number> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${columnMap[key] ?? key} = ?`);
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string));
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(nowIso());
  params.push(id);
  db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const after = db.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, id);
  writeAudit(db, {
    requestId,
    actor,
    action: `${table.toUpperCase()}_UPDATE`,
    resourceType: table.toUpperCase(),
    resourceId: id,
    result: 'SUCCESS',
    before,
    after
  });
}

function registerMasterResource(
  app: FastifyInstance,
  ctx: AppContext,
  options: {
    table: 'customers' | 'suppliers';
    path: string;
    label: string;
    createSchema: typeof masterCreate;
    patchSchema: typeof masterPatch;
    extraFields?: Array<{ key: string; column: string }>;
  }
): void {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get(`/${options.path}`, admin, async (request, reply) => {
    const query = validate(listQuery, request.query);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.search) {
      where.push('(name LIKE ? OR code LIKE ? OR contact LIKE ?)');
      const like = `%${query.search}%`;
      params.push(like, like, like);
    }
    if (query.active) {
      where.push('active = ?');
      params.push(Number(query.active));
    }
    const sql = `SELECT * FROM ${options.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY active DESC, created_at DESC LIMIT 200`;
    const rows = db.all<Record<string, unknown>>(sql, ...params);
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contact: row.contact,
        ...Object.fromEntries(
          (options.extraFields ?? []).map((field) => [field.key, row[field.column] ?? ''])
        ),
        active: row.active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  });

  app.post(`/${options.path}`, admin, async (request, reply) => {
    const input = validate(options.createSchema, request.body);
    const actor = request.auth!.user;
    const id = newId();
    const now = nowIso();
    const extraInput = input as unknown as Record<string, unknown>;
    const extraFields = options.extraFields ?? [];
    const columns = ['id', 'code', 'name', 'contact', ...extraFields.map((field) => field.column), 'active', 'created_at', 'updated_at'];
    const values = [
      id,
      input.code.toUpperCase(),
      input.name,
      input.contact,
      ...extraFields.map((field) => String(extraInput[field.key] ?? '')),
      1,
      now,
      now
    ];
    try {
      db.tx(() => {
        db.run(
          `INSERT INTO ${options.table}(${columns.join(', ')})
           VALUES (${columns.map(() => '?').join(', ')})`,
          ...values
        );
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: `${options.table.toUpperCase()}_CREATE`,
          resourceType: options.table.toUpperCase(),
          resourceId: id,
          result: 'SUCCESS',
          after: { ...input, code: input.code.toUpperCase() }
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw errors.conflict(`${options.label}编码已存在：${input.code.toUpperCase()}`);
      throw error;
    }
    return ok(reply, request, { id, code: input.code.toUpperCase() }, 201);
  });

  app.patch(`/${options.path}/:id`, admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const patch = validate(options.patchSchema, request.body);
    const actor = request.auth!.user;
    const before = db.get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, id);
    if (!before) throw errors.notFound(`${options.label}不存在`);
    const columnMap = Object.fromEntries(
      (options.extraFields ?? []).map((field) => [field.key, field.column])
    );
    db.tx(() => assertCodeWritable(db, options.table, id, actor, before, patch, request.id, columnMap));
    return ok(reply, request, { id, updated: true });
  });
}

export async function registerMasterRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  registerMasterResource(app, ctx, {
    table: 'customers',
    path: 'customers',
    label: '客户',
    createSchema: customerCreate,
    patchSchema: customerPatch,
    extraFields: [
      { key: 'taxNo', column: 'tax_no' },
      { key: 'address', column: 'address' }
    ]
  });
  registerMasterResource(app, ctx, {
    table: 'suppliers',
    path: 'suppliers',
    label: '供应商',
    createSchema: masterCreate,
    patchSchema: masterPatch
  });

  app.get('/parts', admin, async (request, reply) => {
    const query = validate(listQuery, request.query);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.search) {
      where.push('(name LIKE ? OR code LIKE ? OR spec LIKE ?)');
      const like = `%${query.search}%`;
      params.push(like, like, like);
    }
    if (query.active) {
      where.push('active = ?');
      params.push(Number(query.active));
    }
    const rows = db.all<Record<string, unknown>>(
      `SELECT * FROM parts ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY active DESC, created_at DESC LIMIT 200`,
      ...params
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        spec: row.spec,
        unit: row.unit,
        active: row.active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  });

  app.post('/parts', admin, async (request, reply) => {
    const input = validate(partCreate, request.body);
    const actor = request.auth!.user;
    const id = newId();
    const now = nowIso();
    try {
      db.tx(() => {
        db.run(
          `INSERT INTO parts(id, code, name, spec, unit, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          id,
          input.code.toUpperCase(),
          input.name,
          input.spec,
          input.unit,
          now,
          now
        );
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PARTS_CREATE',
          resourceType: 'PART',
          resourceId: id,
          result: 'SUCCESS',
          after: { ...input, code: input.code.toUpperCase() }
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw errors.conflict(`配件编码已存在：${input.code.toUpperCase()}`);
      throw error;
    }
    return ok(reply, request, { id, code: input.code.toUpperCase() }, 201);
  });

  app.patch('/parts/:id', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const patch = validate(partPatch, request.body);
    const actor = request.auth!.user;
    const before = db.get<Record<string, unknown>>('SELECT * FROM parts WHERE id = ?', id);
    if (!before) throw errors.notFound('配件不存在');
    db.tx(() => assertCodeWritable(db, 'parts', id, actor, before, patch, request.id));
    return ok(reply, request, { id, updated: true });
  });

  app.get('/departments', admin, async (request, reply) => {
    const rows = db.all<Record<string, unknown>>(
      'SELECT * FROM departments ORDER BY category, name'
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        category: row.category,
        active: row.active === 1
      }))
    });
  });

  app.post('/departments', admin, async (request, reply) => {
    const input = validate(departmentCreate, request.body);
    const actor = request.auth!.user;
    const id = newId();
    const code = `DEP-${Date.now().toString(36).toUpperCase()}`;
    db.tx(() => {
      db.run(
        `INSERT INTO departments(id, code, name, category, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        id,
        code,
        input.name,
        input.category,
        nowIso()
      );
      writeAudit(db, {
        requestId: request.id,
        actor,
        action: 'DEPARTMENT_CREATE',
        resourceType: 'DEPARTMENT',
        resourceId: id,
        result: 'SUCCESS',
        after: input
      });
    });
    return ok(reply, request, { id, code }, 201);
  });

  app.get('/users', admin, async (request, reply) => {
    const query = validate(
      z.object({
        search: z.string().trim().max(80).optional(),
        role: z.enum(['ADMIN', 'LOGISTICS', 'PRODUCTION', 'QC', 'PACKING']).optional()
      }),
      request.query
    );
    const where: string[] = [];
    const params: string[] = [];
    if (query.search) {
      where.push('(u.username LIKE ? OR u.display_name LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }
    if (query.role) {
      where.push('u.role = ?');
      params.push(query.role);
    }
    const rows = db.all<Record<string, unknown>>(
      `SELECT u.id, u.username, u.display_name, u.role, u.department_id, u.active, u.created_at,
              d.name AS department_name, d.category AS department_category
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.active DESC, u.role, u.created_at`,
      ...params
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        departmentId: row.department_id,
        departmentName: row.department_name,
        departmentCategory: row.department_category,
        active: row.active === 1,
        createdAt: row.created_at
      }))
    });
  });

  app.post('/users', admin, async (request, reply) => {
    const input = validate(userCreate, request.body);
    const actor = request.auth!.user;
    const department = input.departmentId
      ? db.get<{ id: string; category: string; active: number }>(
          'SELECT id, category, active FROM departments WHERE id = ?',
          input.departmentId
        )
      : null;
    if (input.role === 'ADMIN' && input.departmentId) {
      throw errors.validation('管理员不绑定现场部门', [{ path: 'departmentId', message: '管理员应为空' }]);
    }
    if (input.role !== 'ADMIN') {
      if (!department) throw errors.validation('现场角色必须选择所属部门', [{ path: 'departmentId', message: '请选择部门' }]);
      if (department.active !== 1) throw errors.validation('部门已停用', [{ path: 'departmentId', message: '部门已停用' }]);
      const expected: Record<Exclude<Role, 'ADMIN'>, string> = {
        PRODUCTION: 'PRODUCTION',
        LOGISTICS: 'LOGISTICS',
        QC: 'QC',
        PACKING: 'PACKING'
      };
      if (department.category !== expected[input.role as Exclude<Role, 'ADMIN'>]) {
        throw errors.validation('部门类别与角色不匹配', [{ path: 'departmentId', message: '请选择对应类别的部门' }]);
      }
    }
    const { hash, salt } = hashPassword(input.password, config.authPepper);
    const id = newId();
    try {
      db.tx(() => {
        db.run(
          `INSERT INTO users(id, username, display_name, role, department_id, password_hash, password_salt,
                             is_super_admin, active, session_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?)`,
          id,
          input.username.toLowerCase(),
          input.displayName,
          input.role,
          department?.id ?? null,
          hash,
          salt,
          nowIso(),
          nowIso()
        );
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'USER_CREATE',
          resourceType: 'USER',
          resourceId: id,
          result: 'SUCCESS',
          after: { username: input.username, displayName: input.displayName, role: input.role }
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw errors.conflict('用户名已存在');
      throw error;
    }
    return ok(reply, request, { id, username: input.username.toLowerCase() }, 201);
  });

  app.patch('/users/:id', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const patch = validate(userPatch, request.body);
    const actor = request.auth!.user;
    const before = db.get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', id);
    if (!before) throw errors.notFound('员工账号不存在');
    if (id === actor.id && patch.active === false) throw errors.conflict('不能停用当前登录的管理员账号');
    if (patch.active === false) {
      const adminCount = db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = 1 AND id <> ?",
        id
      );
      if (before.role === 'ADMIN' && (adminCount?.count ?? 0) === 0) {
        throw errors.conflict('系统必须保留至少一个启用中的管理员');
      }
    }
    if (patch.departmentId !== undefined) {
      if (before.role === 'ADMIN') {
        throw errors.validation('管理员不绑定现场部门', [{ path: 'departmentId', message: '应为空' }]);
      }
      if (patch.departmentId !== null) {
        const department = db.get<{ id: string; category: string; active: number }>(
          'SELECT id, category, active FROM departments WHERE id = ?',
          patch.departmentId
        );
        if (!department || department.active !== 1) {
          throw errors.validation('部门不存在或已停用', [{ path: 'departmentId', message: '部门不可用' }]);
        }
        if (department.category !== before.role) {
          throw errors.validation('部门类别与员工角色不匹配', [{ path: 'departmentId', message: '请选择对应类别的部门' }]);
        }
      }
    }
    db.tx(() => {
      const sets: string[] = [];
      const params: Array<string | number | null> = [];
      if (patch.displayName !== undefined) {
        sets.push('display_name = ?');
        params.push(patch.displayName);
      }
      if (patch.departmentId !== undefined) {
        sets.push('department_id = ?');
        params.push(patch.departmentId);
      }
      if (patch.active !== undefined) {
        sets.push('active = ?');
        params.push(patch.active ? 1 : 0);
      }
      if (patch.password !== undefined) {
        const { hash, salt } = hashPassword(patch.password, config.authPepper);
        sets.push('password_hash = ?', 'password_salt = ?');
        params.push(hash, salt);
      }
      if (patch.active === false || patch.password !== undefined) {
        sets.push('session_version = session_version + 1');
      }
      sets.push('updated_at = ?');
      params.push(nowIso());
      params.push(id);
      db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params);
      if (patch.active === false || patch.password !== undefined) {
        db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), id);
      }
      const after = db.get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', id);
      writeAudit(db, {
        requestId: request.id,
        actor,
        action: 'USER_UPDATE',
        resourceType: 'USER',
        resourceId: id,
        result: 'SUCCESS',
        before,
        after
      });
    });
    return ok(reply, request, { id, updated: true });
  });

  app.post('/users/:id/reject-role-change', admin, async () => {
    throw errors.feature('角色变更属于账户管理增强能力，当前版本未启用；请新建对应角色账号');
  });
}

export function actorLabel(request: FastifyRequest): string {
  return request.auth?.user.displayName ?? '未认证';
}
