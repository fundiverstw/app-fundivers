import wixLocation from 'wix-location';
import { getCalendarEvents } from 'backend/supabase.jsw';

$w.onReady(async function () {
  try {
    const allEvents = await getCalendarEvents();
    const comp = $w("#htmlCalendar");
    comp.postMessage(allEvents);

    comp.onMessage(function (event) {
      const d = event.data;
      if (!d || !d.eventId || !d.eventType) return;
      if (d.type === 'book_event') {
        wixLocation.to(
          'https://app.fundiverstw.com/register/' +
            encodeURIComponent(d.eventType) + '/' +
            encodeURIComponent(d.eventId)
        );
      } else if (d.type === 'details_event') {
        const slug = d.eventType === 'dive' ? 'dives' : 'course';
        wixLocation.to('/' + slug + '/' + encodeURIComponent(d.eventId));
      }
    });
  } catch (_) {}
});
