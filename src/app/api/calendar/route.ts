import { supabase } from '@/lib/supabase';

const CALENDAR_TOKEN = 'proism2026';

function statusToICS(status: string): string {
  if (status === '상담중') return 'TENTATIVE';
  if (status === '완료') return 'COMPLETED';
  return 'CONFIRMED';
}

function escapeICS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (token !== CALENDAR_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: appointments } = await supabase
    .from('appointments')
    .select('*, customer:customers(name, phone)')
    .order('appointment_date', { ascending: false });

  const events = (appointments || []).map((a) => {
    const start = (a.appointment_date || '').replace(/-/g, '');
    const endDate = a.end_date || a.appointment_date;
    const endNext = new Date(endDate);
    endNext.setDate(endNext.getDate() + 1);
    const end = endNext.toISOString().split('T')[0].replace(/-/g, '');
    const name = a.customer?.name || '고객';
    const phone = a.customer?.phone || '';
    const serviceType = a.service_type || '시공';
    const status = a.status || '예약확정';

    const descParts = [`고객: ${name}`, `연락처: ${phone}`, `시공: ${serviceType}`, `상태: ${status}`];
    if (a.memo) {
      try {
        const parsed = JSON.parse(a.memo);
        if (parsed?.notes) descParts.push(`메모: ${parsed.notes}`);
      } catch {
        descParts.push(`메모: ${a.memo}`);
      }
    }

    return [
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeICS(`[프로이즘] ${name} - ${serviceType} (${status})`)}`,
      `DESCRIPTION:${escapeICS(descParts.join('\n'))}`,
      `LOCATION:${escapeICS('서울시 서초구 서초중앙로8길 82, 1동 1층 3M 프로이즘')}`,
      `UID:${a.id}@proism-crm`,
      `STATUS:${statusToICS(status)}`,
      `CATEGORIES:${escapeICS(serviceType)}`,
      'END:VEVENT',
    ].join('\r\n');
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//3M PROIZM//CRM//KO',
    'X-WR-CALNAME:3M 프로이즘 시공일정',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Disposition': 'inline; filename="proism-calendar.ics"',
    },
  });
}
