const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly unknown: boolean;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    unknown?: boolean;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
    this.unknown = input.unknown ?? false;
  }
}

export class UnknownResultError extends Error {
  readonly unknown = true;
  constructor(message = '网络中断，提交结果未知') {
    super(message);
    this.name = 'UnknownResultError';
  }
}

interface Envelope<T> {
  data: T;
  requestId?: string;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: ErrorEnvelope | null = null;
  try {
    payload = (await response.json()) as ErrorEnvelope;
  } catch {
    payload = null;
  }
  const unknown = response.status >= 500;
  return new ApiError({
    status: response.status,
    code: payload?.error?.code ?? (unknown ? 'INTERNAL_ERROR' : 'HTTP_ERROR'),
    message:
      payload?.error?.message ??
      (unknown ? '服务暂时不可用，写入结果未知，请勿重复提交' : `请求失败（HTTP ${response.status}）`),
    details: payload?.error?.details,
    requestId: payload?.requestId,
    unknown
  });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    });
  } catch {
    throw new UnknownResultError();
  }
  if (response.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as Envelope<T>;
  return payload.data;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    });
  },
  patch<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    });
  },
  delete<T>(path: string, idempotencyKey?: string): Promise<T> {
    return request<T>(path, {
      method: 'DELETE',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    });
  },
  async upload<T>(path: string, file: File, idempotencyKey?: string): Promise<T> {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<T>(path, {
      method: 'POST',
      body: form,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
    });
  },
  async download(path: string): Promise<{ blob: Blob; filename: string }> {
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`, { credentials: 'include' });
    } catch {
      throw new UnknownResultError('网络中断，无法下载');
    }
    if (!response.ok) throw await parseError(response);
    const disposition = response.headers.get('content-disposition') ?? '';
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const ascii = /filename="([^"]+)"/i.exec(disposition)?.[1];
    return {
      blob: await response.blob(),
      filename: utf8 ? decodeURIComponent(utf8) : ascii ?? 'download'
    };
  }
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof UnknownResultError) return error.message;
  if (error instanceof Error) return error.message;
  return '发生未知错误';
}

export function isUnknownResult(error: unknown): boolean {
  return (
    error instanceof UnknownResultError ||
    (error instanceof ApiError && error.unknown)
  );
}
