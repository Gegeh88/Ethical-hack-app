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
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; badgeClass: string }
> = {
  critical: {
    label: 'Kritikus',
    badgeClass: 'border-red-300 bg-red-100 text-red-800',
  },
  high: {
    label: 'Magas',
    badgeClass: 'border-orange-300 bg-orange-100 text-orange-800',
  },
  medium: {
    label: 'Közepes',
    badgeClass: 'border-yellow-300 bg-yellow-100 text-yellow-800',
  },
  low: {
    label: 'Alacsony',
    badgeClass: 'border-blue-300 bg-blue-100 text-blue-800',
  },
  info: {
    label: 'Információs',
    badgeClass: 'border-gray-300 bg-gray-100 text-gray-700',
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
        'inline-flex shrink-0 items-center rounded-full border font-semibold',
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

  const severityCfg = SEVERITY_CONFIG[vuln.severity];

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href={`/scans/${scanId}/vulnerabilities`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a találatokhoz
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3">
        <SeverityBadge severity={vuln.severity} size="large" />
        <h1 className="text-2xl font-bold leading-tight tracking-tight">
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
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Leírás
              </p>
              <p className="text-sm leading-relaxed">{vuln.description}</p>
            </div>
          )}

          {/* Key-value metadata grid */}
          <div className="grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-2 text-sm">
            {vuln.template_id && (
              <>
                <span className="text-muted-foreground">Sablonok</span>
                <span className="font-mono text-xs">{vuln.template_id}</span>
              </>
            )}

            {vuln.source_agent && (
              <>
                <span className="text-muted-foreground">Forrás</span>
                <span>
                  {vuln.source_agent === 'passive' ? 'Passzív vizsgálat' : 'Nuclei'}
                </span>
              </>
            )}

            {vuln.cvss_score !== null && vuln.cvss_score !== undefined && (
              <>
                <span className="text-muted-foreground">CVSS</span>
                <span className="font-mono font-semibold">
                  {vuln.cvss_score.toFixed(1)}
                </span>
              </>
            )}

            {vuln.matched_url && (
              <>
                <span className="text-muted-foreground">Érintett URL</span>
                <span className="break-all font-mono text-xs">
                  {vuln.matched_url}
                </span>
              </>
            )}

            <>
              <span className="text-muted-foreground">Rögzítve</span>
              <span>{formatDate(vuln.created_at)}</span>
            </>
          </div>

          {/* CVE IDs */}
          {vuln.cve_ids && vuln.cve_ids.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                CVE azonosítók
              </p>
              <div className="flex flex-wrap gap-2">
                {vuln.cve_ids.map((cve) => (
                  <a
                    key={cve}
                    href={`https://nvd.nist.gov/vuln/detail/${cve}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs hover:bg-muted/80 hover:underline"
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
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
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
                <h3 className="font-semibold">Mi ez?</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {vuln.ai_explanation.what_is_it}
                </p>
              </div>
            )}

            {vuln.ai_explanation.why_dangerous && (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">Miért veszélyes?</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {vuln.ai_explanation.why_dangerous}
                </p>
              </div>
            )}

            {vuln.ai_explanation.fix_suggestions &&
              vuln.ai_explanation.fix_suggestions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="font-semibold">Javítási javaslatok</h3>
                  <ul className="flex flex-col gap-2">
                    {vuln.ai_explanation.fix_suggestions.map((suggestion, i) => (
                      <li
                        key={i}
                        className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
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
