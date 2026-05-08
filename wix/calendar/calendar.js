import wixWindow from 'wix-window';
import wixLocation from 'wix-location';
import { getCalendarEvents } from 'backend/supabase.jsw';

$w.onReady(async function () {
  try {
    const allEvents = await getCalendarEvents();

    const ids = wixWindow.formFactor === "Mobile"
      ? ["mobileHtmlCalendar", "htmlCalendar"]
      : ["htmlCalendar", "mobileHtmlCalendar"];
    let comp = null;
    for (const id of ids) {
      try { comp = $w("#" + id); comp.postMessage(allEvents); break; } catch (_) { comp = null; }
    }

    if (comp && typeof comp.onMessage === 'function') {
      comp.onMessage(function (event) {
        const d = event.data;
        if (d && d.type === 'book_event' && d.eventId && d.eventType) {
          wixLocation.to(
            'https://app.fundiverstw.com/register/' +
              encodeURIComponent(d.eventType) + '/' +
              encodeURIComponent(d.eventId)
          );
        }
      });
    }
  } catch (_) {}
});
