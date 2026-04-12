'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, CheckCircle, XCircle, Copy, Loader2 } from 'lucide-react';

interface TokenResponse {
  token: string;
  expires_at: string | null;
}

type VerifyMethod = 'dns' | 'meta' | 'file';

interface CheckResult {
  success: boolean;
  message?: string;
}

interface MethodState {
  loading: boolean;
  result: CheckResult | null;
}

type MethodStates = Record<VerifyMethod, MethodState>;

const initialMethodState: MethodState = { loading: false, result: null };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — silently ignore
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      <Copy className="size-3.5" />
      {copied ? 'Másolva!' : 'Másolás'}
    </Button>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function ResultBanner({ result }: { result: CheckResult }) {
  if (result.success) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
        <CheckCircle className="mt-0.5 size-4 shrink-0" />
        <span>Domain sikeresen igazolva! Átirányítás...</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <XCircle className="mt-0.5 size-4 shrink-0" />
      <span>
        Az igazolás sikertelen.{result.message ? ` ${result.message}` : ''}
      </span>
    </div>
  );
}

export default function VerifyDomainPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [domainHost, setDomainHost] = useState<string>('');
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [methodStates, setMethodStates] = useState<MethodStates>({
    dns: { ...initialMethodState },
    meta: { ...initialMethodState },
    file: { ...initialMethodState },
  });

  // Fetch domain host + generate/get token on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setPageLoading(true);
      setPageError(null);
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push('/login');
          return;
        }

        const token = session.access_token;

        // Fetch domain info and create/get verification token in parallel
        const [domain, tok] = await Promise.all([
          apiClient<{ id: string; host: string }>(`/domains/${id}`, { token }),
          apiClient<TokenResponse>(`/domains/${id}/verification`, {
            method: 'POST',
            token,
          }),
        ]);

        if (!cancelled) {
          setDomainHost(domain.host);
          setTokenData(tok);
        }
      } catch (err) {
        if (!cancelled) {
          setPageError(
            err instanceof Error ? err.message : 'Betöltési hiba történt.',
          );
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const handleCheck = useCallback(
    async (method: VerifyMethod) => {
      setMethodStates((prev) => ({
        ...prev,
        [method]: { loading: true, result: null },
      }));

      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.push('/login');
          return;
        }

        const result = await apiClient<CheckResult>(
          `/domains/${id}/verification/check`,
          {
            method: 'POST',
            token: session.access_token,
            body: JSON.stringify({ method }),
          },
        );

        setMethodStates((prev) => ({
          ...prev,
          [method]: { loading: false, result },
        }));

        if (result.success) {
          setTimeout(() => {
            router.push(`/domains/${id}`);
          }, 2000);
        }
      } catch (err) {
        setMethodStates((prev) => ({
          ...prev,
          [method]: {
            loading: false,
            result: {
              success: false,
              message:
                err instanceof Error ? err.message : 'Ismeretlen hiba.',
            },
          },
        }));
      }
    },
    [id, router],
  );

  if (pageLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href={`/domains/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Vissza a domainhez
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Betöltés...
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href={`/domains/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Vissza a domainhez
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {pageError}
        </div>
      </div>
    );
  }

  const verificationToken = tokenData?.token ?? '';
  const tokenExpiry = tokenData?.expires_at;

  const dnsRecord = `Host: _ethical-scan.${domainHost}\nÉrték: ${verificationToken}`;
  const metaSnippet = `<meta name="ethical-scan-verification" content="${verificationToken}">`;
  const fileContent = verificationToken;
  const fileUrl = `https://${domainHost}/.well-known/ethical-scan-verification.txt`;

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href={`/domains/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a domainhez
      </Link>

      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Domain igazolása
        </h1>
        <p className="mt-1 font-mono text-muted-foreground">{domainHost}</p>
      </div>

      {/* Token expiry notice */}
      {tokenExpiry && (
        <p className="text-xs text-muted-foreground">
          Token lejárata:{' '}
          <span className="font-medium">
            {new Intl.DateTimeFormat('hu-HU', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(tokenExpiry))}
          </span>
        </p>
      )}

      {/* Igazolási token display */}
      <Card>
        <CardHeader>
          <CardTitle>Igazolási token</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CodeBlock>{verificationToken}</CodeBlock>
          <div className="flex">
            <CopyButton text={verificationToken} />
          </div>
        </CardContent>
      </Card>

      {/* DNS method */}
      <Card>
        <CardHeader>
          <CardTitle>DNS (ajánlott)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Adjon hozzá egy TXT rekordot a domain DNS-beállításaiban:
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Host
            </span>
            <CodeBlock>{`_ethical-scan.${domainHost}`}</CodeBlock>
            <CopyButton text={`_ethical-scan.${domainHost}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Érték
            </span>
            <CodeBlock>{verificationToken}</CodeBlock>
            <CopyButton text={verificationToken} />
          </div>
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400">
            A DNS propagáció akár 24 órát is igénybe vehet.
          </div>
          {methodStates.dns.result && (
            <ResultBanner result={methodStates.dns.result} />
          )}
          <div className="flex">
            <Button
              onClick={() => handleCheck('dns')}
              disabled={
                methodStates.dns.loading ||
                methodStates.dns.result?.success === true
              }
            >
              {methodStates.dns.loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Ellenőrzés...
                </>
              ) : (
                'Ellenőrzés'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Meta tag method */}
      <Card>
        <CardHeader>
          <CardTitle>Meta tag</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Illessze be a következő meta taget a weboldalának{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              &lt;head&gt;
            </code>{' '}
            szekciójába:
          </p>
          <CodeBlock>{metaSnippet}</CodeBlock>
          <div className="flex">
            <CopyButton text={metaSnippet} />
          </div>
          {methodStates.meta.result && (
            <ResultBanner result={methodStates.meta.result} />
          )}
          <div className="flex">
            <Button
              onClick={() => handleCheck('meta')}
              disabled={
                methodStates.meta.loading ||
                methodStates.meta.result?.success === true
              }
            >
              {methodStates.meta.loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Ellenőrzés...
                </>
              ) : (
                'Ellenőrzés'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* File method */}
      <Card>
        <CardHeader>
          <CardTitle>Fájl</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Hozzon létre egy fájlt az alábbi útvonalon:
          </p>
          <CodeBlock>{fileUrl}</CodeBlock>
          <p className="text-sm text-muted-foreground">
            A fájl tartalma legyen:
          </p>
          <CodeBlock>{fileContent}</CodeBlock>
          <div className="flex gap-2">
            <CopyButton text={fileUrl} />
            <CopyButton text={fileContent} />
          </div>
          {methodStates.file.result && (
            <ResultBanner result={methodStates.file.result} />
          )}
          <div className="flex">
            <Button
              onClick={() => handleCheck('file')}
              disabled={
                methodStates.file.loading ||
                methodStates.file.result?.success === true
              }
            >
              {methodStates.file.loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Ellenőrzés...
                </>
              ) : (
                'Ellenőrzés'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
