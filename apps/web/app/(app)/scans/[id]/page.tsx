'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';
import { useScanStream } from '@/hooks/use-scan-stream';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, AlertCircle, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Domain {
  id: string;
  host: string;
}

interface ScanJob {
  id: string;
  domain_id: string;
  domain?: Domain;
  type: 'passive' | 'active' | 'full';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  current_step: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface SeverityCounts {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}

interface Report {
  id: string;
  finding_count: number;
  severity_counts: SeverityCounts;
  summary_hu: string | null;
  pdf_url: string | null;
}

interface ScanDetailResponse extends ScanJob {
  report?: Report;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function typeLabel(type: ScanJob['type']): string {
  const labels: Record<ScanJob['type'], string> = {
    passive: 'Passzív vizsgálat',
    active: 'Aktív vizsgálat',
    full: 'Teljes vizsgálat',
  };
  return labels[type] ?? type;
}

function stepLabel(step: string | null): string {
  if (!step) return 'Előkészítés...';
  const labels: Record<string, string> = {
    passive: 'Passzív vizsgálat...',
    active: 'Aktív vizsgálat...',
    nuclei: 'Nuclei vizsgálat...',
    reporting: 'Jelentés generálása...',
    ssl: 'SSL ellenőrzés...',
    dns: 'DNS ellenőrzés...',
    headers: 'HTTP fejlécek ellenőrzése...',
    ports: 'Nyílt portok keresése...',
  };
  return labels[step] ?? step;
}

const SEVERITY_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  critical: {
    label: 'Kritikus',
    className: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical',
  },
  high: {
    label: 'Magas',
    className: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
  },
  medium: {
    label: 'Közepes',
    className: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
  },
  low: {
    label: 'Alacsony',
    className: 'border-severity-low/30 bg-severity-low/10 text-severity-low',
  },
  info: {
    label: 'Info',
    className: 'border-severity-info/30 bg-severity-info/10 text-severity-info',
  },
};

export default function ScanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scanId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanDetailResponse | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Resolve session token
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      setToken(session.access_token);
    });
  }, [router]);

  // Fetch initial scan data
  const fetchScan = useCallback(async (t: string) => {
    try {
      const res = await apiClient<ScanDetailResponse>(`/scans/${scanId}`, {
        token: t,
      });
      setScan(res);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'API hiba');
    } finally {
      setLoadingInitial(false);
    }
  }, [scanId]);

  useEffect(() => {
    if (!token) return;
    fetchScan(token);
  }, [token, fetchScan]);

  // SSE live updates — only stream when we have a token and the scan is active
  const isActive =
    scan?.status === 'queued' || scan?.status === 'running';

  const streamState = useScanStream(
    isActive && token ? scanId : '',
    token ?? '',
  );

  // When SSE reports completion, refetch for findings summary
  useEffect(() => {
    if (!token) return;
    if (
      streamState.status === 'completed' ||
      streamState.status === 'failed' ||
      streamState.status === 'cancelled'
    ) {
      fetchScan(token);
    }
  }, [streamState.status, token, fetchScan]);

  // Merge live stream state into displayed scan
  const displayStatus = isActive ? streamState.status : scan?.status ?? 'queued';
  const displayProgress = isActive
    ? streamState.progress
    : scan?.progress ?? 0;
  const displayStep = isActive ? streamState.step : scan?.current_step;
  const displayError = isActive ? streamState.error : scan?.error_message ?? undefined;

  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-5 w-32 animate-pulse bg-surface-high" />
        <div className="h-8 w-64 animate-pulse bg-surface-high" />
        <div className="h-40 animate-pulse bg-surface-low" />
        <div className="h-32 animate-pulse bg-surface-low" />
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/scans"
          className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
        >
          <ArrowLeft className="size-4" />
          Vissza a vizsgálatokhoz
        </Link>
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {initError}
        </div>
      </div>
    );
  }

  if (!scan) return null;

  const report = scan.report;
  const severityCounts = report?.severity_counts ?? {};
  const totalFindings = report?.finding_count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href="/scans"
        className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálatokhoz
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-mono text-2xl font-bold text-onSurface">
            {scan.domain?.host ?? scan.domain_id}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-onSurface-variant">
              {typeLabel(scan.type)}
            </span>
            <span className="text-onSurface-variant">·</span>
            <StatusIndicator status={displayStatus} />
          </div>
        </div>
      </div>

      {/* Progress card */}
      <Card>
        <CardHeader>
          <CardTitle>Vizsgálat állapota</CardTitle>
          {scan.queued_at && (
            <CardDescription>
              Indítva: {formatDate(scan.queued_at)}
              {scan.completed_at && (
                <> · Befejezve: {formatDate(scan.completed_at)}</>
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Progress bar */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-onSurface-variant">
                {displayStatus === 'completed'
                  ? 'Befejezve'
                  : displayStatus === 'failed'
                    ? 'Sikertelen'
                    : displayStatus === 'cancelled'
                      ? 'Megszakítva'
                      : stepLabel(displayStep ?? null)}
              </span>
              <span className="font-mono text-xs font-medium text-onSurface tabular-nums">
                {displayProgress}%
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden bg-surface-high">
              <div
                className={cn(
                  'h-full transition-all duration-500',
                  displayStatus === 'running' && 'bg-pulse',
                  displayStatus === 'completed' && 'bg-pulse',
                  displayStatus === 'failed' && 'bg-severity-critical',
                  displayStatus === 'cancelled' && 'bg-onSurface-variant',
                  displayStatus === 'queued' && 'bg-onSurface-variant/30',
                )}
                style={{ width: `${displayProgress}%` }}
              />
            </div>
          </div>

          {/* Running indicator */}
          {displayStatus === 'running' && (
            <div className="flex items-center gap-2 text-sm text-pulse">
              <Loader2 className="size-4 animate-spin" />
              A vizsgálat folyamatban van...
            </div>
          )}

          {/* Completed */}
          {displayStatus === 'completed' && (
            <div className="flex items-center gap-2 text-sm text-pulse">
              <CheckCircle className="size-4" />
              A vizsgálat sikeresen befejezodott.
            </div>
          )}

          {/* Failed */}
          {displayStatus === 'failed' && displayError && (
            <div className="flex items-start gap-2 border-l-2 border-error bg-error-container/20 p-3 text-sm text-error">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Hiba történt a vizsgálat során:</p>
                <p className="mt-0.5 font-mono text-xs">{displayError}</p>
              </div>
            </div>
          )}

          {/* Queued */}
          {displayStatus === 'queued' && (
            <div className="flex items-center gap-2 text-sm text-onSurface-variant">
              <Clock className="size-4" />
              Várakozás a worker szabad kapacitására...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Findings summary — shown when completed and report is available */}
      {displayStatus === 'completed' && report && (
        <Card>
          <CardHeader>
            <CardTitle>Eredmények összefoglalója</CardTitle>
            <CardDescription>
              {totalFindings} talált sérülékenység
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Severity breakdown */}
            <div className="flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low', 'info'] as const).map(
                (sev) => {
                  const count = severityCounts[sev] ?? 0;
                  if (count === 0) return null;
                  const config = SEVERITY_CONFIG[sev];
                  if (!config) return null;
                  const { label, className } = config;
                  return (
                    <span
                      key={sev}
                      className={cn(
                        'inline-flex items-center gap-1.5 border px-3 py-1 text-sm font-medium',
                        className,
                      )}
                    >
                      <span className="font-bold tabular-nums">{count}</span>
                      {label}
                    </span>
                  );
                },
              )}
              {totalFindings === 0 && (
                <span className="text-sm text-onSurface-variant">
                  Nem találtunk sérülékenységet.
                </span>
              )}
            </div>

            {/* Link to vulnerabilities list */}
            {totalFindings > 0 && (
              <div>
                <Button
                  variant="default"
                  size="sm"
                  render={<Link href={`/scans/${scanId}/vulnerabilities`} />}
                >
                  Találatok megtekintése
                </Button>
              </div>
            )}

            {/* Executive summary */}
            {report.summary_hu && (
              <div className="border-l-2 border-outline-variant/40 bg-surface-mid p-4">
                <p className="mb-2 font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                  AI összefoglaló
                </p>
                <p className="text-sm leading-relaxed text-onSurface">{report.summary_hu}</p>
              </div>
            )}

            {/* PDF download */}
            {report.pdf_url && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${report.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Jelentés letöltése (PDF)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Scan metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Vizsgálat adatai</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 text-sm">
            <span className="text-onSurface-variant">Azonosító</span>
            <span className="font-mono text-xs text-onSurface">{scan.id}</span>
            <span className="text-onSurface-variant">Domain</span>
            <span className="font-mono text-onSurface">{scan.domain?.host ?? scan.domain_id}</span>
            <span className="text-onSurface-variant">Típus</span>
            <span className="text-onSurface">{typeLabel(scan.type)}</span>
            <span className="text-onSurface-variant">Állapot</span>
            <StatusIndicator status={displayStatus} />
            <span className="text-onSurface-variant">Sorba állítva</span>
            <span className="font-mono text-onSurface">{formatDate(scan.queued_at)}</span>
            {scan.started_at && (
              <>
                <span className="text-onSurface-variant">Elindítva</span>
                <span className="font-mono text-onSurface">{formatDate(scan.started_at)}</span>
              </>
            )}
            {scan.completed_at && (
              <>
                <span className="text-onSurface-variant">Befejezve</span>
                <span className="font-mono text-onSurface">{formatDate(scan.completed_at)}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusIndicator({
  status,
}: {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
}) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 border border-pulse/20 bg-pulse/10 px-2.5 py-0.5 text-xs font-medium text-pulse">
          <span className="size-1.5 animate-pulse bg-pulse" />
          Fut
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center border border-pulse/20 bg-pulse/10 px-2.5 py-0.5 text-xs font-medium text-pulse">
          Kész
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center border border-severity-critical/30 bg-severity-critical/10 px-2.5 py-0.5 text-xs font-medium text-severity-critical">
          Sikertelen
        </span>
      );
    case 'cancelled':
      return (
        <Badge variant="outline">Megszakítva</Badge>
      );
    case 'queued':
    default:
      return (
        <Badge variant="secondary">Várakozik</Badge>
      );
  }
}
