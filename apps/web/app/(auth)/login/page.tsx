'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '' });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (signInError) {
        setError('Hibás e-mail cím vagy jelszó.');
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('Ismeretlen hiba történt. Próbáld újra.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-surface-low p-8">
      <h2 className="mb-6 font-display text-lg font-semibold uppercase tracking-widest text-onSurface">
        Bejelentkezés
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-mail cím</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="janos@pelda.hu"
            required
            value={form.email}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Jelszó</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            required
            value={form.password}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        {error && (
          <div className="border-l-2 border-error bg-error-container/20 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? 'Bejelentkezés...' : 'Bejelentkezés'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-onSurface-variant">
        Nincs még fiókod?{' '}
        <Link href="/register" className="font-medium text-pulse hover:underline">
          Regisztrálj
        </Link>
      </p>
    </div>
  );
}
