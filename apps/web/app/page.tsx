import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Shield, Zap, FileText } from 'lucide-react';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-void text-onSurface">
      {/* Nav */}
      <nav className="flex h-14 items-center justify-between px-6 bg-surface-low">
        <span className="font-display text-base font-bold uppercase tracking-widest text-onSurface">
          HAX<span className="text-pulse">VIBE</span>
        </span>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" render={<Link href="/login" />}>
            Bejelentkezés
          </Button>
          <Button size="sm" render={<Link href="/register" />}>
            Regisztráció
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="terminal-grid relative flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        {/* Scanline effect */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="scanline absolute h-px w-full bg-pulse" />
        </div>

        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 bg-surface-high px-3 py-1 text-xs font-mono text-onSurface-variant">
            <span className="size-1.5 bg-pulse" />
            Btk. 423. § hatálya alá nem eső, saját domaineken végzett vizsgálat
          </div>

          <h1 className="font-display text-5xl font-bold leading-tight tracking-tight text-onSurface md:text-6xl">
            Védd a vállalkozásod.
            <br />
            <span className="text-pulse">Automatikusan.</span>
          </h1>

          <p className="mx-auto max-w-xl text-lg text-onSurface-variant">
            AI-asszisztált etikus sérülékenységvizsgálat magyar KKV-knak.
            Passzív és aktív scan, Nuclei sablonok, magyar nyelvű jelentés.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" render={<Link href="/register" />}>
              Regisztráció — ingyenes
            </Button>
            <Button variant="outline" size="lg" render={<Link href="/login" />}>
              Bejelentkezés
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-surface-low px-6 py-16">
        <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-3">
          {[
            { value: '≤ 2 perc', label: 'Passzív scan átfutás' },
            { value: '≤ 30 perc', label: 'Teljes scan (Nuclei)' },
            { value: '100%', label: 'Saját domainre korlátozva' },
          ].map(({ value, label }) => (
            <div key={label} className="flex flex-col gap-1 text-center">
              <span className="font-display text-3xl font-bold text-pulse">{value}</span>
              <span className="text-sm text-onSurface-variant">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-center font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
            Hogy működik?
          </h2>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                step: '01',
                icon: Shield,
                title: 'Domain igazolás',
                desc: 'DNS, meta tag vagy fájl alapú igazolással bizonyítod a domain tulajdonjogát.',
              },
              {
                step: '02',
                icon: Zap,
                title: 'Scan indítása',
                desc: 'Passzív vagy teljes vizsgálat: SSL, fejlécek, DNS, portok, Nuclei CVE sablonok.',
              },
              {
                step: '03',
                icon: FileText,
                title: 'Magyar jelentés',
                desc: 'AI által generált, magyar nyelvű sérülékenységi jelentés PDF formátumban.',
              },
            ].map(({ step, icon: Icon, title, desc }) => (
              <div key={step} className="bg-surface-low p-6">
                <div className="mb-4 flex items-start gap-3">
                  <span className="font-mono text-xs font-bold text-pulse">{step}</span>
                  <Icon className="size-5 text-forge shrink-0" />
                </div>
                <h3 className="mb-2 font-display font-semibold text-onSurface">{title}</h3>
                <p className="text-sm text-onSurface-variant">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface-low px-6 py-8 text-center text-xs text-onSurface-variant">
        <p className="mb-1 font-display font-semibold uppercase tracking-widest text-onSurface">
          HAX<span className="text-pulse">VIBE</span>
        </p>
        <p>Etikus sérülékenységvizsgálat — kizárólag igazolt, saját domaineken.</p>
        <p className="mt-2 font-mono text-onSurface-variant/60">
          Btk. 423. § · GDPR · NIS2
        </p>
      </footer>
    </main>
  );
}
