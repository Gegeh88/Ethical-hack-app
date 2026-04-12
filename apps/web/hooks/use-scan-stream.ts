'use client';

import { useEffect, useState } from 'react';

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

export function useScanStream(
  scanId: string,
  token: string,
): ScanStreamState {
  const [state, setState] = useState<ScanStreamState>({
    status: 'queued',
    progress: 0,
    step: null,
  });

  useEffect(() => {
    if (!scanId || !token) return;

    const url = `/api/v1/scans/${scanId}/stream?access_token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

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
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [scanId, token]);

  return state;
}
