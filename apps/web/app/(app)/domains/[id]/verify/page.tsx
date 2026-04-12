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
    <pre className="overflow-x-auto bg-surface-high px-3 py-2.5 font-mono text-xs leading-relaxed text-onSurface break-all whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function ResultBanner({ result }: { result: CheckResult }) {
  if (result.success) {
    return (
      <div className="flex items-start gap-2 border-l-2 border-pulse bg-pulse/10 px-3 py-2.5 text-sm text-pulse">
        <CheckCircle className="mt-0.5 size-4 shrink-0" />
        <span>Domain sikeresen igazolva! Átirányítás...</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 border-l-2 border-error bg-error-container/20 px-3 py-2.5 text-sm text-error">
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
          className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
        >
          <ArrowLeft className="size-4" />
          Vissza a domainhez
        </Link>
        <div className="flex items-center gap-2 text-sm text-onSurface-variant">
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
          className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
        >
          <ArrowLeft className="size-4" />
          Vissza a domainhez
        </Link>
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {pageError}
        </div>
      </div>
    );
  }

  const verificationToken = tokenData?.token ?? '';
  const tokenExpiry = tokenData?.expires_at;

  const metaSnippet = `<meta name="ethical-scan-verification" content="${verificationToken}">`;
  const fileContent = verificationToken;
  const fileUrl = `https://${domainHost}/.well-known/ethical-scan-verification.txt`;

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        href={`/domains/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
      >
        <ArrowLeft className="size-4" />
        Vissza a domainhez
      </Link>

      {/* Page heading */}
      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Domain igazolása
        </h1>
        <p className="mt-1 font-mono text-onSurface-variant">{domainHost}</p>
      </div>

      {/* Token expiry notice */}
      {tokenExpiry && (
        <p className="font-mono text-xs text-onSurface-variant">
          Token lejárata:{' '}
          <span className="font-medium text-onSurface">
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
          <p className="text-sm text-onSurface-variant">
            Adjon hozzá egy TXT rekordot a domain DNS-beállításaiban:
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              Host
            </span>
            <CodeBlock>{`_ethical-scan.${domainHost}`}</CodeBlock>
            <CopyButton text={`_ethical-scan.${domainHost}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              Érték
            </span>
            <CodeBlock>{verificationToken}</CodeBlock>
            <CopyButton text={verificationToken} />
          </div>
          <div className="border-l-2 border-forge bg-forge-dark/20 px-3 py-2 text-xs text-forge">
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
          <p className="text-sm text-onSurface-variant">
            Illessze be a következő meta taget a weboldalának{' '}
            <code className="bg-surface-high px-1 py-0.5 font-mono text-xs text-onSurface">
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
          <p className="text-sm text-onSurface-variant">
            Hozzon létre egy fájlt az alábbi útvonalon:
          </p>
          <CodeBlock>{fileUrl}</CodeBlock>
          <p className="text-sm text-onSurface-variant">
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
