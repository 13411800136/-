import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { newId } from './common/crypto.js';
import { AppError, toPublicError } from './common/errors.js';
import { writeAudit } from './common/audit.js';
import { ok } from './common/http.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerMasterRoutes } from './modules/master/routes.js';
import { registerOrderRoutes } from './modules/orders/routes.js';
import { registerPurchaseRoutes } from './modules/purchases/routes.js';
import { registerProductionRoutes } from './modules/production/routes.js';
import { registerQcRoutes } from './modules/qc/routes.js';
import { registerPackingRoutes } from './modules/packing/routes.js';
import { registerShippingRoutes } from './modules/shipping/routes.js';
import { registerCancellationRoutes } from './modules/cancellations/routes.js';
import { registerInventoryRoutes } from './modules/inventory/routes.js';
import { registerAttachmentRoutes } from './modules/attachments/routes.js';
import { registerExportRoutes } from './modules/exports/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerExceptionRoutes } from './modules/exceptions/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerMessageRoutes } from './modules/messages/routes.js';
import { registerFinanceRoutes } from './modules/finance/routes.js';
import type { AppContext } from './common/types.js';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db/database.js';

export interface BuildAppOptions {
  db: AppDatabase;
  config: AppConfig;
  serveStatic?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, config } = options;
  const app = Fastify({
    genReqId: () => newId(),
    bodyLimit: 1_500_000,
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]']
          },
    trustProxy: false
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
      fieldSize: 32_000
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Request-Id', request.id);
    return payload;
  });

  const ctx: AppContext = { db, config };

  app.setErrorHandler((error, request, reply) => {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.code === 'FST_FILES_LIMIT') {
      error = new AppError('FILE_TOO_LARGE', `文件大小超过上限（${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB）`);
    } else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      error = new AppError('VALIDATION_ERROR', '请求体过大');
    } else if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      error = new AppError('VALIDATION_ERROR', '请求体格式不合法');
    }

    const { status, body } = toPublicError(error);
    if (status >= 500) {
      request.log.error({ err: error, requestId: request.id }, '请求处理失败');
    }
    if (request.url.startsWith('/api/') && request.auth && request.method !== 'GET' && request.method !== 'HEAD') {
      writeAudit(db, {
        requestId: request.id,
        actor: request.auth.user,
        action: `${request.method} ${request.routeOptions.url ?? request.url}`,
        resourceType: 'REQUEST',
        result: 'FAILURE',
        errorCode: body.error.code,
        detail: body.error.message
      });
    }
    reply.code(status).send({ ...body, requestId: request.id });
  });

  app.get('/api/v1/health', async (request, reply) =>
    ok(reply, request, { status: 'ok', service: 'factory-collab', time: new Date().toISOString() })
  );
  app.get('/api/v1/ready', async (request, reply) => {
    try {
      db.get('SELECT 1 AS ok');
      return ok(reply, request, { status: 'ready', database: 'ok' });
    } catch {
      throw new AppError('INTERNAL_ERROR', '数据库尚未就绪');
    }
  });

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, ctx);
      await registerMasterRoutes(api, ctx);
      await registerOrderRoutes(api, ctx);
      await registerPurchaseRoutes(api, ctx);
      await registerProductionRoutes(api, ctx);
      await registerQcRoutes(api, ctx);
      await registerPackingRoutes(api, ctx);
      await registerShippingRoutes(api, ctx);
      await registerCancellationRoutes(api, ctx);
      await registerInventoryRoutes(api, ctx);
      await registerAttachmentRoutes(api, ctx);
      await registerExportRoutes(api, ctx);
      await registerNotificationRoutes(api, ctx);
      await registerDashboardRoutes(api, ctx);
      await registerExceptionRoutes(api, ctx);
      await registerAuditRoutes(api, ctx);
      await registerMessageRoutes(api, ctx);
  await registerFinanceRoutes(api, ctx);
    },
    { prefix: '/api/v1' }
  );

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({
        error: { code: 'NOT_FOUND', message: '接口不存在' },
        requestId: request.id
      });
      return;
    }
    const indexPath = resolve(config.publicDir, 'index.html');
    if (request.method === 'GET' && existsSync(indexPath)) {
      reply.type('text/html; charset=utf-8').send(readFileSync(indexPath));
      return;
    }
    reply.code(404).type('text/plain; charset=utf-8').send('页面不存在。请先构建前端：npm run build');
  });

  const distExists = existsSync(resolve(config.publicDir, 'index.html'));
  if (options.serveStatic !== false && distExists) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
      cacheControl: true,
      maxAge: '1h',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      }
    });
  } else if (options.serveStatic !== false) {
    app.log.warn(`未找到前端构建产物：${config.publicDir}；仅 API 可用。`);
  }

  return app;
}
