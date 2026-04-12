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
    const res = await apiClient<{ data: MeResponse }>('/auth/me', { token: session.access_token });
    me = res.data;
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
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Üdvözöljük!
        </h1>
        {me?.org && (
          <p className="mt-1 font-mono text-sm text-onSurface-variant">{me.org.name}</p>
        )}
      </div>

      {apiError && (
        <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
          {apiError}
        </div>
      )}

      {!me?.org && !apiError && (
        <div className="border-l-2 border-forge bg-forge-dark/20 px-4 py-3 text-sm text-forge">
          Nincs szervezethez rendelve. Kérjük, lépj kapcsolatba az adminisztrátorral.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              Előfizetés
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tierLabel ? (
              <Badge variant={me?.subscription?.tier === 'free' ? 'secondary' : 'default'}>
                {tierLabel}
              </Badge>
            ) : (
              <span className="font-mono text-sm text-onSurface-variant">—</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              Domainek száma
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold text-pulse">{domainCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-onSurface-variant">
              Szerep
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-onSurface capitalize">{me?.user.role ?? '—'}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
