// Root layout — W5 fix: AUTH-TOLERANT shell only. No getUser() / getSession()
// calls live here in Plan 1.3.1. The auth-aware topbar (user email + role
// badge + sign-out) is added by Plan 1.3.2 AFTER middleware ships.

import type { Metadata } from 'next';
import { SignInLink } from '@faka/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'faka — Dashboard Omnicanal',
  description: 'Dashboard de ventas omnicanal + capa de IA',
};

const NAV_ITEMS = [
  { href: '/hoy', label: 'Hoy', enabled: false },
  { href: '/productos', label: 'Productos', enabled: false },
  { href: '/canales', label: 'Canales', enabled: false },
  { href: '/inteligencia', label: 'Inteligencia', enabled: false },
  { href: '/operacion', label: 'Operación', enabled: true, active: true },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full bg-muted/30 text-foreground antialiased">
        <div className="min-h-screen flex">
          <aside className="hidden md:flex flex-col w-60 bg-primary text-primary-foreground">
            <div className="px-5 py-4 border-b border-primary-foreground/10">
              <div className="text-sm uppercase tracking-wider text-primary-foreground/60">
                faka
              </div>
              <div className="text-lg font-semibold">Dashboard Omnicanal</div>
            </div>
            <nav className="px-2 py-3 space-y-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <a
                  key={item.href}
                  href={item.enabled ? item.href : '#'}
                  className={[
                    'block px-3 py-2 rounded-lg',
                    item.active
                      ? 'bg-primary-foreground/10 text-primary-foreground font-medium'
                      : 'text-primary-foreground/70',
                    item.enabled ? 'hover:bg-primary-foreground/10' : 'opacity-50 cursor-not-allowed',
                  ].join(' ')}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-auto p-4 text-xs text-primary-foreground/50 border-t border-primary-foreground/10">
              v0.1 · Phase 1 Foundation
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-w-0">
            <header className="h-14 px-6 flex items-center justify-between bg-card border-b border-border">
              <div className="text-sm text-muted-foreground">faka</div>
              {/* W5: auth-aware enhancements (UserBadge + sign-out) land in Plan 1.3.2 */}
              <SignInLink href="/login">Iniciar sesión</SignInLink>
            </header>
            <div className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
