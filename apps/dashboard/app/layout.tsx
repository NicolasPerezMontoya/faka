// Root layout — W5: auth-aware topbar landed in Plan 1.3.2 (after middleware).
// Server Component reads role from x-user-role header (set by middleware) so
// it doesn't re-query Supabase on every render.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { SignInLink, UserBadge } from "@faka/ui";
import { signOutAction } from "@/app/(auth)/login/_actions";
import { isPathAllowed } from "@faka/auth";
import type { UserRole } from "@faka/schema";
import "./globals.css";

export const metadata: Metadata = {
  title: "faka — Dashboard Omnicanal",
  description: "Dashboard de ventas omnicanal + capa de IA",
};

// F2.1 Plan 2.1.3.4 — the "Conectar Mercado Libre" entry is gated to
// super_admin + admin via `isPathAllowed` below (middleware enforces the
// security boundary; this is the UI hint layer).
interface NavItem {
  href: string;
  label: string;
  enabled: boolean;
  requiresPathAllowed?: boolean;
}
const NAV_ITEMS: NavItem[] = [
  { href: "/hoy", label: "Hoy", enabled: true },
  { href: "/ventas", label: "Ventas", enabled: true },
  { href: "/matching", label: "Validación", enabled: true },
  { href: "/productos", label: "Productos", enabled: false },
  { href: "/canales", label: "Canales", enabled: false },
  { href: "/inteligencia", label: "Inteligencia", enabled: false },
  { href: "/operacion", label: "Operación", enabled: true },
  {
    href: "/operacion/conectar-mercadolibre",
    label: "Conectar Mercado Libre",
    enabled: true,
    requiresPathAllowed: true,
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = headers();
  const role = hdrs.get("x-user-role") as UserRole | null;
  const email = hdrs.get("x-user-email");

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
              {NAV_ITEMS.filter((item) =>
                item.requiresPathAllowed ? isPathAllowed(item.href, role) : true,
              ).map((item) => (
                <a
                  key={item.href}
                  href={item.enabled ? item.href : "#"}
                  className={[
                    "block px-3 py-2 rounded-lg text-primary-foreground/70",
                    item.enabled
                      ? "hover:bg-primary-foreground/10"
                      : "opacity-50 cursor-not-allowed",
                  ].join(" ")}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-auto p-4 text-xs text-primary-foreground/50 border-t border-primary-foreground/10">
              v0.2 · Phase 2 Walking Skeleton
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-w-0">
            <header className="h-14 px-6 flex items-center justify-between bg-card border-b border-border">
              <div className="text-sm text-muted-foreground">faka</div>
              {email && role ? (
                <div className="flex items-center gap-4">
                  <UserBadge email={email} role={role} />
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Salir
                    </button>
                  </form>
                </div>
              ) : (
                <SignInLink href="/login">Iniciar sesión</SignInLink>
              )}
            </header>
            <div className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
