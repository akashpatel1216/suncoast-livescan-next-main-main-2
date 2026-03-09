import { NextResponse } from 'next/server';

const CALENDLY_API_BASE = 'https://api.calendly.com';

export async function GET() {
  try {
    const apiToken = process.env.CALENDLY_API_TOKEN;

    if (!apiToken) {
      return NextResponse.json({ error: 'Missing CALENDLY_API_TOKEN on server' }, { status: 500 });
    }

    const meRes = await fetch(`${CALENDLY_API_BASE}/users/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const meData = await meRes.json().catch(() => ({}));
    if (!meRes.ok) {
      return NextResponse.json(
        { error: meData?.title || meData?.message || meData?.error || 'Unable to fetch Calendly user', details: meData },
        { status: meRes.status }
      );
    }

    const userUri = meData?.resource?.uri;
    if (!userUri) {
      return NextResponse.json({ error: 'Calendly user URI not found' }, { status: 500 });
    }

    const eventsRes = await fetch(`${CALENDLY_API_BASE}/event_types?user=${encodeURIComponent(userUri)}&active=true`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    const eventsData = await eventsRes.json().catch(() => ({}));
    if (!eventsRes.ok) {
      return NextResponse.json(
        { error: eventsData?.title || eventsData?.message || eventsData?.error || 'Unable to fetch event types', details: eventsData },
        { status: eventsRes.status }
      );
    }

    const collection = Array.isArray(eventsData?.collection) ? eventsData.collection : [];
    const eventTypes = collection.map((eventType) => ({
      name: eventType?.name || '',
      slug: eventType?.slug || '',
      schedulingUrl: eventType?.scheduling_url || '',
      uri: eventType?.uri || '',
      duration: eventType?.duration || null,
    }));

    return NextResponse.json({ success: true, eventTypes });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
