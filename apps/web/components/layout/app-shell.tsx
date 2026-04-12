'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { LayoutDashboard, Globe, ScanSearch, LogOut, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV_ITEMS = [
  { label: 'Irányítópult', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Domainek', href: '/domains', icon: Globe },
  { label: 'Vizsgálatok', href: '/scans', icon: ScanSearch },
] as const;

interface AppShellProps {
  user: User;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const displayEmail = user.email ?? '';
  const displayName =
    (user.user_metadata?.display_name as string | undefined) ?? displayEmail;

  return (
    <div className="flex min-h-screen bg-void">
      {/* Sidebar */}
      <aside className="hidden w-56 flex-col bg-surface-low md:flex">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-display text-base font-bold uppercase tracking-widest text-onSurface"
          >
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping bg-pulse opacity-60" />
              <span className="relative inline-flex size-2 bg-pulse" />
            </span>
            HAXVIBE
          </Link>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-2">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-l-2 border-pulse bg-surface-mid pl-[10px] text-pulse'
                    : 'text-onSurface-variant hover:bg-surface-mid hover:text-onSurface',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer — user email */}
        <div className="border-t border-outline-variant/10 px-4 py-3">
          <p className="truncate text-xs text-onSurface-variant">{displayEmail}</p>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 items-center justify-between bg-surface-mid px-4">
          {/* Mobile logo */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-widest text-onSurface md:hidden"
          >
            <span className="size-1.5 bg-pulse" />
            HAXVIBE
          </Link>

          {/* Mobile nav */}
          <nav className="flex gap-1 md:hidden">
            {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'text-pulse'
                      : 'text-onSurface-variant hover:bg-surface-high hover:text-onSurface',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop spacer */}
          <span className="hidden flex-1 md:block" />

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-onSurface-variant transition-colors hover:bg-surface-high hover:text-onSurface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="max-w-[160px] truncate">{displayName}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48 bg-surface-mid border-outline-variant/20">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-onSurface">{displayName}</span>
                  <span className="truncate text-xs text-onSurface-variant">{displayEmail}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-outline-variant/20" />
              <DropdownMenuItem
                variant="destructive"
                onClick={handleLogout}
                className="cursor-pointer text-error hover:bg-error-container/20"
              >
                <LogOut className="size-4" />
                Kijelentkezés
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-void p-6">{children}</main>
      </div>
    </div>
  );
}
