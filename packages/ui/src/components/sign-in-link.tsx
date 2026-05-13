// W5 — auth-tolerant topbar placeholder. The auth-aware <UserBadge>+sign-out
// lands in Plan 1.3.2 once middleware ships.

import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface SignInLinkProps {
  href: string;
  className?: string;
  children?: React.ReactNode;
}

export const SignInLink = ({ href, className, children }: SignInLinkProps) => (
  <a
    href={href}
    className={cn(
      'text-sm text-muted-foreground hover:text-foreground transition-colors',
      className,
    )}
  >
    {children ?? 'Iniciar sesión'}
  </a>
);
SignInLink.displayName = 'SignInLink';
