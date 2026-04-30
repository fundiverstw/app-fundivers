create extension if not exists "pg_net" with schema "extensions";

alter table "public"."EO_courses" drop constraint "EO_courses_cancel_policy_fkey";

alter table "public"."EO_courses" add column "admin_title" text;

alter table "public"."EO_dives" add column "calendar_title" text;

alter table "public"."eo_dive_rooms" enable row level security;

alter table "public"."EO_courses" add constraint "EO_courses_cancel_policy_fkey" FOREIGN KEY (cancel_policy) REFERENCES public.cancellation_policies(_id) ON UPDATE CASCADE not valid;

alter table "public"."EO_courses" validate constraint "EO_courses_cancel_policy_fkey";

CREATE TRIGGER wix_sync_dive_travel AFTER INSERT OR DELETE OR UPDATE ON public."DiveTravel" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_eo_courses AFTER INSERT OR DELETE OR UPDATE ON public."EO_courses" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_eo_dives AFTER INSERT OR DELETE OR UPDATE ON public."EO_dives" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_eo_prices AFTER INSERT OR DELETE OR UPDATE ON public."EO_prices" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_eo_rooms AFTER INSERT OR DELETE OR UPDATE ON public."EO_rooms" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_other_addons AFTER INSERT OR DELETE OR UPDATE ON public."Other_Addons" FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_cancellation_policies AFTER INSERT OR DELETE OR UPDATE ON public.cancellation_policies FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');

CREATE TRIGGER wix_sync_cert_levels AFTER INSERT OR DELETE OR UPDATE ON public.cert_levels FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://fundiverstw.com/_functions/supabaseWebhook', 'POST', '{"Content-type":"application/json","x-sync-token":"cec9e630fd495446c7947dd5f579bddd398e66d579e55d024af242a65604ef5e"}', '{}', '5000');


