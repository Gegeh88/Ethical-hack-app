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
  critical: { label: 'Kritikus', className: 'bg-red-100 text-red-800 border-red-200' },
  high: { label: 'Magas', className: 'bg-orange-100 text-orange-800 border-orange-200' },
  medium: { label: 'Közepes', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  low: { label: 'Alacsony', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  info: { label: 'Info', className: 'bg-gray-100 text-gray-700 border-gray-200' },
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
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/scans"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Vissza a vizsgálatokhoz
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálatokhoz
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-mono text-2xl font-bold tracking-tight">
            {scan.domain?.host ?? scan.domain_id}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {typeLabel(scan.type)}
            </span>
            <span className="text-muted-foreground">·</span>
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
              <span className="text-muted-foreground">
                {displayStatus === 'completed'
                  ? 'Befejezve'
                  : displayStatus === 'failed'
                    ? 'Sikertelen'
                    : displayStatus === 'cancelled'
                      ? 'Megszakítva'
                      : stepLabel(displayStep ?? null)}
              </span>
              <span className="font-medium tabular-nums">{displayProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  displayStatus === 'running' && 'bg-blue-500',
                  displayStatus === 'completed' && 'bg-emerald-500',
                  displayStatus === 'failed' && 'bg-destructive',
                  displayStatus === 'cancelled' && 'bg-muted-foreground',
                  displayStatus === 'queued' && 'bg-muted-foreground/40',
                )}
                style={{ width: `${displayProgress}%` }}
              />
            </div>
          </div>

          {/* Running indicator */}
          {displayStatus === 'running' && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Loader2 className="size-4 animate-spin" />
              A vizsgálat folyamatban van...
            </div>
          )}

          {/* Completed */}
          {displayStatus === 'completed' && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle className="size-4" />
              A vizsgálat sikeresen befejezodott.
            </div>
          )}

          {/* Failed */}
          {displayStatus === 'failed' && displayError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Hiba történt a vizsgálat során:</p>
                <p className="mt-0.5 font-mono text-xs">{displayError}</p>
              </div>
            </div>
          )}

          {/* Queued */}
          {displayStatus === 'queued' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
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
                <span className="text-sm text-muted-foreground">
                  Nem találtunk sérülékenységet.
                </span>
              )}
            </div>

            {/* Executive summary */}
            {report.summary_hu && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  AI összefoglaló
                </p>
                <p className="text-sm leading-relaxed">{report.summary_hu}</p>
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
            <span className="text-muted-foreground">Azonosító</span>
            <span className="font-mono text-xs">{scan.id}</span>
            <span className="text-muted-foreground">Domain</span>
            <span className="font-mono">{scan.domain?.host ?? scan.domain_id}</span>
            <span className="text-muted-foreground">Típus</span>
            <span>{typeLabel(scan.type)}</span>
            <span className="text-muted-foreground">Állapot</span>
            <StatusIndicator status={displayStatus} />
            <span className="text-muted-foreground">Sorba állítva</span>
            <span>{formatDate(scan.queued_at)}</span>
            {scan.started_at && (
              <>
                <span className="text-muted-foreground">Elindítva</span>
                <span>{formatDate(scan.started_at)}</span>
              </>
            )}
            {scan.completed_at && (
              <>
                <span className="text-muted-foreground">Befejezve</span>
                <span>{formatDate(scan.completed_at)}</span>
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
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
          Fut
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          Kész
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
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
