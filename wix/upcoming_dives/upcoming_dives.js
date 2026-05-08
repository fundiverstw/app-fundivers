import wixLocation from 'wix-location';
import { getDiveById } from 'backend/supabase.jsw';

const REGISTER_ORIGIN = 'https://app.fundiverstw.com';
const FALLBACK_PATH = '/calendar';

$w.onReady(async () => {
  const id = (wixLocation.query && wixLocation.query.id) || null;

  if (!id) {
    wixLocation.to(FALLBACK_PATH);
    return;
  }

  let dive;
  try {
    dive = await getDiveById(id);
  } catch (_) {
    dive = null;
  }

  if (!dive || !dive._id) {
    wixLocation.to(FALLBACK_PATH);
    return;
  }

  const payload = {
    id: dive._id,
    title: dive.display_title || dive.admin_title || 'Untitled dive',
    image: dive.featured_image || '',
    schedule: buildSchedule(dive.start_date, dive.end_date, dive.time),
    price: dive.starting_at,
    prereqs: dive.prereqs || '',
    included: stripHtml(dive.included),
    not_included: stripHtml(dive.not_included),
    transportation: stripHtml(dive.transportation),
    cancellation_policy: dive.cancellation_policy || '',
    cancel_date: formatDate(dive.cancel_date),
    summary: stripHtml(dive.tagline_text),
    itinerary: stripHtml(dive.itinerary),
    description_html: promoteSectionDividers(cleanRichHtml(dive.description)),
    details_html: promoteSectionDividers(cleanRichHtml(dive.details)),
    secondary_image: dive.picture || '',
    room_options: dive.room_options || [],
  };

  $w('#diveDetailHtml').postMessage(payload);

  $w('#diveDetailHtml').onMessage((event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'book' && msg.id) {
      wixLocation.to(
        `${REGISTER_ORIGIN}/register/dive/${encodeURIComponent(msg.id)}`
      );
    } else if (msg.type === 'resize' && typeof msg.height === 'number') {
      $w('#diveDetailHtml').height = Math.max(200, msg.height);
    }
  });
});

function buildSchedule(start, end, time) {
  if (!start) return '';
  const startStr = formatDate(start);
  const endStr = end && end !== start ? formatDate(end) : '';
  const timeStr = formatTime(time);
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

function cleanRichHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s(class|style|on\w+)="[^"]*"/gi, '')
    .replace(/\s(class|style|on\w+)='[^']*'/gi, '')
    .trim();
}

function promoteSectionDividers(html) {
  if (!html) return '';
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (m, inner) => {
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && text.length < 60 && /^[^:]+:$/.test(text)) {
      return '<p class="section-divider">' + text.replace(/:$/, '').trim() + '</p>';
    }
    return m;
  });
}

function stripHtml(s) {
  if (!s) return '';
  const txt = String(s)
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

  const cjkChar = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;
  const cjkRun = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]+/g;

  return txt
    .split('\n')
    .map(line => {
      if (!cjkChar.test(line)) {
        return line.replace(/[ \t]+/g, ' ').trim();
      }
      const segments = line.split(cjkRun);
      let best = '';
      let bestLetters = 0;
      for (const seg of segments) {
        const letters = (seg.match(/[a-zA-Z]/g) || []).length;
        if (letters > bestLetters) {
          bestLetters = letters;
          best = seg;
        }
      }
      if (bestLetters < 4) return '';
      return best
        .replace(/^[^a-zA-Z]*\)/, '')
        .replace(/\([^a-zA-Z()]*\)/g, '')
        .replace(/^[\s,.!?:;\-]+/, '')
        .replace(/^(\S+)(\s+\1)+\b/, '$1')
        .replace(/[ \t]+/g, ' ')
        .trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
