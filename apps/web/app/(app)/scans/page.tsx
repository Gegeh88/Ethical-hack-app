import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, ScanSearch } from 'lucide-react';

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
}

interface ScansResponse {
  data: ScanJob[];
  total: number;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function typeLabel(type: ScanJob['type']): string {
  const labels: Record<ScanJob['type'], string> = {
    passive: 'Passzív',
    active: 'Aktív',
    full: 'Teljes',
  };
  return labels[type] ?? type;
}

function statusLabel(
  status: ScanJob['status'],
): { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  switch (status) {
    case 'queued':
      return { text: 'Várakozik', variant: 'secondary' };
    case 'running':
      return { text: 'Fut', variant: 'default' };
    case 'completed':
      return { text: 'Kész', variant: 'default' };
    case 'failed':
      return { text: 'Sikertelen', variant: 'destructive' };
    case 'cancelled':
      return { text: 'Megszakítva', variant: 'outline' };
    default:
      return { text: status, variant: 'secondary' };
  }
}

export default async function ScansPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  let scans: ScanJob[] = [];
  let apiError: string | null = null;

  try {
    const res = await apiClient<ScansResponse>('/scans', {
      token: session.access_token,
    });
    scans = res.data ?? [];
  } catch (err) {
    apiError = err instanceof Error ? err.message : 'API hiba';
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vizsgálatok</h1>
        <Button size="sm" render={<Link href="/scans/new" />}>
          <Plus className="size-4" />
          Új vizsgálat
        </Button>
      </div>

      {apiError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      {!apiError && scans.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <ScanSearch className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Még nem indított vizsgálatot.
            </p>
            <Button size="sm" render={<Link href="/scans/new" />}>
              <Plus className="size-4" />
              Első vizsgálat indítása
            </Button>
          </CardContent>
        </Card>
      )}

      {scans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {scans.length} vizsgálat
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Domain
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Típus
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Állapot
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Haladás
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Indítva
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Műveletek
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((scan) => {
                    const { text, variant } = statusLabel(scan.status);
                    return (
                      <tr
                        key={scan.id}
                        className="border-b border-border last:border-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 font-mono font-medium">
                          <Link
                            href={`/scans/${scan.id}`}
                            className="hover:underline"
                          >
                            {scan.domain?.host ?? scan.domain_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {typeLabel(scan.type)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            status={scan.status}
                            text={text}
                            variant={variant}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className={progressBarClass(scan.status)}
                                style={{ width: `${scan.progress ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {scan.progress ?? 0}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(scan.queued_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            render={<Link href={`/scans/${scan.id}`} />}
                          >
                            Részletek
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  text,
  variant,
}: {
  status: ScanJob['status'];
  text: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
}) {
  // Override color for running (blue) and completed (green) which both map to 'default'
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
        {text}
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        {text}
      </span>
    );
  }
  return <Badge variant={variant}>{text}</Badge>;
}

function progressBarClass(status: ScanJob['status']): string {
  switch (status) {
    case 'running':
      return 'h-full rounded-full bg-blue-500 transition-all duration-500';
    case 'completed':
      return 'h-full rounded-full bg-emerald-500';
    case 'failed':
      return 'h-full rounded-full bg-destructive';
    case 'cancelled':
      return 'h-full rounded-full bg-muted-foreground';
    default:
      return 'h-full rounded-full bg-muted-foreground/40';
  }
}
