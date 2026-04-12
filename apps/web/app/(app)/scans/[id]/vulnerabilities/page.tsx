'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Vulnerability {
  id: string;
  scan_job_id: string;
  title: string;
  description: string | null;
  severity: Severity;
  template_id: string | null;
  source_agent: 'passive' | 'nuclei' | null;
  tags: string[] | null;
  matched_url: string | null;
  created_at: string;
}

interface VulnerabilitiesResponse {
  data: Vulnerability[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; badgeClass: string; filterClass: string; activeClass: string }
> = {
  critical: {
    label: 'Kritikus',
    badgeClass: 'border-red-200 bg-red-100 text-red-800',
    filterClass:
      'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    activeClass: 'border-red-400 bg-red-500 text-white hover:bg-red-600',
  },
  high: {
    label: 'Magas',
    badgeClass: 'border-orange-200 bg-orange-100 text-orange-800',
    filterClass:
      'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100',
    activeClass:
      'border-orange-400 bg-orange-500 text-white hover:bg-orange-600',
  },
  medium: {
    label: 'Közepes',
    badgeClass: 'border-yellow-200 bg-yellow-100 text-yellow-800',
    filterClass:
      'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100',
    activeClass:
      'border-yellow-400 bg-yellow-500 text-white hover:bg-yellow-600',
  },
  low: {
    label: 'Alacsony',
    badgeClass: 'border-blue-200 bg-blue-100 text-blue-800',
    filterClass:
      'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    activeClass: 'border-blue-400 bg-blue-500 text-white hover:bg-blue-600',
  },
  info: {
    label: 'Információs',
    badgeClass: 'border-gray-200 bg-gray-100 text-gray-700',
    filterClass:
      'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100',
    activeClass: 'border-gray-400 bg-gray-500 text-white hover:bg-gray-600',
  },
};

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        cfg.badgeClass,
      )}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function VulnerabilitiesPage() {
  const params = useParams();
  const router = useRouter();
  const scanId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [meta, setMeta] = useState<VulnerabilitiesResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSeverity, setActiveSeverity] = useState<Severity | null>(null);
  const [page, setPage] = useState(1);

  // Severity counts derived from current full list (page 1, no filter)
  const [allCounts, setAllCounts] = useState<Partial<Record<Severity, number>>>({});

  // Resolve session
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

  // Fetch vulnerabilities (with optional severity filter + pagination)
  const fetchVulns = useCallback(
    async (t: string, severity: Severity | null, p: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ page: String(p), limit: '50' });
        if (severity) qs.set('severity', severity);
        const res = await apiClient<VulnerabilitiesResponse>(
          `/scans/${scanId}/vulnerabilities?${qs.toString()}`,
          { token: t },
        );
        setVulns(res.data);
        setMeta(res.meta);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'API hiba');
      } finally {
        setLoading(false);
      }
    },
    [scanId],
  );

  // Fetch unfiltered counts once on mount
  const fetchAllCounts = useCallback(
    async (t: string) => {
      try {
        const res = await apiClient<VulnerabilitiesResponse>(
          `/scans/${scanId}/vulnerabilities?page=1&limit=500`,
          { token: t },
        );
        const counts: Partial<Record<Severity, number>> = {};
        for (const v of res.data) {
          counts[v.severity] = (counts[v.severity] ?? 0) + 1;
        }
        setAllCounts(counts);
      } catch {
        // non-critical
      }
    },
    [scanId],
  );

  useEffect(() => {
    if (!token) return;
    fetchAllCounts(token);
  }, [token, fetchAllCounts]);

  useEffect(() => {
    if (!token) return;
    fetchVulns(token, activeSeverity, page);
  }, [token, activeSeverity, page, fetchVulns]);

  const handleSeverityFilter = (sev: Severity | null) => {
    setActiveSeverity(sev);
    setPage(1);
  };

  const totalFindings = Object.values(allCounts).reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href={`/scans/${scanId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálathoz
      </Link>

      {/* Heading */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Találatok</h1>
        {!loading && meta && (
          <p className="text-sm text-muted-foreground">
            {activeSeverity
              ? `${meta.total} találat — szűrve: ${SEVERITY_CONFIG[activeSeverity].label}`
              : `${totalFindings} találat összesen`}
          </p>
        )}
      </div>

      {/* Severity filter buttons */}
      <div className="flex flex-wrap gap-2">
        {/* All */}
        <button
          onClick={() => handleSeverityFilter(null)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
            activeSeverity === null
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-background text-foreground hover:bg-muted',
          )}
        >
          <span className="tabular-nums">{totalFindings}</span>
          Összes
        </button>

        {SEVERITY_ORDER.map((sev) => {
          const count = allCounts[sev] ?? 0;
          if (count === 0) return null;
          const cfg = SEVERITY_CONFIG[sev];
          const isActive = activeSeverity === sev;
          return (
            <button
              key={sev}
              onClick={() => handleSeverityFilter(sev)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                isActive ? cfg.activeClass : cfg.filterClass,
              )}
            >
              <span className="font-bold tabular-nums">{count}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && vulns.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {activeSeverity
              ? 'Nincs találat a kiválasztott szűrovel.'
              : 'Nem találtunk sérülékenységet ehhez a vizsgálathoz.'}
          </p>
        </div>
      )}

      {/* Vulnerability list */}
      {!loading && !error && vulns.length > 0 && (
        <div className="flex flex-col gap-3">
          {vulns.map((vuln) => (
            <VulnCard key={vuln.id} vuln={vuln} scanId={scanId} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && meta && meta.pages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {page}. oldal / {meta.pages} ({meta.total} találat)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
              Előző
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.pages}
              onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}
            >
              Következő
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vuln card
// ---------------------------------------------------------------------------

function VulnCard({ vuln, scanId }: { vuln: Vulnerability; scanId: string }) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <SeverityBadge severity={vuln.severity} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-snug">{vuln.title}</h3>
            {vuln.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {vuln.description}
              </p>
            )}
          </div>
          <Link
            href={`/scans/${scanId}/vulnerabilities/${vuln.id}`}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Részletek
            <ExternalLink className="size-3.5" />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {vuln.template_id && (
            <span className="font-mono">{vuln.template_id}</span>
          )}
          {vuln.matched_url && (
            <span className="max-w-xs truncate font-mono">{vuln.matched_url}</span>
          )}
          {vuln.source_agent && (
            <span>
              Forrás:{' '}
              <span className="font-medium">
                {vuln.source_agent === 'passive' ? 'Passzív' : 'Nuclei'}
              </span>
            </span>
          )}
        </div>

        {/* Tags */}
        {vuln.tags && vuln.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {vuln.tags.slice(0, 8).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {vuln.tags.length > 8 && (
              <span className="text-xs text-muted-foreground">
                +{vuln.tags.length - 8} további
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
