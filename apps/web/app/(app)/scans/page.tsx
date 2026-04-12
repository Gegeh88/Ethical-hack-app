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
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Vizsgálatok
        </h1>
        <Button size="sm" render={<Link href="/scans/new" />}>
          <Plus className="size-4" />
          Új vizsgálat
        </Button>
      </div>

      {apiError && (
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {apiError}
        </div>
      )}

      {!apiError && scans.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <ScanSearch className="size-10 text-onSurface-variant/40" />
            <p className="text-sm text-onSurface-variant">
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
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              {scans.length} vizsgálat
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Domain
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Típus
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Állapot
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Haladás
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Indítva
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
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
                        className="border-b border-outline-variant/10 last:border-0 hover:bg-surface-mid"
                      >
                        <td className="px-4 py-3 font-mono font-medium text-onSurface">
                          <Link
                            href={`/scans/${scan.id}`}
                            className="hover:text-pulse hover:underline"
                          >
                            {scan.domain?.host ?? scan.domain_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-onSurface-variant">
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
                            <div className="h-1 w-24 overflow-hidden bg-surface-high">
                              <div
                                className={progressBarClass(scan.status)}
                                style={{ width: `${scan.progress ?? 0}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-onSurface-variant">
                              {scan.progress ?? 0}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-onSurface-variant">
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
  // Running — pulse green with animation
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-pulse/20 bg-pulse/10 px-2 py-0.5 text-xs font-medium text-pulse">
        <span className="size-1.5 animate-pulse bg-pulse" />
        {text}
      </span>
    );
  }
  // Completed — pulse green solid
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center border border-pulse/20 bg-pulse/10 px-2 py-0.5 text-xs font-medium text-pulse">
        {text}
      </span>
    );
  }
  return <Badge variant={variant}>{text}</Badge>;
}

function progressBarClass(status: ScanJob['status']): string {
  switch (status) {
    case 'running':
      return 'h-full bg-pulse transition-all duration-500';
    case 'completed':
      return 'h-full bg-pulse';
    case 'failed':
      return 'h-full bg-severity-critical';
    case 'cancelled':
      return 'h-full bg-onSurface-variant';
    default:
      return 'h-full bg-onSurface-variant/30';
  }
}
