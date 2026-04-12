import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface AiExplanation {
  what_is_it?: string;
  why_dangerous?: string;
  fix_suggestions?: string[];
}

interface VulnerabilityDetail {
  id: string;
  scan_job_id: string;
  title: string;
  description: string | null;
  severity: Severity;
  template_id: string | null;
  source_agent: 'passive' | 'nuclei' | null;
  cvss_score: number | null;
  cve_ids: string[] | null;
  tags: string[] | null;
  matched_url: string | null;
  evidence: Record<string, unknown> | null;
  ai_explanation: AiExplanation | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Severity config — Sovereign Terminal palette
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; badgeClass: string }
> = {
  critical: {
    label: 'Kritikus',
    badgeClass: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical',
  },
  high: {
    label: 'Magas',
    badgeClass: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
  },
  medium: {
    label: 'Közepes',
    badgeClass: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
  },
  low: {
    label: 'Alacsony',
    badgeClass: 'border-severity-low/30 bg-severity-low/10 text-severity-low',
  },
  info: {
    label: 'Információs',
    badgeClass: 'border-severity-info/30 bg-severity-info/10 text-severity-info',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function SeverityBadge({
  severity,
  size = 'default',
}: {
  severity: Severity;
  size?: 'default' | 'large';
}) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border font-semibold',
        size === 'large' ? 'px-4 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs',
        cfg.badgeClass,
      )}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page — Server Component
// ---------------------------------------------------------------------------

export default async function VulnerabilityDetailPage({
  params,
}: {
  params: Promise<{ id: string; vulnId: string }>;
}) {
  const { id: scanId, vulnId } = await params;

  // Resolve session token server-side
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // middleware should handle this, but guard anyway
    notFound();
  }

  let vuln: VulnerabilityDetail;
  try {
    vuln = await apiClient<VulnerabilityDetail>(`/vulnerabilities/${vulnId}`, {
      token: session.access_token,
    });
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href={`/scans/${scanId}/vulnerabilities`}
        className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
      >
        <ArrowLeft className="size-4" />
        Vissza a találatokhoz
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3">
        <SeverityBadge severity={vuln.severity} size="large" />
        <h1 className="font-display text-2xl font-bold leading-tight text-onSurface">
          {vuln.title}
        </h1>
      </div>

      {/* Main details card */}
      <Card>
        <CardHeader>
          <CardTitle>Részletek</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Description */}
          {vuln.description && (
            <div className="flex flex-col gap-1.5">
              <p className="font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                Leírás
              </p>
              <p className="text-sm leading-relaxed text-onSurface">{vuln.description}</p>
            </div>
          )}

          {/* Key-value metadata grid */}
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-2 text-sm">
            {vuln.template_id && (
              <>
                <span className="text-onSurface-variant">Sablon</span>
                <span className="font-mono text-xs text-onSurface">{vuln.template_id}</span>
              </>
            )}

            {vuln.source_agent && (
              <>
                <span className="text-onSurface-variant">Forrás</span>
                <span className="text-onSurface">
                  {vuln.source_agent === 'passive' ? 'Passzív vizsgálat' : 'Nuclei'}
                </span>
              </>
            )}

            {vuln.cvss_score !== null && vuln.cvss_score !== undefined && (
              <>
                <span className="text-onSurface-variant">CVSS</span>
                <span className="font-mono font-semibold text-onSurface">
                  {vuln.cvss_score.toFixed(1)}
                </span>
              </>
            )}

            {vuln.matched_url && (
              <>
                <span className="text-onSurface-variant">Érintett URL</span>
                <span className="break-all font-mono text-xs text-onSurface">
                  {vuln.matched_url}
                </span>
              </>
            )}

            <>
              <span className="text-onSurface-variant">Rögzítve</span>
              <span className="font-mono text-onSurface">{formatDate(vuln.created_at)}</span>
            </>
          </div>

          {/* CVE IDs */}
          {vuln.cve_ids && vuln.cve_ids.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                CVE azonosítók
              </p>
              <div className="flex flex-wrap gap-2">
                {vuln.cve_ids.map((cve) => (
                  <a
                    key={cve}
                    href={`https://nvd.nist.gov/vuln/detail/${cve}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center border border-outline-variant/30 bg-surface-high px-2 py-0.5 font-mono text-xs text-onSurface hover:border-pulse/30 hover:text-pulse"
                  >
                    {cve}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {vuln.tags && vuln.tags.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                Címkék
              </p>
              <div className="flex flex-wrap gap-1.5">
                {vuln.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidence card */}
      {vuln.evidence && Object.keys(vuln.evidence).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bizonyíték</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto bg-surface-high p-4 font-mono text-xs leading-relaxed text-onSurface">
              {JSON.stringify(vuln.evidence, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* AI Explanation card */}
      {vuln.ai_explanation && (
        <Card>
          <CardHeader>
            <CardTitle>AI magyarázat</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {vuln.ai_explanation.what_is_it && (
              <div className="flex flex-col gap-2">
                <h3 className="font-display font-semibold text-onSurface">Mi ez?</h3>
                <p className="text-sm leading-relaxed text-onSurface-variant">
                  {vuln.ai_explanation.what_is_it}
                </p>
              </div>
            )}

            {vuln.ai_explanation.why_dangerous && (
              <div className="flex flex-col gap-2">
                <h3 className="font-display font-semibold text-onSurface">Miért veszélyes?</h3>
                <p className="text-sm leading-relaxed text-onSurface-variant">
                  {vuln.ai_explanation.why_dangerous}
                </p>
              </div>
            )}

            {vuln.ai_explanation.fix_suggestions &&
              vuln.ai_explanation.fix_suggestions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="font-display font-semibold text-onSurface">Javítási javaslatok</h3>
                  <ul className="flex flex-col gap-2">
                    {vuln.ai_explanation.fix_suggestions.map((suggestion, i) => (
                      <li
                        key={i}
                        className="flex gap-3 text-sm leading-relaxed text-onSurface-variant"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center bg-pulse/10 text-xs font-semibold text-pulse">
                          {i + 1}
                        </span>
                        <span>{suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
