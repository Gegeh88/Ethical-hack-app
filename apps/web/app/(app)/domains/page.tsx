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
        <h1 className="text-2xl font-bold tracking-tight">Domainek</h1>
        <Button size="sm" render={<Link href="/domains/new" />}>
          <Plus className="size-4" />
          Új domain
        </Button>
      </div>

      {apiError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      {!apiError && domains.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
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
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {domains.length} domain
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Host
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Állapot
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Megosztott hosting
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Hozzáadva
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => (
                    <tr
                      key={domain.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-mono font-medium">{domain.host}</td>
                      <td className="px-4 py-3">
                        {domain.verified_at ? (
                          <Badge variant="default">Igazolt</Badge>
                        ) : (
                          <Badge variant="outline">Nem igazolt</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {domain.is_shared_hosting ? (
                          <span className="text-muted-foreground">Igen</span>
                        ) : (
                          <span className="text-muted-foreground">Nem</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(domain.created_at)}
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
