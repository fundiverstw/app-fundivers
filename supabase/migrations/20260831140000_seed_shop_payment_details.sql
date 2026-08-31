-- Shop data, not core: FunDivers' own PayPal link, which used to live in
-- fundive.config.ts as contact.paypalLink. That config field is gone — a
-- payment method's pay_url is now part of the method, editable from
-- Manage -> Payment methods. Bank account numbers are deliberately not
-- seeded here; an admin fills those in through the UI.
update public.payment_methods
   set pay_url = 'https://paypal.me/fundiverstw'
 where key = 'paypal';
