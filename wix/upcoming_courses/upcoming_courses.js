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
  if (!c.start_date) return '';
  const startStr = formatDate(c.start_date);
  const endStr = c.end_date && c.end_date !== c.start_date ? formatDate(c.end_date) : '';
  const timeStr = formatTime(c.start_time);
  let s = endStr ? `${startStr} → ${endStr}` : startStr;
  if (timeStr) s += ` · ${timeStr}`;
  return s;
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  return String(t).split(':').slice(0, 2).join(':');
}
