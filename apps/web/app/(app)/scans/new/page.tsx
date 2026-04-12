'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft, AlertTriangle, ShieldCheck, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Domain {
  id: string;
  host: string;
  verified_at: string | null;
  is_shared_hosting: boolean;
}

interface DomainsResponse {
  data: Domain[];
  total: number;
}

interface CreateScanResponse {
  id: string;
}

const TOS_VERSION = '2026-04-01';

export default function NewScanPage() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [domainsError, setDomainsError] = useState<string | null>(null);

  const [selectedDomainId, setSelectedDomainId] = useState<string>('');
  const [scanType, setScanType] = useState<'passive' | 'active' | 'full'>('passive');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [sharedHostingAck, setSharedHostingAck] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resolve session token
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login');
        return;
      }
      setToken(session.access_token);
    });
  }, [router]);

  // Fetch verified domains once token is ready
  useEffect(() => {
    if (!token) return;

    setLoadingDomains(true);
    apiClient<DomainsResponse>('/domains', { token })
      .then((res) => {
        const verified = (res.data ?? []).filter((d) => d.verified_at !== null);
        setDomains(verified);
        if (verified.length > 0 && verified[0]) {
          setSelectedDomainId(verified[0].id);
        }
      })
      .catch((err) => {
        setDomainsError(err instanceof Error ? err.message : 'API hiba');
      })
      .finally(() => setLoadingDomains(false));
  }, [token]);

  const selectedDomain = domains.find((d) => d.id === selectedDomainId) ?? null;
  const needsSharedHostingAck = selectedDomain?.is_shared_hosting === true;

  const canSubmit =
    !!selectedDomainId &&
    tosAccepted &&
    (!needsSharedHostingAck || sharedHostingAck) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !canSubmit) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await apiClient<CreateScanResponse>('/scans', {
        method: 'POST',
        token,
        body: JSON.stringify({
          domainId: selectedDomainId,
          type: scanType,
          consent: {
            tosVersion: TOS_VERSION,
            sharedHostingAck: needsSharedHostingAck ? sharedHostingAck : false,
          },
        }),
      });
      router.push(`/scans/${res.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Ismeretlen hiba történt.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/scans"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálatokhoz
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Új vizsgálat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Válassz egy igazolt domaint és konfiguráld a vizsgálat paramétereit.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Domain selector */}
        <Card>
          <CardHeader>
            <CardTitle>1. Domain kiválasztása</CardTitle>
            <CardDescription>
              Csak az igazolt domainek vizsgálhatók.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingDomains && (
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            )}

            {!loadingDomains && domainsError && (
              <p className="text-sm text-destructive">{domainsError}</p>
            )}

            {!loadingDomains && !domainsError && domains.length === 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                Nincs igazolt domained.{' '}
                <Link
                  href="/domains"
                  className="font-medium underline underline-offset-2"
                >
                  Adj hozzá és igazolj egy domaint
                </Link>{' '}
                a vizsgálat indításához.
              </div>
            )}

            {!loadingDomains && !domainsError && domains.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="domain-select">Domain</Label>
                <select
                  id="domain-select"
                  value={selectedDomainId}
                  onChange={(e) => {
                    setSelectedDomainId(e.target.value);
                    setSharedHostingAck(false);
                  }}
                  className={cn(
                    'h-9 w-full rounded-md border border-input bg-background px-3 py-1',
                    'text-sm shadow-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                >
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.host}
                      {d.is_shared_hosting ? ' (megosztott hosting)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scan type */}
        <Card>
          <CardHeader>
            <CardTitle>2. Vizsgálat típusa</CardTitle>
            <CardDescription>
              Válaszd ki, milyen mélységű vizsgálatot szeretnél indítani.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <ScanTypeOption
              id="type-passive"
              label="Passzív vizsgálat"
              description="SSL, fejlécek, DNS, robots.txt, port scan, CMS felismerés"
              selected={scanType === 'passive'}
              onChange={() => setScanType('passive')}
            />
            <ScanTypeOption
              id="type-active"
              label="Aktív vizsgálat"
              description="Nuclei sérülékenységi sablonok (CVE-k, konfigurációs hibák, kitettségek)"
              selected={scanType === 'active'}
              onChange={() => setScanType('active')}
            />
            <ScanTypeOption
              id="type-full"
              label="Teljes vizsgálat"
              description="Passzív + aktív vizsgálat együtt (ajánlott)"
              selected={scanType === 'full'}
              onChange={() => setScanType('full')}
            />

            {(scanType === 'active' || scanType === 'full') && (
              <div className="mt-2 flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
                <Info className="mt-0.5 size-4 shrink-0 text-yellow-700" />
                <p className="text-sm text-yellow-800">
                  Az aktív vizsgálat tesztkéréseket küld a célszerverre. Ez akár 30 percig is
                  tarthat. Csak saját tulajdonú, igazolt domaineken végezze!
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Consent */}
        <Card>
          <CardHeader>
            <CardTitle>3. Beleegyezés</CardTitle>
            <CardDescription>
              A vizsgálat indításához szükséges beleegyezések.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* ToS checkbox */}
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-brand-600"
              />
              <span className="text-sm leading-snug">
                Elfogadom az{' '}
                <a
                  href="/legal/tos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                >
                  Általános Szerződési Feltételeket
                </a>{' '}
                (v{TOS_VERSION}), valamint tudomásul veszem, hogy a vizsgálat
                kizárólag a saját, igazolt tulajdonomban lévő domain ellen futtatható,
                a Btk. 423. §-ának megfelelően.
              </span>
            </label>

            {/* Shared hosting warning + ack */}
            {needsSharedHostingAck && (
              <div className="flex flex-col gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <div className="flex items-start gap-2 text-yellow-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p className="text-sm font-medium">
                    Megosztott hosting figyelmeztetés
                  </p>
                </div>
                <p className="text-sm text-yellow-700">
                  A kiválasztott domain megosztott hosting szerveren fut. A vizsgálat
                  korlátozott, egyes ellenőrzések nem futtathatók, hogy ne zavarjuk a
                  szomszéd ügyfeleket. Az eredmények hiányosak lehetnek.
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={sharedHostingAck}
                    onChange={(e) => setSharedHostingAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-brand-600"
                  />
                  <span className="text-sm text-yellow-800">
                    Tudomásul veszem, hogy megosztott hosting környezetben a vizsgálat
                    korlátozott, és az eredmények nem teljesek.
                  </span>
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit error */}
        {submitError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={!canSubmit || loadingDomains}
            className="gap-2"
          >
            <ShieldCheck className="size-4" />
            {submitting ? 'Indítás folyamatban...' : 'Vizsgálat indítása'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            render={<Link href="/scans" />}
          >
            Mégse
          </Button>
        </div>
      </form>
    </div>
  );
}

function ScanTypeOption({
  id,
  label,
  description,
  selected,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onChange: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
        selected ? 'border-brand-600/40 bg-brand-50' : 'border-border hover:border-border/80',
      )}
    >
      <input
        type="radio"
        id={id}
        name="scan-type"
        value={id.replace('type-', '')}
        checked={selected}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </label>
  );
}
