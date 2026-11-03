import type { FastifyReply, FastifyRequest } from 'fastify';

export function ok<T>(reply: FastifyReply, request: FastifyRequest, data: T, status = 200): FastifyReply {
  return reply.code(status).send({ data, requestId: request.id });
}

export function pageMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0
  };
}
