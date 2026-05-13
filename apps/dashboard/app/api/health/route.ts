import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'faka-dashboard',
    phase: 1,
    version: '0.0.0',
    timestamp: new Date().toISOString(),
  });
}
