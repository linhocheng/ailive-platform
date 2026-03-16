import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    platform: 'ailive-platform',
    time: new Date().toISOString(),
  });
}
