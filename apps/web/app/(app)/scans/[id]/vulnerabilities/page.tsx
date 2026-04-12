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
// Severity config — Sovereign Terminal palette
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; badgeClass: string; filterClass: string; activeClass: string }
> = {
  critical: {
    label: 'Kritikus',
    badgeClass: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical',
    filterClass:
      'border-severity-critical/20 bg-severity-critical/5 text-severity-critical/80 hover:bg-severity-critical/10',
    activeClass:
      'border-severity-critical/50 bg-severity-critical/20 text-severity-critical',
  },
  high: {
    label: 'Magas',
    badgeClass: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
    filterClass:
      'border-severity-high/20 bg-severity-high/5 text-severity-high/80 hover:bg-severity-high/10',
    activeClass:
      'border-severity-high/50 bg-severity-high/20 text-severity-high',
  },
  medium: {
    label: 'Közepes',
    badgeClass: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
    filterClass:
      'border-severity-medium/20 bg-severity-medium/5 text-severity-medium/80 hover:bg-severity-medium/10',
    activeClass:
      'border-severity-medium/50 bg-severity-medium/20 text-severity-medium',
  },
  low: {
    label: 'Alacsony',
    badgeClass: 'border-severity-low/30 bg-severity-low/10 text-severity-low',
    filterClass:
      'border-severity-low/20 bg-severity-low/5 text-severity-low/80 hover:bg-severity-low/10',
    activeClass:
      'border-severity-low/50 bg-severity-low/20 text-severity-low',
  },
  info: {
    label: 'Információs',
    badgeClass: 'border-severity-info/30 bg-severity-info/10 text-severity-info',
    filterClass:
      'border-severity-info/20 bg-severity-info/5 text-severity-info/80 hover:bg-severity-info/10',
    activeClass:
      'border-severity-info/50 bg-severity-info/20 text-severity-info',
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
        'inline-flex shrink-0 items-center border px-2.5 py-0.5 text-xs font-semibold',
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
        className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálathoz
      </Link>

      {/* Heading */}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Találatok
        </h1>
        {!loading && meta && (
          <p className="font-mono text-sm text-onSurface-variant">
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
            'inline-flex items-center gap-1.5 border px-3 py-1 text-sm font-medium transition-colors',
            activeSeverity === null
              ? 'border-onSurface/30 bg-surface-high text-onSurface'
              : 'border-outline-variant/30 bg-transparent text-onSurface-variant hover:bg-surface-high hover:text-onSurface',
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
                'inline-flex items-center gap-1.5 border px-3 py-1 text-sm font-medium transition-colors',
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
            <div key={i} className="h-24 animate-pulse bg-surface-low" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && vulns.length === 0 && (
        <div className="border border-outline-variant/20 py-12 text-center">
          <p className="text-sm text-onSurface-variant">
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
        <div className="flex items-center justify-between border-t border-outline-variant/20 pt-4">
          <p className="font-mono text-sm text-onSurface-variant">
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
    <Card className="transition-colors hover:bg-surface-mid">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <SeverityBadge severity={vuln.severity} />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-snug text-onSurface">{vuln.title}</h3>
            {vuln.description && (
              <p className="mt-1 line-clamp-2 text-sm text-onSurface-variant">
                {vuln.description}
              </p>
            )}
          </div>
          <Link
            href={`/scans/${scanId}/vulnerabilities/${vuln.id}`}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-pulse underline-offset-4 hover:underline"
          >
            Részletek
            <ExternalLink className="size-3.5" />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-onSurface-variant">
          {vuln.template_id && (
            <span className="font-mono">{vuln.template_id}</span>
          )}
          {vuln.matched_url && (
            <span className="max-w-xs truncate font-mono">{vuln.matched_url}</span>
          )}
          {vuln.source_agent && (
            <span>
              Forrás:{' '}
              <span className="font-medium text-onSurface">
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
              <span className="text-xs text-onSurface-variant">
                +{vuln.tags.length - 8} további
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
