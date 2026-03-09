import { NextResponse } from 'next/server';

const CALENDLY_API_BASE = 'https://api.calendly.com';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const apiToken = process.env.CALENDLY_API_TOKEN;
    const eventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI;

    if (!apiToken) {
      return NextResponse.json({ error: 'Missing CALENDLY_API_TOKEN on server' }, { status: 500 });
    }

    if (!eventTypeUri) {
      return NextResponse.json({ error: 'Missing CALENDLY_EVENT_TYPE_URI on server' }, { status: 500 });
    }

    const startISO = body?.startISO;
    const endISO = body?.endISO;
    const timezone = body?.timezone || 'America/New_York';

    if (!startISO || !endISO) {
      return NextResponse.json({ error: 'startISO and endISO are required' }, { status: 400 });
    }

    const url = new URL('/event_type_available_times', CALENDLY_API_BASE);
    url.searchParams.set('event_type', eventTypeUri);
    url.searchParams.set('start_time', String(startISO));
    url.searchParams.set('end_time', String(endISO));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.title || data?.message || data?.error || 'Calendly availability request failed', details: data },
        { status: res.status }
      );
    }

    const collection = Array.isArray(data?.collection) ? data.collection : [];
    const slots = collection.map((item) => {
      const startTime = item?.start_time;
      const endTime = item?.end_time;
      const dt = startTime ? new Date(startTime) : null;
      const label = dt
        ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
        : '';

      return {
        startTime,
        endTime,
        label,
      };
    }).filter((slot) => Boolean(slot.startTime));

    return NextResponse.json({ success: true, slots });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
