import wixLocation from 'wix-location';
import { getUpcomingDives, getUpcomingCourses } from 'backend/supabase.jsw';
import { sendRequest } from 'backend/sendRequest.web';

// Registration flow lives on the PWA now. Public, no login required to open
// the form; auth happens inline on submit.
const REGISTER_ORIGIN = 'https://app.fundiverstw.com';
function registerUrl(eventType, eventId) {
  return REGISTER_ORIGIN + '/register/' + encodeURIComponent(eventType) + '/' + encodeURIComponent(eventId);
}

function detailsPath(eventType, eventId) {
  const slug = eventType === 'dive' ? 'dives' : 'course';
  return '/' + slug + '/' + encodeURIComponent(eventId);
}

$w.onReady(async function () {
  // Navigation buttons
  $w('#Section1ListItem1Title1').onClick(() => wixLocation.to("/travel-destinations?mode=dom"));
  $w('#Section1ListItem2Title1').onClick(() => wixLocation.to("/travel-destinations?mode=int"));

  const [dives, courses] = await Promise.all([
    getUpcomingDives(3),
    getUpcomingCourses(3),
  ]);

  $w('#divesHtml').postMessage(dives);
  $w('#coursesHtml').postMessage(courses);

  // Card iframes post 'details_*' (open the Wix detail page) and
  // 'book_*' (skip straight to the PWA register flow).
  $w('#divesHtml').onMessage((event) => {
    const d = event.data;
    if (d.type === 'details_dive') wixLocation.to(detailsPath('dive', d.id));
    if (d.type === 'book_dive')    wixLocation.to(registerUrl('dive', d.id));
  });

  $w('#coursesHtml').onMessage((event) => {
    const d = event.data;
    if (d.type === 'details_course') wixLocation.to(detailsPath('course', d.id));
    if (d.type === 'book_course')    wixLocation.to(registerUrl('course', d.id));
  });

  // Visitor request iframe — try-dive / course requests are emailed to
  // fundiverstw@gmail.com via the backend (see backend/sendRequest.web.js).
  // Iframe posts: { type: 'request_submit', requestType, name, email, message }.
  $w('#requestHtml').onMessage(async (event) => {
    const d = event.data;
    if (!d || d.type !== 'request_submit') return;
    try {
      await sendRequest({
        requestType: d.requestType,
        name:        d.name,
        email:       d.email,
        message:     d.message,
      });
      $w('#requestHtml').postMessage({ type: 'request_result', ok: true });
    } catch (err) {
      console.error('sendRequest failed:', err);
      $w('#requestHtml').postMessage({ type: 'request_result', ok: false });
    }
  });
});
