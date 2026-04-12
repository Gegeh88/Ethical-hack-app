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
        className="inline-flex items-center gap-1.5 text-sm text-onSurface-variant hover:text-onSurface"
      >
        <ArrowLeft className="size-4" />
        Vissza a vizsgálatokhoz
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
          Új vizsgálat
        </h1>
        <p className="mt-1 text-sm text-onSurface-variant">
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
              <div className="h-9 w-full animate-pulse bg-surface-high" />
            )}

            {!loadingDomains && domainsError && (
              <p className="text-sm text-error">{domainsError}</p>
            )}

            {!loadingDomains && !domainsError && domains.length === 0 && (
              <div className="border-l-2 border-forge bg-forge-dark/20 px-4 py-3 text-sm text-forge">
                Nincs igazolt domained.{' '}
                <Link
                  href="/domains"
                  className="font-medium underline underline-offset-2 hover:text-forge-light"
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
                    'h-9 w-full border-0 border-b border-outline-variant bg-transparent px-0 py-1',
                    'font-mono text-sm text-onSurface',
                    'focus-visible:border-pulse focus-visible:outline-none focus-visible:shadow-[0_1px_0_0_#00FF41]',
                    '[&>option]:bg-surface-mid [&>option]:text-onSurface',
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
              <div className="mt-2 flex items-start gap-3 border-l-2 border-forge bg-forge-dark/20 px-4 py-3">
                <Info className="mt-0.5 size-4 shrink-0 text-forge" />
                <p className="text-sm text-forge">
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
                className="mt-0.5 h-4 w-4 shrink-0 accent-pulse"
              />
              <span className="text-sm leading-snug text-onSurface">
                Elfogadom az{' '}
                <a
                  href="/legal/tos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-pulse underline underline-offset-2 hover:text-pulse-dim"
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
              <div className="flex flex-col gap-3 border-l-2 border-forge bg-forge-dark/20 p-4">
                <div className="flex items-start gap-2 text-forge">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p className="text-sm font-medium">
                    Megosztott hosting figyelmeztetés
                  </p>
                </div>
                <p className="text-sm text-forge/80">
                  A kiválasztott domain megosztott hosting szerveren fut. A vizsgálat
                  korlátozott, egyes ellenőrzések nem futtathatók, hogy ne zavarjuk a
                  szomszéd ügyfeleket. Az eredmények hiányosak lehetnek.
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={sharedHostingAck}
                    onChange={(e) => setSharedHostingAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-forge"
                  />
                  <span className="text-sm text-forge">
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
          <div className="border-l-2 border-error bg-error-container/20 px-4 py-3 text-sm text-error">
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
        'flex cursor-pointer items-start gap-3 border p-4 transition-colors',
        selected
          ? 'border-pulse/30 bg-pulse/5'
          : 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-mid',
      )}
    >
      <input
        type="radio"
        id={id}
        name="scan-type"
        value={id.replace('type-', '')}
        checked={selected}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-pulse"
      />
      <div className="flex flex-col gap-0.5">
        <span className={cn('text-sm font-medium', selected ? 'text-pulse' : 'text-onSurface')}>
          {label}
        </span>
        <span className="text-xs text-onSurface-variant">{description}</span>
      </div>
    </label>
  );
}
