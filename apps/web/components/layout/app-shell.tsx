'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { LayoutDashboard, Globe, LogOut, ChevronDown } from 'lucide-react';
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
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-56 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            hax<span className="text-brand-600">vibe</span>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2 pt-3">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
          {/* Mobile logo */}
          <Link href="/dashboard" className="text-lg font-bold tracking-tight md:hidden">
            hax<span className="text-brand-600">vibe</span>
          </Link>

          {/* Mobile nav (simple links) */}
          <nav className="flex gap-2 md:hidden">
            {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-muted-foreground hover:bg-muted',
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
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="max-w-[160px] truncate">{displayName}</span>
              <ChevronDown className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">{displayEmail}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={handleLogout}
                className="cursor-pointer"
              >
                <LogOut className="size-4" />
                Kijelentkezés
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
