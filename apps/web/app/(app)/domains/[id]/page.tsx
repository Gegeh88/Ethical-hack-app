import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';

interface Domain {
  id: string;
  host: string;
  verified_at: string | null;
  verification_method: string | null;
  verification_expires_at: string | null;
  is_shared_hosting: boolean;
  created_at: string;
}

interface VerificationAttempt {
  id: string;
  method: 'dns' | 'meta' | 'file';
  status: 'success' | 'failed' | 'pending';
  checked_at: string;
  error_message: string | null;
}

interface VerificationResponse {
  attempts: VerificationAttempt[];
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

function formatDateShort(iso: string): string {
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    dns: 'DNS TXT rekord',
    meta: 'Meta tag',
    file: 'Fájl',
  };
  return labels[method] ?? method;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    success: 'Sikeres',
    failed: 'Sikertelen',
    pending: 'Folyamatban',
  };
  return labels[status] ?? status;
}

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  let domain: Domain | null = null;
  let verification: VerificationResponse | null = null;
  let domainError: string | null = null;

  try {
    domain = await apiClient<Domain>(`/domains/${id}`, {
      token: session.access_token,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) {
      notFound();
    }
    domainError = err instanceof Error ? err.message : 'API hiba';
  }

  if (domain) {
    try {
      verification = await apiClient<VerificationResponse>(
        `/domains/${id}/verification`,
        { token: session.access_token },
      );
    } catch {
      // Verification history is non-critical — silently ignore if unavailable
    }
  }

  if (domainError) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/domains"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Vissza a domainekhez
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {domainError}
        </div>
      </div>
    );
  }

  if (!domain) return null;

  const isVerified = !!domain.verified_at;
  const attempts = verification?.attempts ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href="/domains"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a domainekhez
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight">
            {domain.host}
          </h1>
          <div className="flex items-center gap-2">
            {isVerified ? (
              <Badge variant="default">Igazolt</Badge>
            ) : (
              <Badge variant="outline">Nem igazolt</Badge>
            )}
            {domain.is_shared_hosting && (
              <Badge variant="secondary">Megosztott hosting</Badge>
            )}
          </div>
        </div>

        {/* Primary action */}
        {isVerified ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/domains/${id}/verify`} />}
          >
            Újra igazolás
          </Button>
        ) : (
          <Button size="sm" render={<Link href={`/domains/${id}/verify`} />}>
            Igazolás indítása
          </Button>
        )}
      </div>

      {/* Detail cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Igazolási állapot</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {isVerified ? (
              <>
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle className="size-4 shrink-0" />
                  <span>Igazolva</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground">Módszer</span>
                  <span>{methodLabel(domain.verification_method ?? '')}</span>
                  <span className="text-muted-foreground">Igazolva</span>
                  <span>{formatDate(domain.verified_at!)}</span>
                  {domain.verification_expires_at && (
                    <>
                      <span className="text-muted-foreground">
                        Token lejárata
                      </span>
                      <span>
                        {formatDate(domain.verification_expires_at)}
                      </span>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="size-4 shrink-0" />
                <span>Még nem igazolt</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Domain adatok</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Host</span>
              <span className="font-mono">{domain.host}</span>
              <span className="text-muted-foreground">Megosztott hosting</span>
              <span>{domain.is_shared_hosting ? 'Igen' : 'Nem'}</span>
              <span className="text-muted-foreground">Hozzáadva</span>
              <span>{formatDateShort(domain.created_at)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Verification history */}
      <Card>
        <CardHeader>
          <CardTitle>Igazolási előzmények</CardTitle>
          <CardDescription>
            A domain igazolási kísérletek listája
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {attempts.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              Még nem volt igazolási kísérlet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Módszer
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Eredmény
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Dátum
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Részletek
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => (
                    <tr
                      key={attempt.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        {methodLabel(attempt.method)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            attempt.status === 'success'
                              ? 'flex items-center gap-1.5 text-emerald-600'
                              : attempt.status === 'failed'
                                ? 'flex items-center gap-1.5 text-destructive'
                                : 'flex items-center gap-1.5 text-muted-foreground'
                          }
                        >
                          {attempt.status === 'success' && (
                            <CheckCircle className="size-3.5" />
                          )}
                          {attempt.status === 'failed' && (
                            <XCircle className="size-3.5" />
                          )}
                          {attempt.status === 'pending' && (
                            <Clock className="size-3.5" />
                          )}
                          {statusLabel(attempt.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(attempt.checked_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {attempt.error_message ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
