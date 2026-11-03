import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { errors } from '../../common/errors.js';
import { ok, pageMeta } from '../../common/http.js';
import { validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  resourceType: z.string().trim().max(50).optional(),
  resourceId: z.string().trim().max(100).optional(),
  result: z.enum(['SUCCESS', 'FAILURE']).optional(),
  keyword: z.string().trim().max(80).optional()
});

export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/audit-logs', admin, async (request, reply) => {
    const query = validate(auditQuery, request.query);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.resourceType) {
      where.push('resource_type = ?');
      params.push(query.resourceType);
    }
    if (query.resourceId) {
      where.push('resource_id = ?');
      params.push(query.resourceId);
    }
    if (query.result) {
      where.push('result = ?');
      params.push(query.result);
    }
    if (query.keyword) {
      where.push('(action LIKE ? OR actor_name LIKE ? OR resource_id LIKE ?)');
      const like = `%${query.keyword}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM audit_logs ${whereSql}`,
      ...params
    );
    const rows = db.all<{
      id: string;
      request_id: string;
      actor_name: string;
      action: string;
      resource_type: string;
      resource_id: string | null;
      result: string;
      error_code: string | null;
      before_json: string | null;
      after_json: string | null;
      detail: string | null;
      created_at: string;
    }>(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        actorName: row.actor_name,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        result: row.result,
        errorCode: row.error_code,
        before: row.before_json ? (JSON.parse(row.before_json) as unknown) : null,
        after: row.after_json ? (JSON.parse(row.after_json) as unknown) : null,
        detail: row.detail,
        createdAt: row.created_at
      })),
      pagination: pageMeta(total?.count ?? 0, query.page, query.pageSize)
    });
  });

  app.delete('/audit-logs/:id', admin, async () => {
    throw errors.feature('审计日志为受保护记录，任何角色都不能删除或修改');
  });

  app.patch('/audit-logs/:id', admin, async () => {
    throw errors.feature('审计日志为受保护记录，任何角色都不能删除或修改');
  });
}
