'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';

// Matches CreateDomainRequest schema from shared-types
const DOMAIN_REGEX = /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}$/;

export default function NewDomainPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [isSharedHosting, setIsSharedHosting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalizedHost = host.trim().toLowerCase();

    if (!DOMAIN_REGEX.test(normalizedHost)) {
      setError(
        'Érvénytelen domain formátum. Csak kisbetűt, számot, kötőjelet és pontot tartalmazhat (pl. pelda.hu).',
      );
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      await apiClient('/domains', {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({
          host: normalizedHost,
          is_shared_hosting: isSharedHosting,
        }),
      });

      router.push('/domains');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ismeretlen hiba történt.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Új domain hozzáadása
        </h1>
        <p className="mt-1 text-sm text-onSurface-variant">
          Add meg a vizsgálandó domain nevét.
        </p>
      </div>

      <div className="max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Domain adatai</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="host">Domain neve</Label>
                <Input
                  id="host"
                  name="host"
                  type="text"
                  placeholder="example.com"
                  required
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={isLoading}
                />
                <p className="font-mono text-xs text-onSurface-variant">
                  Csak kisbetűs formátumban (pl. pelda.hu, sub.domain.com)
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="isSharedHosting"
                    checked={isSharedHosting}
                    onChange={(e) => setIsSharedHosting(e.target.checked)}
                    disabled={isLoading}
                    className="mt-0.5 size-4 cursor-pointer accent-pulse"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="isSharedHosting" className="cursor-pointer">
                      Megosztott hosting
                    </Label>
                    <p className="text-xs text-onSurface-variant">
                      Jelöld be, ha a domain megosztott tárhelyen fut. A vizsgálat
                      csak passzív módban fog zajlani, hogy ne zavarjon más
                      weboldalakat.
                    </p>
                  </div>
                </div>

                {isSharedHosting && (
                  <div className="border-l-2 border-forge bg-forge-dark/20 px-3 py-2 text-xs text-forge">
                    Figyelem: Megosztott hostingen futó domaineken aktív vizsgálat
                    nem hajtható végre. Csak passzív felderítés lesz elérhető.
                  </div>
                )}
              </div>

              {error && (
                <div className="border-l-2 border-error bg-error-container/20 px-3 py-2 text-sm text-error">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/domains')}
                  disabled={isLoading}
                >
                  Mégsem
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Hozzáadás...' : 'Hozzáadás'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
