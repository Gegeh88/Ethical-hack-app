const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Browser: use relative URL (Next.js rewrite proxies to API, avoids mixed content)
// Server (SSR): use full API_URL directly (faster, no proxy loop)
const isBrowser = typeof window !== 'undefined';

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const baseUrl = isBrowser ? '' : (API_URL ?? '');
  const res = await fetch(`${baseUrl}/api/v1${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `API error ${res.status}`);
  }

  const json = await res.json();

  // API wraps every response in { data: ... } or { data: ..., total: ... }.
  // Unwrap transparently so callers get the shape they expect.
  // For paginated responses ({ data, total }), return as-is since `data` is the array.
  if (json && typeof json === 'object' && 'data' in json && 'total' in json) {
    return json as T;
  }
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }

  return json as T;
}
