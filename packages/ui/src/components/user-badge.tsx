// W5 — auth-aware topbar component. Renders after middleware ships.

import * as React from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

export interface UserBadgeProps {
  email: string;
  role: "super_admin" | "admin" | "manager" | "analista";
  className?: string;
}

const ROLE_LABELS: Record<UserBadgeProps["role"], string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  analista: "Analista",
};

const ROLE_VARIANTS: Record<
  UserBadgeProps["role"],
  "info" | "ok" | "warn" | "muted"
> = {
  super_admin: "info",
  admin: "ok",
  manager: "warn",
  analista: "muted",
};

export const UserBadge = ({ email, role, className }: UserBadgeProps) => {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>
      <span className="text-xs text-muted-foreground hidden md:inline">
        {email}
      </span>
      <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
        {initials}
      </span>
    </div>
  );
};
UserBadge.displayName = "UserBadge";
