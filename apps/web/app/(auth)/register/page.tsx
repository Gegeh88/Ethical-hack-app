'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    orgName: '',
    billingEmail: '',
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      // Mirror email into billingEmail until user changes it manually
      ...(name === 'email' && prev.billingEmail === prev.email
        ? { billingEmail: value }
        : {}),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) {
      setError('A jelszónak legalább 8 karakter hosszúnak kell lennie.');
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: { display_name: form.displayName },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const session = signUpData.session;
      if (!session) {
        setError(
          'Regisztráció sikeres! Erősítsd meg az e-mail címed, majd jelentkezz be.',
        );
        return;
      }

      await apiClient('/auth/register-org', {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({
          name: form.orgName,
          billingEmail: form.billingEmail || form.email,
        }),
      });

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ismeretlen hiba történt.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-surface-low p-8">
      <h2 className="mb-6 font-display text-lg font-semibold uppercase tracking-widest text-onSurface">
        Regisztráció
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="displayName">Név</Label>
          <Input
            id="displayName"
            name="displayName"
            type="text"
            placeholder="Kovács János"
            required
            value={form.displayName}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

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
            placeholder="Minimum 8 karakter"
            required
            minLength={8}
            value={form.password}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="orgName">Szervezet neve</Label>
          <Input
            id="orgName"
            name="orgName"
            type="text"
            placeholder="Példa Kft."
            required
            value={form.orgName}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="billingEmail">Számlázási e-mail</Label>
          <Input
            id="billingEmail"
            name="billingEmail"
            type="email"
            placeholder="szamlazas@pelda.hu"
            value={form.billingEmail}
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
          {isLoading ? 'Regisztráció...' : 'Regisztráció'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-onSurface-variant">
        Már van fiókod?{' '}
        <Link href="/login" className="font-medium text-pulse hover:underline">
          Jelentkezz be
        </Link>
      </p>
    </div>
  );
}
