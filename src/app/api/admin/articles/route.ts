import { NextRequest, NextResponse } from 'next/server';

const LIVE_MEDIA_API = 'https://live-media-platform-epqhgokwva-de.a.run.app/api/articles';

export async function GET(req: NextRequest) {
  const isAdmin = req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const url = status ? `${LIVE_MEDIA_API}?status=${status}` : LIVE_MEDIA_API;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    return NextResponse.json({ error: 'upstream error', status: res.status }, { status: 502 });
  }
  const data = await res.json();
  return NextResponse.json(data);
}
