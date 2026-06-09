import wixLocation from 'wix-location';
import { getCourseById } from 'backend/supabase.jsw';

const REGISTER_ORIGIN = 'https://app.fundiverstw.com';
const FALLBACK_PATH = '/calendar';

$w.onReady(async () => {
  const id = (wixLocation.query && wixLocation.query.id) || null;

  if (!id) {
    wixLocation.to(FALLBACK_PATH);
    return;
  }

  let course;
  try {
    course = await getCourseById(id);
  } catch (_) {
    course = null;
  }

  if (!course || !course._id) {
    wixLocation.to(FALLBACK_PATH);
    return;
  }

  const payload = {
    id: course._id,
    title: course.display_title || '',
    image: course.featured_image || '',
    schedule: courseSchedule(course),
    price: course.starting_at,
    prereqs: course.prereqs || '',
  };

  $w('#courseDetailHtml').postMessage(payload);

  $w('#courseDetailHtml').onMessage((event) => {
    const msg = event.data;
    if (msg && msg.type === 'book' && msg.id) {
      wixLocation.to(
        `${REGISTER_ORIGIN}/register/course/${encodeURIComponent(msg.id)}`
      );
    }
  });
});

function courseSchedule(c) {
  if (c.schedule && String(c.schedule).trim()) return c.schedule;
  const datesStr = courseDates(c);
  if (!datesStr) return '';
  const timeStr = formatTime(c.start_time);
  return timeStr ? `${datesStr} · ${timeStr}` : datesStr;
}

function courseDates(c) {
  let raw = c.course_days;
  if (typeof raw === 'string') raw = raw.replace(/^\{|\}$/g, '').split(',');
  let days = (Array.isArray(raw) ? raw : []).map(s => String(s).slice(0, 10)).filter(Boolean);
  days = Array.from(new Set(days)).sort();
  if (!days.length) return '';
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && (new Date(d + 'T00:00:00Z') - new Date(last[1] + 'T00:00:00Z')) === 86400000) last[1] = d;
    else runs.push([d, d]);
  }
  const fmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return runs.map(([a, b]) => a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`).join(', ');
}

function formatTime(t) {
  if (!t) return '';
  return String(t).split(':').slice(0, 2).join(':');
}
