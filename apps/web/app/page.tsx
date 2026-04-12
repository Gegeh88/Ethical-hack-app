import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">
            hax<span className="text-brand-600">vibe</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            AI-alapú sérülékenységvizsgálat magyar KKV-knak.
            <br />
            Etikus hacker a weboldaladért, automata módban.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button size="lg" render={<Link href="/register" />}>
            Regisztráció
          </Button>
          <Button variant="outline" size="lg" render={<Link href="/login" />}>
            Bejelentkezés
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Btk. 423. § hatálya alá nem eső, csak saját domainen végzett vizsgálat.
        </p>
      </div>
    </main>
  );
}
