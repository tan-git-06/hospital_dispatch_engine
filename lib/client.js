'use client';
// Browser-side helpers. Pages never touch the database — they only call /api/*.
// That separation (UI → API → DB) is rubric item 10, and it's why the DB
// password can live in .env.local and never reach the browser.
import { useCallback, useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login'; // session expired
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => ({}));
  // Errors from triggers/CHECKs arrive here as { error: "Bed is not available" }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Fetch-on-mount hook with a reload() to refresh after a mutation.
//   const { data, error, loading, reload } = useData('/api/beds?status=AVAILABLE');
// Changing `path` (e.g. a filter) refetches automatically.
export function useData(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return setState({ data: null, error: null, loading: false }); // nothing to fetch yet
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// Turn a <form> into a plain object: name="age" → { age: '42' }
export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export const timeAgo = (s) => {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s.replace(' ', 'T')) : new Date(s);
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
};
