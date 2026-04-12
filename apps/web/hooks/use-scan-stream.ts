'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export type ScanStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ScanStreamState = {
  status: ScanStatus;
  progress: number;
  step: string | null;
  error?: string;
};

const TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled']);
const POLL_INTERVAL = 3_000;

interface ScanPollResponse {
  status: ScanStatus;
  progress_pct: number;
  current_step: string | null;
  error_message?: string | null;
}

export function useScanStream(
  scanId: string,
  token: string,
): ScanStreamState {
  const [state, setState] = useState<ScanStreamState>({
    status: 'queued',
    progress: 0,
    step: null,
  });
  const polling = useRef(false);

  useEffect(() => {
    if (!scanId || !token) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // --- Polling fallback ---
    function startPolling() {
      if (polling.current || cancelled) return;
      polling.current = true;

      const poll = async () => {
        if (cancelled) return;
        try {
          const data = await apiClient<ScanPollResponse>(`/scans/${scanId}`, { token });
          if (cancelled) return;
          setState({
            status: data.status,
            progress: data.progress_pct ?? 0,
            step: data.current_step ?? null,
            error: data.error_message ?? undefined,
          });
          if (TERMINAL.has(data.status) && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch {
          // ignore poll errors, will retry
        }
      };

      void poll();
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL);
    }

    // --- Try SSE first ---
    try {
      const url = `/api/v1/scans/${scanId}/stream?access_token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      let sseOpened = false;

      es.onopen = () => {
        sseOpened = true;
      };

      es.addEventListener('state', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as Partial<ScanStreamState>;
        setState((s) => ({ ...s, ...data }));
      });

      es.addEventListener('progress', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as {
          pct: number;
          step: string;
        };
        setState((s) => ({
          ...s,
          status: 'running',
          progress: data.pct,
          step: data.step,
        }));
      });

      es.addEventListener('done', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as {
          status: ScanStatus;
          error?: string;
        };
        setState((s) => ({
          ...s,
          status: data.status,
          progress: 100,
          error: data.error,
        }));
        es?.close();
      });

      es.onerror = () => {
        es?.close();
        es = null;
        // If SSE never connected (e.g. mixed content, proxy doesn't support streaming),
        // fall back to polling
        if (!sseOpened) {
          startPolling();
        }
      };
    } catch {
      // EventSource constructor failed — fall back to polling
      startPolling();
    }

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [scanId, token]);

  return state;
}
