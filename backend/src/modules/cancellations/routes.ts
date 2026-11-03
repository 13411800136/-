import type { FastifyInstance } from 'fastify';
import { errors } from '../../common/errors.js';
import { createAuthenticate } from '../../common/auth.js';
import type { AppContext } from '../../common/types.js';

const RESOURCES = [
  ['arrival-records', '到货记录'],
  ['production-feedbacks', '生产反馈'],
  ['qc-records', '质检记录'],
  ['packing-records', '包装记录'],
  ['shipment-records', '发货记录']
] as const;

/**
 * 最低实现不启用撤销。这里显式返回 409，而不是 404 或静默删除，
 * 以便调用方明确知道“该能力未启用”，并保留全部业务记录。
 */
export async function registerCancellationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const authenticate = createAuthenticate(ctx.db, ctx.config);
  for (const [path, label] of RESOURCES) {
    app.post(`/${path}/:id/cancel`, { preHandler: authenticate }, async () => {
      throw errors.feature(`${label}撤销属于 F 能力，当前版本未启用；请保留原记录并按管理员人工流程处理`);
    });
    app.delete(`/${path}/:id`, { preHandler: authenticate }, async () => {
      throw errors.feature(`${label}不允许删除；业务记录必须可追溯`);
    });
  }
}
