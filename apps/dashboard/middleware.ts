// Next.js middleware entry — delegates to @faka/auth/middleware.

import { authMiddleware, DEFAULT_MATCHER } from "@faka/auth/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return authMiddleware(request);
}

export const config = {
  matcher: DEFAULT_MATCHER,
};
