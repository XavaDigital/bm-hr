export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

/** Session-cookie fetch wrapper. Throws ApiError on non-2xx. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
    issues?: { path: string; message: string }[];
  };
  if (!res.ok) {
    if (res.status === 401 && body.code === 'NO_SESSION') window.dispatchEvent(new Event('hr:signed-out'));
    throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`, body.code, body.issues);
  }
  return body as T;
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues?.length) return err.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
