import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface MeResponse {
  user: {
    id: string;
    display_name: string | null;
    role: string;
    totp_enabled: boolean;
  };
  org: {
    id: string;
    name: string;
    billing_email: string;
  } | null;
  subscription: {
    tier: 'free' | 'pro' | 'business';
    status: string;
  } | null;
}

interface DomainsResponse {
  data: Array<{ id: string }>;
  total: number;
}

const TIER_LABELS: Record<string, string> = {
  free: 'Ingyenes',
  pro: 'Pro',
  business: 'Business',
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  let me: MeResponse | null = null;
  let domainCount = 0;
  let apiError: string | null = null;

  try {
    me = await apiClient<MeResponse>('/auth/me', { token: session.access_token });
  } catch (err) {
    apiError = err instanceof Error ? err.message : 'API hiba';
  }

  if (me?.org) {
    try {
      const domainsRes = await apiClient<DomainsResponse>('/domains', {
        token: session.access_token,
      });
      domainCount = domainsRes.total ?? domainsRes.data?.length ?? 0;
    } catch {
      // domain count is optional
    }
  }

  const tierLabel =
    me?.subscription ? (TIER_LABELS[me.subscription.tier] ?? me.subscription.tier) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Üdvözöljük!</h1>
        {me?.org && (
          <p className="mt-1 text-sm text-muted-foreground">{me.org.name}</p>
        )}
      </div>

      {apiError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      {!me?.org && !apiError && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Nincs szervezethez rendelve. Kérjük, lépj kapcsolatba az adminisztrátorral.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Előfizetés
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tierLabel ? (
              <Badge variant={me?.subscription?.tier === 'free' ? 'secondary' : 'default'}>
                {tierLabel}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Domainek száma
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{domainCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Szerep
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm capitalize">{me?.user.role ?? '—'}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
