export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STOCK_INSUFFICIENT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INVALID_STATE'
  | 'QUANTITY_EXCEEDED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FEATURE_NOT_ENABLED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STOCK_INSUFFICIENT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  INVALID_STATE: 409,
  QUANTITY_EXCEEDED: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  FEATURE_NOT_ENABLED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.expose = this.status < 500;
  }
}

export const errors = {
  validation: (message = '请求参数不合法', details?: unknown) => new AppError('VALIDATION_ERROR', message, details),
  unauthenticated: (message = '请先登录') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = '没有权限执行该操作') => new AppError('FORBIDDEN', message),
  notFound: (message = '资源不存在') => new AppError('NOT_FOUND', message),
  conflict: (message: string, details?: unknown) => new AppError('CONFLICT', message, details),
  stock: (message = '库存不足', details?: unknown) => new AppError('STOCK_INSUFFICIENT', message, details),
  invalidState: (message: string, details?: unknown) => new AppError('INVALID_STATE', message, details),
  quantity: (message: string, details?: unknown) => new AppError('QUANTITY_EXCEEDED', message, details),
  feature: (message: string) => new AppError('FEATURE_NOT_ENABLED', message),
  notFoundOrForbidden: (message = '资源不存在或无权访问') => new AppError('NOT_FOUND', message)
};

export function toPublicError(error: unknown): {
  status: number;
  body: { error: { code: ErrorCode; message: string; details?: unknown } };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      }
    };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: '系统内部错误，请稍后重试并联系管理员' } }
  };
}
