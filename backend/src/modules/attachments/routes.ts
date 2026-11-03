import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { newId, sha256 } from '../../common/crypto.js';
import { AppError, errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { idParam, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { getOrderOrThrow } from '../orders/service.js';

const ALLOWED_MIME = 'application/pdf';
const ALLOWED_EXT = '.pdf';
const MAGIC = Buffer.from('%PDF-', 'ascii');

function safeOriginalName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'document.pdf';
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 180) || 'document.pdf';
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function registerAttachmentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.post('/orders/:id/attachments', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const actor = request.auth!.user;
    const order = getOrderOrThrow(db, orderId);
    const upload = await request.file();
    if (!upload) throw errors.validation('请选择要上传的 PDF 文件');
    const originalName = safeOriginalName(upload.filename);
    const extension = extname(originalName).toLowerCase();
    if (extension !== ALLOWED_EXT || upload.mimetype !== ALLOWED_MIME) {
      upload.file.resume();
      throw new AppError('UNSUPPORTED_FILE_TYPE', '只允许上传 PDF 文件（.pdf，application/pdf）');
    }
    let buffer: Buffer;
    try {
      buffer = await upload.toBuffer();
    } catch (error) {
      if ((error as Error).message.includes('file size')) {
        throw errors.validation(`文件超过大小上限（${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB）`);
      }
      throw error;
    }
    if (buffer.length === 0) throw errors.validation('文件内容为空');
    if (buffer.length > config.maxUploadBytes) {
      throw errors.validation(`文件超过大小上限（${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB）`);
    }
    if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new AppError('UNSUPPORTED_FILE_TYPE', '文件内容不是有效的 PDF（扩展名或 MIME 可能被伪装）');
    }

    const storedName = `${newId()}${ALLOWED_EXT}`;
    const absolutePath = resolve(config.uploadDir, storedName);
    if (!absolutePath.startsWith(resolve(config.uploadDir))) {
      throw errors.validation('存储路径不合法');
    }
    const digest = sha256(buffer);
    writeFileSync(absolutePath, buffer, { mode: 0o600 });
    try {
      const attachmentId = newId();
      db.tx(() => {
        db.run(
          `INSERT INTO attachments(id, order_id, original_name, stored_name, mime, size_bytes, sha256, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          attachmentId,
          orderId,
          originalName,
          storedName,
          ALLOWED_MIME,
          buffer.length,
          digest,
          actor.id,
          nowIso()
        );
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'ATTACHMENT_UPLOAD',
          resourceType: 'ATTACHMENT',
          resourceId: attachmentId,
          result: 'SUCCESS',
          after: { orderId, originalName, size: buffer.length, sha256: digest }
        });
      });
      return ok(
        reply,
        request,
        {
          id: attachmentId,
          orderId: order.id,
          originalName,
          mime: ALLOWED_MIME,
          size: buffer.length,
          sha256: digest,
          createdAt: nowIso()
        },
        201
      );
    } catch (error) {
      // 元数据写入失败时删除物理文件，避免幽灵文件。
      try {
        if (existsSync(absolutePath)) unlinkSync(absolutePath);
      } catch {
        request.log.error({ err: error, storedName }, '附件回滚删除失败');
      }
      throw error;
    }
  });

  app.get('/orders/:id/attachments', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    getOrderOrThrow(db, id);
    const rows = db.all<{
      id: string;
      original_name: string;
      mime: string;
      size_bytes: number;
      uploaded_by_name: string;
      created_at: string;
    }>(
      `SELECT a.id, a.original_name, a.mime, a.size_bytes, a.created_at, u.display_name AS uploaded_by_name
       FROM attachments a JOIN users u ON u.id = a.uploaded_by
       WHERE a.order_id = ? ORDER BY a.created_at DESC`,
      id
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        originalName: row.original_name,
        mime: row.mime,
        size: row.size_bytes,
        uploadedByName: row.uploaded_by_name,
        createdAt: row.created_at,
        downloadUrl: `/api/v1/attachments/${row.id}/download`
      }))
    });
  });

  app.get('/attachments/:id/download', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const row = db.get<{ id: string; original_name: string; stored_name: string; mime: string }>(
      'SELECT id, original_name, stored_name, mime FROM attachments WHERE id = ?',
      id
    );
    if (!row) throw errors.notFound('附件不存在');
    const absolutePath = resolve(config.uploadDir, row.stored_name);
    if (!absolutePath.startsWith(resolve(config.uploadDir)) || !existsSync(absolutePath)) {
      throw errors.notFound('附件文件不存在或已被清理');
    }
    const buffer = readFileSync(absolutePath);
    reply.header('Content-Type', row.mime);
    reply.header('Content-Disposition', contentDisposition(row.original_name));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(buffer);
  });
}
