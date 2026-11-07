import { useCallback, useEffect, useRef, useState } from 'react';
import { initData, devUser } from './tg';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (initData) headers['x-init-data'] = initData;
  else if (devUser) headers['x-dev-user'] = devUser;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'error');
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/**
 * Loads a resource and keeps it fresh: polls every few seconds while the app is visible,
 * so the partner's changes show up without reloads.
 */
export function useResource<T>(path: string | null, intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await get<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);

  useEffect(() => {
    setData(null);
    load();
    if (!path) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, intervalMs);
    const onVis = () => !document.hidden && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [path, intervalMs, load]);

  return { data, error, reload: load, setData };
}
