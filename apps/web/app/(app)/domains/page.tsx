import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus } from 'lucide-react';

interface Domain {
  id: string;
  host: string;
  verified_at: string | null;
  is_shared_hosting: boolean;
  created_at: string;
}

interface DomainsResponse {
  data: Domain[];
  total: number;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export default async function DomainsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  let domains: Domain[] = [];
  let apiError: string | null = null;

  try {
    const res = await apiClient<DomainsResponse>('/domains', {
      token: session.access_token,
    });
    domains = res.data ?? [];
  } catch (err) {
    apiError = err instanceof Error ? err.message : 'API hiba';
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Domainek
        </h1>
        <Button size="sm" render={<Link href="/domains/new" />}>
          <Plus className="size-4" />
          Új domain
        </Button>
      </div>

      {apiError && (
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {apiError}
        </div>
      )}

      {!apiError && domains.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-onSurface-variant">
              Még nincs hozzáadott domain.
            </p>
            <Button size="sm" render={<Link href="/domains/new" />}>
              <Plus className="size-4" />
              Domain hozzáadása
            </Button>
          </CardContent>
        </Card>
      )}

      {domains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              {domains.length} domain
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Host
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Állapot
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Megosztott hosting
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Hozzáadva
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-widest text-onSurface-variant">
                      Műveletek
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => (
                    <tr
                      key={domain.id}
                      className="border-b border-outline-variant/10 last:border-0 hover:bg-surface-mid"
                    >
                      <td className="px-4 py-3 font-mono font-medium text-onSurface">
                        <Link
                          href={`/domains/${domain.id}`}
                          className="hover:text-pulse hover:underline"
                        >
                          {domain.host}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {domain.verified_at ? (
                          <Badge variant="default">Igazolt</Badge>
                        ) : (
                          <Badge variant="outline">Nem igazolt</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-onSurface-variant">
                        {domain.is_shared_hosting ? 'Igen' : 'Nem'}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-onSurface-variant">
                        {formatDate(domain.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {domain.verified_at ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            render={<Link href={`/domains/${domain.id}`} />}
                          >
                            Részletek
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            render={
                              <Link href={`/domains/${domain.id}/verify`} />
                            }
                          >
                            Igazolás
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
