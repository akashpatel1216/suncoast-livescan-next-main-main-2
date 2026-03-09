import { NextResponse } from 'next/server';

const CALENDLY_API_BASE = 'https://api.calendly.com';

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone).trim().startsWith('+')) return String(phone).trim();
  return `+${digits}`;
}

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

    const startTime = body?.startTime;
    const timezone = body?.timezone || 'America/New_York';
    const invitee = body?.invitee || {};
    const location = body?.location || '';
    const service = body?.service || {};
    const paymentTransactionId = body?.paymentTransactionId || '';

    if (!startTime) {
      return NextResponse.json({ error: 'startTime is required' }, { status: 400 });
    }

    if (!invitee?.email || !invitee?.firstName || !invitee?.lastName) {
      return NextResponse.json({ error: 'invitee firstName, lastName, and email are required' }, { status: 400 });
    }

    const payload = {
      event_type: eventTypeUri,
      start_time: startTime,
      invitee: {
        name: `${invitee.firstName} ${invitee.lastName}`.trim(),
        first_name: String(invitee.firstName),
        last_name: String(invitee.lastName),
        email: String(invitee.email),
        timezone,
      },
      tracking: {
        utm_source: 'suncoast-livescan-site',
        utm_campaign: 'helcim-paid-booking',
        utm_content: String(service?.code || ''),
      },
    };

    const normalizedPhone = normalizePhone(invitee?.phone);
    if (normalizedPhone) {
      payload.invitee.text_reminder_number = normalizedPhone;
    }

    const qa = [];
    if (invitee?.phone) qa.push({ question: 'Phone Number', answer: String(invitee.phone) });
    if (service?.code) qa.push({ question: 'ORI Code', answer: String(service.code) });
    if (service?.title) qa.push({ question: 'Service', answer: String(service.title) });
    if (location) qa.push({ question: 'Location', answer: String(location) });
    if (paymentTransactionId) qa.push({ question: 'Payment Transaction ID', answer: String(paymentTransactionId) });
    if (qa.length) payload.questions_and_answers = qa;

    const locationKind = process.env.CALENDLY_LOCATION_KIND;
    if (locationKind) {
      payload.location = { kind: locationKind };
      if (process.env.CALENDLY_LOCATION_VALUE) {
        payload.location.location = process.env.CALENDLY_LOCATION_VALUE;
      }
    }

    const postInvitee = async (inviteePayload) => {
      const response = await fetch(`${CALENDLY_API_BASE}/invitees`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inviteePayload),
      });
      const responseData = await response.json().catch(() => ({}));
      return { response, responseData };
    };

    let { response: res, responseData: data } = await postInvitee(payload);

    // Fallback: retry minimal payload if optional fields were rejected by event configuration.
    if (!res.ok) {
      const minimalPayload = {
        event_type: payload.event_type,
        start_time: payload.start_time,
        invitee: {
          name: payload.invitee.name,
          first_name: payload.invitee.first_name,
          last_name: payload.invitee.last_name,
          email: payload.invitee.email,
          timezone: payload.invitee.timezone,
        },
        tracking: payload.tracking,
      };
      ({ response: res, responseData: data } = await postInvitee(minimalPayload));
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.title || data?.message || data?.error || 'Calendly booking failed', details: data },
        { status: res.status }
      );
    }

    const resource = data?.resource || {};

    return NextResponse.json({
      success: true,
      uri: resource?.uri || '',
      cancelUrl: resource?.cancel_url || '',
      rescheduleUrl: resource?.reschedule_url || '',
      eventUri: resource?.event || '',
    });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
