const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...init } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });

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
