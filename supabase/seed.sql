SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict TtMW9zHTPlP95fyaFWtgpdwfT52R8gYglW1bXVX6rCkCKWcLOIQTJTb0Hk7t6gQ

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'diver@diver.diver', '$2a$06$1weD7KjQ88nVhUrOavlhSOWP8zTAyjqA4/tslBwYrWt8dqOlqw/Ba', '2026-04-21 01:31:27.817174+00', NULL, '', NULL, '', NULL, '', '', NULL, NULL, '{"provider": "email", "providers": ["email"]}', '{}', false, '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'alice@example.com', '$2a$06$BvEEFkddef4C.TrZ9Ou3gOncoLn7jC.4Qo75LKiNFvPkhDaZs32QK', '2026-04-21 01:31:27.817174+00', NULL, '', NULL, '', NULL, '', '', NULL, NULL, '{"provider": "email", "providers": ["email"]}', '{}', false, '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'bob@example.com', '$2a$06$J0.8Ok55T/pjklDrDOQvxeLUjyy3GSD8/Z45uk4SWeANrKni.igHS', '2026-04-21 01:31:27.817174+00', NULL, '', NULL, '', NULL, '', '', NULL, NULL, '{"provider": "email", "providers": ["email"]}', '{}', false, '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'admin@admin.admin', '$2a$06$lrDc8pT56hk/kcpsG5PYi.Bm7zOFZ44CXqVwvjeOIM2oObDZH11ia', '2026-04-21 01:31:27.817174+00', NULL, '', NULL, '', NULL, '', '', NULL, NULL, '{"provider": "email", "providers": ["email"]}', '{}', false, '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22', 'authenticated', 'authenticated', 'fundiverstw@gmail.com', '$2a$10$K7PTucyTLYdK49bp7oxv/ur9K32HqfN0dVcirZhgsO3wT7korEMOi', '2026-04-16 11:46:21.88918+00', NULL, '', '2026-04-16 11:45:20.069405+00', '', NULL, '', '', NULL, '2026-04-16 12:00:31.456086+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22", "email": "fundiverstw@gmail.com", "email_verified": true, "phone_verified": false}', NULL, '2026-04-16 11:45:20.042759+00', '2026-04-21 01:28:28.401001+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', '962f07ec-ce11-4eef-bf41-219f86b49cd4', 'authenticated', 'authenticated', 'billy.evalt@gmail.com', '$2a$10$Fo9xtpzkotqBf0n20WTLP.egLUet5k4pYsan.ClZ.eVcpqIH2hWJ6', '2026-04-16 12:15:13.209482+00', NULL, '', '2026-04-16 12:14:56.811959+00', '', NULL, '', '', NULL, '2026-04-21 01:30:10.690647+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "962f07ec-ce11-4eef-bf41-219f86b49cd4", "email": "billy.evalt@gmail.com", "email_verified": true, "phone_verified": false}', NULL, '2026-04-16 12:14:56.776701+00', '2026-04-21 01:30:10.703104+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22', '8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22', '{"sub": "8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22", "email": "fundiverstw@gmail.com", "email_verified": true, "phone_verified": false}', 'email', '2026-04-16 11:45:20.057384+00', '2026-04-16 11:45:20.057438+00', '2026-04-16 11:45:20.057438+00', 'd7f64040-80bf-41a0-b787-8ee0bd2a1415'),
	('962f07ec-ce11-4eef-bf41-219f86b49cd4', '962f07ec-ce11-4eef-bf41-219f86b49cd4', '{"sub": "962f07ec-ce11-4eef-bf41-219f86b49cd4", "email": "billy.evalt@gmail.com", "email_verified": true, "phone_verified": false}', 'email', '2026-04-16 12:14:56.804151+00', '2026-04-16 12:14:56.804224+00', '2026-04-16 12:14:56.804224+00', 'a1a29762-6984-4cd7-aff5-078e8d28f8fc'),
	('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '{"sub": "11111111-1111-1111-1111-111111111111", "email": "diver@diver.diver"}', 'email', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '11111111-1111-1111-1111-111111111111'),
	('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '{"sub": "22222222-2222-2222-2222-222222222222", "email": "alice@example.com"}', 'email', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '22222222-2222-2222-2222-222222222222'),
	('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '{"sub": "33333333-3333-3333-3333-333333333333", "email": "bob@example.com"}', 'email', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '33333333-3333-3333-3333-333333333333'),
	('44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', '{"sub": "44444444-4444-4444-4444-444444444444", "email": "admin@admin.admin"}', 'email', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', '44444444-4444-4444-4444-444444444444');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: EO_prices; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."EO_prices" ("title", "price", "starting_at", "deposit_amount", "room_options", "transport", "_id", "Created Date", "Updated Date", "Owner", "EO_dives_price") VALUES
	('4BD 6400', '<p class="font_7">NTD 6400</p>', 6400, 6400, NULL, NULL, '048d99e9-f7f9-4fc2-91aa-d304cea24151', '2026-04-09 03:27:36+00', '2026-04-09 03:28:08+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', NULL),
	('XLQ 4 BD trip', '<p class="font_7">背包房 Bunk Room: NTD 11,800</p>
<p class="font_7">雙人房 Basic Double Room: NTD 13,500 (double occupancy) (limited availability)</p>
<p class="font_7">Private room: NTD 15,500</p>', 11800, 8000, '["9d4c6161-5077-43a9-b5a6-4d2dd7eabdce","9754f07e-5b47-4dcb-b207-5ead4c11899e"]', '1300', '06e87c1b-6f32-4126-9b84-9fb383c1bae7', '2026-01-16 06:26:35+00', '2026-04-09 11:14:10+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["153e1d6c-9c96-4f02-b48a-092c2298c532"]'),
	('AOW Course', '<p class="font_7">1 Person - NTD 12,500</p>
<p class="font_7">2 People -&nbsp;NTD 11,600/ea</p>
<p class="font_7">3 People - NTD 11,000/ea</p>', 12500, 6000, NULL, NULL, '1f81cbc7-0999-4f9e-998f-a23eaafb8e72', '2026-03-12 03:56:25+00', '2026-04-09 11:12:13+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', NULL),
	('Panglao, Bohol', '<p class="font_7">Shared Room (2 Pax) - NTD 32,900&nbsp;</p>
<p class="font_7">Private Room (1 Pax) - NTD 41,200</p>', 32900, 15000, NULL, NULL, '33461d11-31f7-4d9e-8563-fdf0d672c975', '2025-11-25 05:49:57+00', '2026-04-09 11:15:30+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["3690170d-4a3f-47de-8b08-0ed562e9eeac"]'),
	('7 Star/Kenting', '<p class="font_7">Bunk room (4~6 people shared room) - NTD 12,900</p>
<p class="font_7">Double bed ensuite (2 people occupancy) - NTD 14,600</p>', 12900, 8000, '["d927d758-e4af-4ee7-b6bd-bd67e52eb4df"]', '1800', '6098fde5-8530-4886-8ad8-c8357586c86b', '2026-01-16 07:19:36+00', '2026-04-09 11:12:36+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["829d3ca3-6b4a-4d4d-b74a-51fea5cf0287"]'),
	('Penghu', '<p class="font_7">上下舖 Bunk Room (shared bathroom): NTD 28,500/each 台幣28,500/人&nbsp;</p>
<p class="font_7">上下套房 Bunk Room (Ensuite): NTD 31,500/each (Double occupancy) 台幣 31,500/人 (兩人一房) &nbsp;</p>', 28500, 15000, '["8b6f57f5-88b5-479f-9bd3-807e0cefed3b"]', NULL, '737618b5-037a-4195-8032-1f3b1d1e21c3', '2025-11-25 05:45:41+00', '2026-04-09 11:14:38+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["08ae6dd9-e926-4ae3-b6a3-490d25acc4f9"]'),
	('3BD 4800', '<p class="font_7">NTD 4800</p>', 4800, 4800, NULL, NULL, '75a7289c-2a5e-4fc5-a80f-0488d8ec6e9e', '2026-04-09 03:26:31+00', '2026-04-09 03:27:32+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["41fd5cbd-e3ff-4c29-9d8b-34f80f194134"]'),
	('OW Course', '<p class="font_8">1 Person - NTD 15,400</p>
<p class="font_8">2 People -&nbsp;NTD 14,400/ea</p>
<p class="font_8">3 People - NTD 13,500/ea</p>', 15400, 6000, NULL, NULL, '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f', '2026-03-25 08:36:22+00', '2026-04-09 11:10:24+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', NULL),
	('2BD1SD 4200', '<p class="font_7">NTD 4200</p>', 4200, 4200, NULL, NULL, '8c141f6d-38ae-4a5b-88ea-67d9edb12146', '2026-04-09 03:25:52+00', '2026-04-09 03:27:15+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["196e5bce-99a9-466b-b83a-fdc60c3b05fd"]'),
	('Rescue Course', '<p class="font_8">1 Person - NTD 10,500</p>
<p class="font_8">2 People -&nbsp;NTD 9,600/ea</p>
<p class="font_8">3 People - NTD 9,200/ea</p>', 10500, 6000, NULL, NULL, '938685ab-435f-4911-82d7-348e89343ea3', '2026-04-16 03:45:02+00', '2026-04-16 03:45:44+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', NULL),
	('Basic Specialty', '<p class="font_7">1 Person - NTD 6800</p>
<p class="font_7">2 People - NTD 6000/ea</p>
<p class="font_7">3 People - NTD 5800/ea</p>', 6800, 6000, NULL, NULL, '95493cbc-5aa3-4251-a6b3-43ebce9c0e1d', '2026-04-09 11:08:14+00', '2026-04-09 11:11:25+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', NULL),
	('2BD 3600', '<p class="font_7">NTD 3600</p>', 3600, 3600, NULL, NULL, '9fd90874-cd94-470c-b07c-c7655b558741', '2025-11-29 06:28:12+00', '2026-04-09 03:29:43+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["0db714bb-baca-4399-bf50-94a3c3877fb4"]'),
	('2BD 3400', '<p class="font_7">NTD 3400</p>', 3400, 3400, NULL, NULL, 'a2f26412-3d8d-4c03-9ef0-e58d4d54e03e', '2026-04-09 03:21:53+00', '2026-04-09 03:22:50+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["8b721a55-2f2b-4ae9-9a56-656c75239cfe"]'),
	('Kenting trip', '<p class="font_7">Bunk Room - NTD 20000</p>
<p class="font_7">Private double - NTD 25000</p>
<p class="font_7"><br></p>', 20000, 8000, '["d927d758-e4af-4ee7-b6bd-bd67e52eb4df","9754f07e-5b47-4dcb-b207-5ead4c11899e"]', '1800', 'a6def8c2-c040-4373-a646-46ab059156e1', '2025-11-22 03:26:00+00', '2026-04-09 11:15:24+00', '0e65aa86-9c28-4ed9-8712-4d853b049ca2', NULL),
	('Equipment Course', '<p class="font_7">NTD 2800 for workshop with instructor&nbsp;</p>
<p class="font_7">If you want the Gear Specialty Certification, it is NTD 2000 additional.</p>', 2800, 2800, NULL, NULL, 'bf197a49-4440-4451-8e2c-2e2200c3949d', '2026-01-16 04:41:38+00', '2026-04-09 11:15:38+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', NULL),
	('EFR Course', '<p class="font_7">EFR Primary and Secondary Care Course Price:&nbsp;NTD 4,900</p>
<p class="font_7">Combination EFR and Care For Children Course Price: NTD 8,600</p>
<p class="font_7">Get a discount if you sign up with a friend!</p>', 4900, 4900, NULL, NULL, 'eafed2d9-7ad0-43ef-9bc2-950431c5058a', '2026-01-29 05:29:26+00', '2026-04-09 11:13:30+00', '0e65aa86-9c28-4ed9-8712-4d853b049ca2', NULL),
	('LDB Weekend Low', '<p class="font_8">NTD 2300</p>', 2300, 2300, NULL, NULL, 'f1837f27-3dee-4ab2-a160-916e74ae0918', '2026-04-08 02:18:35+00', '2026-04-08 02:19:26+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["f849f633-42f0-4407-93d4-2e1662200075"]'),
	('Shore General', '<p class="font_8">NTD 2000</p>', 2000, 2000, NULL, NULL, 'f9720d42-f8ab-42a6-98e2-4c15b1e4d1c5', '2026-04-09 08:05:11+00', '2026-04-09 08:05:36+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '["7ae1c2c2-f939-46e5-b021-4623861b26b6"]');


--
-- Data for Name: EO_courses; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."EO_courses" ("course_title", "title", "_id", "link-eo-courses-course_title", "Created Date", "price", "Updated Date", "start_date", "special_date", "end_date", "start_time", "course_name", "featured_image", "URL", "prereqs", "req_dives", "included", "schedule", "dive_days", "other_addons", "google_calendar_event_id", "Owner", "starting_at") VALUES
	('Advanced Open Water', 'AOW 2', '2a0df7ef-b9df-42f6-a347-0aa53a24667f', '/course-schedule/advance-open-water/2a0df7ef-b9df-42f6-a347-0aa53a24667f', '2026-04-07 04:07:29+00', '1f81cbc7-0999-4f9e-998f-a23eaafb8e72', '2026-04-16 06:12:02+00', '2026-04-11', NULL, '2026-04-12', NULL, 'f7b34c84-6214-42fd-bcf3-c102510f6a3b', 'wix:image://v1/b37fef_6eb87d93e40440a4a89da1e22382275f~mv2.jpg/guillermo%20SMB.jpg#originWidth=3008&originHeight=4026', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, 'This course includes 5 dives, tanks, weights, round trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', NULL, 2, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 12500),
	('EFR Course', 'EFR Course', '2e8163d0-f34a-42f8-a2f0-b32148524f88', '/course-schedule/efr-course/2e8163d0-f34a-42f8-a2f0-b32148524f88', '2026-02-25 02:34:12+00', 'eafed2d9-7ad0-43ef-9bc2-950431c5058a', '2026-04-16 05:42:08+00', '2026-04-11', NULL, NULL, '09:00:00.000', '48eb4223-236c-41e2-acd9-0d2855161dd1', 'wix:image://v1/b37fef_bfee03e4ce2b4615b2d514e36ad31807~mv2.png/IMG_0251.HEIC#originWidth=3024&originHeight=4032', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, NULL, NULL, NULL, NULL, NULL, '9f20fab4-5faf-4978-94de-a146afe4af9d', 4900),
	('EFR Course', 'EFR Course', '39a09812-ea04-4ce6-a60e-046ba17ef149', '/course-schedule/efr-course/39a09812-ea04-4ce6-a60e-046ba17ef149', '2026-02-25 02:11:14+00', 'eafed2d9-7ad0-43ef-9bc2-950431c5058a', '2026-04-16 05:42:08+00', '2026-03-14', NULL, NULL, '09:00:00.000', '48eb4223-236c-41e2-acd9-0d2855161dd1', 'wix:image://v1/b37fef_d9a7f06e39c24f95bb9b21423a4e66ac~mv2.png/IMG_0241.HEIC#originWidth=3024&originHeight=4032', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, NULL, NULL, NULL, NULL, NULL, '9f20fab4-5faf-4978-94de-a146afe4af9d', 4900),
	('Advanced Open Water', 'AOW 4', '846989e2-dd1b-47d5-a919-d44079115637', '/course-schedule/advance-open-water/846989e2-dd1b-47d5-a919-d44079115637', '2026-04-16 03:53:56+00', '1f81cbc7-0999-4f9e-998f-a23eaafb8e72', '2026-04-16 06:12:50+00', '2026-05-29', NULL, '2026-05-30', NULL, 'f7b34c84-6214-42fd-bcf3-c102510f6a3b', 'wix:image://v1/b37fef_0dffada76b234b76b906813aa39bde86~mv2.jpg/Night%20Dive%20Entry.jpg#originWidth=3657&originHeight=2732', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, 'This course includes 5 dives, tanks, weights, round trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', NULL, 2, '["0e299749-8b3d-4d0b-9655-cf2b146c3570"]', NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 12500),
	('Equipment Course', 'Equipment Course', '8574751b-a6f5-470d-b9b2-af9e47a130a9', '/course-schedule/equipment-course/8574751b-a6f5-470d-b9b2-af9e47a130a9', '2025-11-07 15:46:50+00', 'bf197a49-4440-4451-8e2c-2e2200c3949d', '2026-04-16 05:42:08+00', '2026-02-07', NULL, NULL, '09:00:00.000', 'd0e15ee1-8dcb-4d87-9e8a-9b9d7327e3a5', 'wix:image://v1/b37fef_e2c274475bec4737be19e12159226144~mv2.jpg/1st%20Stage%20corrosion.jpg#originWidth=750&originHeight=500', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, NULL, NULL, NULL, NULL, NULL, '0e65aa86-9c28-4ed9-8712-4d853b049ca2', 2800),
	('Advanced Open Water', 'AOW 1', '9b2264ea-a9cc-40f9-aa36-84aa53202b82', '/course-schedule/advance-open-water/9b2264ea-a9cc-40f9-aa36-84aa53202b82', '2026-03-12 03:55:56+00', '1f81cbc7-0999-4f9e-998f-a23eaafb8e72', '2026-04-16 06:09:11+00', '2026-03-30', NULL, '2026-03-31', NULL, 'f7b34c84-6214-42fd-bcf3-c102510f6a3b', 'wix:image://v1/b37fef_6eb87d93e40440a4a89da1e22382275f~mv2.jpg/guillermo%20SMB.jpg#originWidth=3008&originHeight=4026', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, 'This course includes 5 dives, tanks, weights, round trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', NULL, NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 12500),
	('PADI Rescue Course', 'Rescue 1', '146c37ea-dd58-46cf-b146-c88afa78b683', '/course-schedule/padi-rescue-diver-course/146c37ea-dd58-46cf-b146-c88afa78b683', '2026-04-16 03:46:28+00', '938685ab-435f-4911-82d7-348e89343ea3', '2026-04-16 06:14:02+00', '2026-05-09', NULL, '2026-05-10', NULL, 'bac47c29-0a04-4a9a-bffd-0aab9b718d4f', 'wix:image://v1/b37fef_608782ad7f57488e9e54a4633bf27e82~mv2.jpg/P9253838.jpg#originWidth=1731&originHeight=1154', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', NULL, 'This course includes PADI Elearning, 1 Day in the Pool, 1 Day in the Ocean, Round-trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', NULL, 2, '["bd523b91-080b-4f0a-b747-dff6f7d724f1"]', NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 10500),
	('Open Water Course', 'OW 2', '49ca5977-a126-4916-9319-295add9f13e2', '/course-schedule/open-water-course/49ca5977-a126-4916-9319-295add9f13e2', '2026-03-25 08:35:42+00', '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f', '2026-04-16 06:13:24+00', '2026-04-10', NULL, '2026-04-12', NULL, 'e9ee79b3-d972-465f-a1cf-8262b7fc14e1', 'wix:image://v1/b37fef_1b6e0cbabd714c4a849665c1be18bafe~mv2_d_2000_1333_s_2.jpg/34201275_1818660561489758_1664930130830557184_n.jpg#originWidth=2000&originHeight=1333', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, 'This course includes PADI Elearning, 1 Day in the Pool, 2 Days in the Ocean, Round-trip transportation from Fun Divers Taiwan, gear rental, and full coverage local dive insurance.', NULL, NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 15400),
	('Open Water Course', 'OW 1', '4c9d3861-2310-4ac3-84fe-c0db6dbc0646', '/course-schedule/open-water-course/4c9d3861-2310-4ac3-84fe-c0db6dbc0646', '2026-03-25 08:45:28+00', '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f', '2026-04-16 06:13:21+00', '2026-03-28', '2026-04-11', '2026-04-12', NULL, 'e9ee79b3-d972-465f-a1cf-8262b7fc14e1', 'wix:image://v1/b37fef_b22c67c4e51440c1929b2292262e7b15~mv2.jpg/20170514-IMG_3567.jpg#originWidth=1600&originHeight=1067', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, 'This course includes PADI Elearning, 1 Day in the Pool, 2 Days in the Ocean, Round-trip transportation from Fun Divers Taiwan, gear rental, and full coverage local dive insurance.', 'Mar 28 - Classroom/Pool
Apr 11 - Ocean Dives
Apr 12 - Ocean Dives', NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 15400),
	('Open Water Course', 'OW 3', '4d4190fa-dfcb-4e1f-8b06-1054fbcd5c43', '/course-schedule/open-water-course/4d4190fa-dfcb-4e1f-8b06-1054fbcd5c43', '2026-04-16 03:29:05+00', '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f', '2026-04-16 06:13:29+00', '2026-04-26', '2026-05-09', '2026-05-10', NULL, 'e9ee79b3-d972-465f-a1cf-8262b7fc14e1', 'wix:image://v1/b37fef_81903f5f902c4cd6867eb2499ce441d8~mv2.jpg/P6240431.jpg#originWidth=1224&originHeight=816', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, 'This course includes PADI Elearning, 1 Day in the Pool, 2 Days in the Ocean, Round-trip transportation from Fun Divers Taiwan, gear rental, and full coverage local dive insurance.', 'Apr 26 - Classroom/Pool
May 09 - Ocean Dives
May 10 - Ocean Dives', NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 15400),
	('Deep Specialty', 'Deep 1', '5f472d80-d246-4730-bff5-093d6c055d0c', '/course-schedule/deep-specialty-course/5f472d80-d246-4730-bff5-093d6c055d0c', '2026-04-09 11:16:21+00', '95493cbc-5aa3-4251-a6b3-43ebce9c0e1d', '2026-04-16 06:13:03+00', '2026-04-27', NULL, '2026-04-28', NULL, 'd4b64ee1-057f-4e77-ac87-d03a90450393', 'wix:image://v1/b37fef_747f3aa77dcd403f8f9f09f19e5705d3~mv2.jpg/P1010168.jpg#originWidth=1883&originHeight=1062', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', NULL, 'This course includes 4 dives, tanks, weights, round trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', NULL, 2, '["889c458a-f046-470e-b624-e3267cdca9ea","b12da045-7328-499b-98e5-24173d87f02c"]', NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 6800),
	('EFR Course', 'EFR Course', 'a39a1c3f-c108-42e5-b800-d85ba1dfe9a8', '/course-schedule/efr-course/a39a1c3f-c108-42e5-b800-d85ba1dfe9a8', '2026-04-08 04:05:12+00', 'eafed2d9-7ad0-43ef-9bc2-950431c5058a', '2026-04-16 05:42:08+00', '2026-05-16', NULL, NULL, '09:00:00.000', '48eb4223-236c-41e2-acd9-0d2855161dd1', 'wix:image://v1/b37fef_120d37b5cc6b4ade85a668efc82b69b4~mv2.jpg/275319007_244091007841469_118625993794909366_n.jpg#originWidth=2945&originHeight=3926', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, NULL, NULL, NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 4900),
	('Open Water Course', 'OW 4', 'c4a44d82-8bc3-4b00-93aa-a41f7ae0615b', '/course-schedule/open-water-course/c4a44d82-8bc3-4b00-93aa-a41f7ae0615b', '2026-04-10 12:32:40+00', '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f', '2026-04-16 06:13:49+00', '2026-05-17', NULL, '2026-05-19', NULL, 'e9ee79b3-d972-465f-a1cf-8262b7fc14e1', 'wix:image://v1/9f20fa_8ac82b8ab01341cd9efb6c87dc72aa84~mv2.jpg/333587713_539713511582603_4302626921609278285_n.jpg#originWidth=2048&originHeight=1536', NULL, '217fe9dd-01fe-4974-9203-8f17d0fac911', NULL, 'This course includes PADI Elearning, 1 Day in the Pool, 2 Days in the Ocean, Round-trip transportation from Fun Divers Taiwan, gear rental, and full coverage local dive insurance.', NULL, NULL, NULL, NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 15400),
	('Advanced Open Water', 'AOW 3', 'd00c7a8f-d98d-499f-bd4a-9b2f00ced954', '/course-schedule/advance-open-water/d00c7a8f-d98d-499f-bd4a-9b2f00ced954', '2026-04-09 10:34:16+00', '1f81cbc7-0999-4f9e-998f-a23eaafb8e72', '2026-04-16 06:12:45+00', '2026-04-25', '2026-04-27', NULL, NULL, 'f7b34c84-6214-42fd-bcf3-c102510f6a3b', 'https://pcauozfljgmelxnguqiz.supabase.co/storage/v1/object/public/Featured%20Pictures/P1010397-2.jpg', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, 'This course includes 5 dives, tanks, weights, round trip transportation from Fun Divers Taiwan, and full coverage local dive insurance.', 'Apr 25 - 3 Dive Day w/Night Dive
Apr 27 - 2 Dive Day', 2, '["0e299749-8b3d-4d0b-9655-cf2b146c3570"]', NULL, 'b37fefa3-09b1-4e00-a824-f6b884e43572', 12500);


--
-- Data for Name: EO_dives; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."EO_dives" ("dive_title", "title", "DiveTravel_reference", "price", "destination_reference", "start_date", "time", "end_date", "cancel_date", "featured", "featured_image", "second_image", "link-eo-dives-dive_title", "_id", "notes", "fully_booked", "prereqs", "nitrox_required", "req_dives", "gear_rental", "cancel_policy", "room_types", "has_rooms", "hasotheraddons", "other_addons", "dive_days", "google_calendar_event_id", "Created Date", "Updated Date", "Owner", "EO_price_reference") VALUES
	('Badouzi Bay', 'Badouzi Bay', '5c7687aa-1f95-4124-9eba-50692ed29764', '9fd90874-cd94-470c-b07c-c7655b558741', '["8e938f1a-6a40-442b-97e7-bfbb624e04cf", "71077d4f-2d3a-4696-9207-761b81522965"]', '2026-03-07', '06:30:00.000', NULL, NULL, NULL, 'wix:image://v1/b37fef_4e079eae041d4143913dd5844d1f3659~mv2.jpg/P1010096.jpg#originWidth=1883&originHeight=1062', NULL, '/dives/badouzi-bay/0db714bb-baca-4399-bf50-94a3c3877fb4', '0db714bb-baca-4399-bf50-94a3c3877fb4', '2 Boat dives', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', 'true', NULL, NULL, '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-02 03:27:11+00', '2026-04-10 14:06:15+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '9fd90874-cd94-470c-b07c-c7655b558741'),
	('7 Star in Kenting', '7 Star in Kenting', '66862864-3e6c-4bd3-a84f-f307502b5cc5', '6098fde5-8530-4886-8ad8-c8357586c86b', '["52224a76-927a-4e3e-8c52-2d34afacbdf0"]', '2026-04-17', NULL, '2026-04-19', '2026-04-01', true, 'wix:image://v1/b37fef_a4be3af87a29488185d944aee75ffda9~mv2.jpg/P2080453-Giant%20Trevally-Similan-Surin%20Islands.jpg#originWidth=3684&originHeight=2078', 'wix:image://v1/b37fef_7db2aa3d3d2b4ab68f7b682d218052cf~mv2.jpg/Wall.JPG#originWidth=3000&originHeight=4000', '/dives/7-star%2Fkenting/829d3ca3-6b4a-4d4d-b74a-51fea5cf0287', '829d3ca3-6b4a-4d4d-b74a-51fea5cf0287', '3D2N 5 Boat Dives', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', 'true', 30, 'NTD 3200 for full set including dive computer and SMB (2 Days)', '1b76813a-c57c-4c1c-ae87-45a6ed389e47', '9754f07e-5b47-4dcb-b207-5ead4c11899e,d927d758-e4af-4ee7-b6bd-bd67e52eb4df', true, true, '["75a877da-1931-4cb6-b669-84d5b7071ed4","8250698a-41ae-4ba9-b7cf-4bdc5516b224"]', 2, NULL, '2026-01-16 07:11:51+00', '2026-04-10 14:06:01+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '6098fde5-8530-4886-8ad8-c8357586c86b'),
	('Panglao, Bohol', 'Panglao, Bohol', '6233a861-a6d5-4fae-b8ea-9585e09fad08', '33461d11-31f7-4d9e-8563-fdf0d672c975', '["7fac8c9e-03c8-4ae0-9ac9-94f14747785a"]', '2025-12-09', NULL, '2025-12-14', '2026-04-02', NULL, NULL, NULL, '/dives/panglao%2C-bohol/3690170d-4a3f-47de-8b08-0ed562e9eeac', '3690170d-4a3f-47de-8b08-0ed562e9eeac', '6D5N', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', 'true', NULL, NULL, '465f1e26-17d5-4784-b9bd-2c5dd8a36560', NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-29 04:51:38+00', '2026-04-10 14:06:31+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '33461d11-31f7-4d9e-8563-fdf0d672c975'),
	('Turtle & Waj', 'Boat Dives
Turtle Island and Wan An Jian Wreck', '6b55bb0b-afb6-4a2d-a732-54df212103a9', '75a7289c-2a5e-4fc5-a80f-0488d8ec6e9e', '["2f20780e-0a57-41c3-b941-275e1d2a1d7e", "adf55491-0aaa-49bd-bf0a-8affba1a0ce0"]', '2026-06-14', NULL, NULL, '2026-05-31', NULL, 'wix:image://v1/b37fef_e6233d5e9ab746e88cc2054e58642ec5~mv2.jpg/P1010153.jpg#originWidth=1731&originHeight=1154', 'wix:image://v1/b37fef_f406b1cff4af4d2c9d077a2843c91a02~mv2.jpg/PA040410_edited.jpg#originWidth=800&originHeight=1155', '/dives/boat-dives-turtle-island-and-wan-an-jian-wreck/41fd5cbd-e3ff-4c29-9d8b-34f80f194134', '41fd5cbd-e3ff-4c29-9d8b-34f80f194134', '3 Boat Dives', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', 'true', NULL, 'NTD 1600 for full set including Dive Computer and SMB (both required for boat diving).', '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, true, '["0e299749-8b3d-4d0b-9655-cf2b146c3570","45d529b9-c16d-40e5-b4f1-fe7590c29d64","22e83bc5-3fa4-4b4d-98be-6f69e9314df9"]', NULL, NULL, '2026-04-09 08:57:51+00', '2026-04-10 14:05:41+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '75a7289c-2a5e-4fc5-a80f-0488d8ec6e9e'),
	('LDB Sunday', 'Long Dong Bay', 'eb686139-46ec-4c7c-abe5-5613e6f6731e', 'f9720d42-f8ab-42a6-98e2-4c15b1e4d1c5', '["9cbfd600-7a90-470b-b9c9-93d5efbc3bff"]', '2026-04-12', '08:15:00.000', NULL, '2026-04-11', NULL, 'wix:image://v1/b37fef_ce80a7ab6e3f468e870a2321b382cd57~mv2.jpg/P9230191.jpg#originWidth=3006&originHeight=1695', 'wix:image://v1/b37fef_ef768282e8d8438eb225f2d9a2a46769~mv2_d_2592_4608_s_4_2.jpg/2018-11-11%2013.11.42.jpg#originWidth=2592&originHeight=4608', '/dives/long-dong-bay/7ae1c2c2-f939-46e5-b021-4623861b26b6', '7ae1c2c2-f939-46e5-b021-4623861b26b6', '2 Shore Dives', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, NULL, 'NTD 1600 for full set including dive computer and extra shorty(recommended for current water temp).', '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, true, '["8154bbc3-f5bb-49ce-b934-61cb2eb308a7","0e299749-8b3d-4d0b-9655-cf2b146c3570"]', NULL, NULL, '2026-04-08 02:12:35+00', '2026-04-10 14:06:10+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', 'f1837f27-3dee-4ab2-a160-916e74ae0918'),
	('Cath & 4 Seas', 'Boat Dives Cathedral & 4 Seasons
', '198ca0da-41ea-4ff2-a12e-d5967a5ca574', 'a2f26412-3d8d-4c03-9ef0-e58d4d54e03e', '["5df240ae-05e0-48f3-8772-84cb63c90fc0"]', '2026-05-23', NULL, NULL, '2026-05-09', NULL, 'wix:image://v1/b37fef_544484389a4b4ce4a8ceed361a49989b~mv2.jpg/P1010162.jpg#originWidth=1155&originHeight=1732', 'wix:image://v1/b37fef_b8d5c310ae144404832bc66db041d6b0~mv2.jpg/P7110604.jpg#originWidth=1062&originHeight=1883', '/dives/cathedr/8b721a55-2f2b-4ae9-9a56-656c75239cfe', '8b721a55-2f2b-4ae9-9a56-656c75239cfe', '2 Boat Dives', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, NULL, 'NTD 1600 for full set including Dive Computer and SMB (both required for boat diving).', '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, true, '["a7c41ab9-5d17-4712-a884-dcd8926479aa","45d529b9-c16d-40e5-b4f1-fe7590c29d64","0e299749-8b3d-4d0b-9655-cf2b146c3570","3417a5cb-1757-42eb-ae5a-0288a20457b4"]', NULL, NULL, '2026-04-09 08:44:13+00', '2026-04-10 14:05:51+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', 'a2f26412-3d8d-4c03-9ef0-e58d4d54e03e'),
	('Lambai', 'Lambai', '07785aa1-a9fb-4778-af07-48762b03feaf', '06e87c1b-6f32-4126-9b84-9fb383c1bae7', '["b718703b-b6d6-43ff-b56e-f886ed67d9c5"]', '2026-02-19', NULL, '2026-02-21', '2026-02-04', NULL, 'wix:image://v1/b37fef_19a97da40a9b4784b65260a954b59585~mv2.jpg/PC310265.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/0e65aa_855f1065a5d24c7bae5b8feedeed8ae0~mv2.jpg/P7040691-Butterflyfish-Green%20Island%201.jpg#originWidth=2143&originHeight=3000', '/dives/lambai/153e1d6c-9c96-4f02-b48a-092c2298c532', '153e1d6c-9c96-4f02-b48a-092c2298c532', 'Lunar New Year''s Trip
3D2N 4 Boat Dives', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, NULL, '3200ntd for full set including dive computer and SMB (2 Days)', '1b76813a-c57c-4c1c-ae87-45a6ed389e47', '9d4c6161-5077-43a9-b5a6-4d2dd7eabdce,d927d758-e4af-4ee7-b6bd-bd67e52eb4df', true, NULL, NULL, NULL, NULL, '2026-01-16 06:20:51+00', '2026-04-10 14:06:25+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', 'f1837f27-3dee-4ab2-a160-916e74ae0918'),
	('RR + BC 3 Dives', 'Boat Dives Rainbow Reef & Crystal Temple + 1 Shore Dive at Batcave', '42f2ba4a-0b9f-4ef5-a9f3-e0e6c8e508d5', '8c141f6d-38ae-4a5b-88ea-67d9edb12146', '["f2ed912b-71f5-4b24-9122-eb00f6a206ae", "b2627255-fb70-4193-a686-bc251f0d6340", "8e938f1a-6a40-442b-97e7-bfbb624e04cf"]', '2026-06-27', NULL, NULL, '2026-06-13', NULL, 'wix:image://v1/b37fef_6cbdfe09ae2e41eb869ce0e29dcc21ce~mv2.jpg/P1010154.jpg#originWidth=1331&originHeight=751', 'wix:image://v1/b37fef_47ae5c5d39cb4212a3a21532c4311514~mv2.jpg/PA058129.jpg#originWidth=4026&originHeight=3008', '/dives/boat-dives-rainbow-reef/196e5bce-99a9-466b-b83a-fdc60c3b05fd', '196e5bce-99a9-466b-b83a-fdc60c3b05fd', '2 Boat Dives 1 Shore Dive', NULL, '023b7361-7cc3-4506-8610-13f6e22356e5', 'true', NULL, 'NTD 1600 for full set including Dive Computer and SMB (both required for boat diving).', '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, true, '["0e299749-8b3d-4d0b-9655-cf2b146c3570","45d529b9-c16d-40e5-b4f1-fe7590c29d64","22e83bc5-3fa4-4b4d-98be-6f69e9314df9"]', NULL, NULL, '2026-04-09 09:03:25+00', '2026-04-10 14:05:31+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', '8c141f6d-38ae-4a5b-88ea-67d9edb12146'),
	('LDB', 'Long Dong Bay', 'f974d3d1-49c0-4d63-a28c-076360781a3c', 'f1837f27-3dee-4ab2-a160-916e74ae0918', '["9cbfd600-7a90-470b-b9c9-93d5efbc3bff"]', '2026-04-14', '09:00:00.000', NULL, '2026-04-13', NULL, 'wix:image://v1/b37fef_7b0eff53c74d41ed80dc27ea77462778~mv2.jpg/tube%20anemone%20white%20clean%202.jpg#originWidth=4026&originHeight=3008', 'wix:image://v1/b37fef_0ce961cf435c4817a6176cf97fce0c95~mv2.jpg/P1010443.jpg#originWidth=1155&originHeight=1732', '/dives/long-dong-bay/f849f633-42f0-4407-93d4-2e1662200075', 'f849f633-42f0-4407-93d4-2e1662200075', '2 Shore Dives', NULL, '4d0645ad-1d1e-4b5a-bfca-84f6b7ad3fc3', NULL, NULL, 'NTD 1600 for full set including dive computer and extra shorty(recommended for current water temp).', '652b34df-4cb7-48ab-91dc-41ae9e2d1f29', NULL, NULL, true, '["8154bbc3-f5bb-49ce-b934-61cb2eb308a7","0e299749-8b3d-4d0b-9655-cf2b146c3570"]', NULL, NULL, '2026-04-09 12:24:03+00', '2026-04-10 14:05:22+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572', 'f9720d42-f8ab-42a6-98e2-4c15b1e4d1c5'),
	('Penghu', 'Penghu (Fully Booked)', '6f0d27de-59e9-4563-941b-51c9d1084f40', '737618b5-037a-4195-8032-1f3b1d1e21c3', '1a7fefc1-dbd4-4ef8-bcc3-aff99e098558', '2026-05-15', NULL, '2026-05-18', '2026-04-15', true, 'wix:image://v1/b37fef_336fa72d68ae4cd19dcf205ba6cc555a~mv2.jpg/P1010608.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/9f20fa_5690313d98674be0a09691ae94b556a5~mv2.jpg/Ian%20and%20Glassfish.jpg#originWidth=3008&originHeight=4008', '/dives/penghu/08ae6dd9-e926-4ae3-b6a3-490d25acc4f9', '08ae6dd9-e926-4ae3-b6a3-490d25acc4f9', '4D3N 8 Boat Dives', true, '023b7361-7cc3-4506-8610-13f6e22356e5', NULL, 50, 'Gear Rental is NTD 4800 for 3 days including a dive computer and SMB (both required for Boat Dives)', '1b76813a-c57c-4c1c-ae87-45a6ed389e47', '8b6f57f5-88b5-479f-9bd3-807e0cefed3b', true, true, '["e1046878-d0d3-4a13-bcd4-c3c4520b3c64","a713841d-b636-4577-adaa-5369dd605b37"]', 3, NULL, '2025-11-08 16:01:21+00', '2026-04-13 03:41:42+00', '0e65aa86-9c28-4ed9-8712-4d853b049ca2', '737618b5-037a-4195-8032-1f3b1d1e21c3');


--
-- Data for Name: EO_rooms; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."EO_rooms" ("title", "display_name", "added_price", "added_price_display", "per_night", "EO_prices_room_options", "_id", "Created Date", "Updated Date", "Owner", "EO_dives_room_types", "currency") VALUES
	('penghu_ensuite', 'Ensuite Room (Dbl Occupancy)', 3000, '3000NTD', NULL, '["737618b5-037a-4195-8032-1f3b1d1e21c3"]', '8b6f57f5-88b5-479f-9bd3-807e0cefed3b', '2026-03-10 03:52:35+00', '2026-03-25 08:14:12+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["08ae6dd9-e926-4ae3-b6a3-490d25acc4f9"]', NULL),
	('kenting_private', 'Ensuite Room (Sgl Occupancy)', 2400, '2400NTD', NULL, '["a6def8c2-c040-4373-a646-46ab059156e1", "06e87c1b-6f32-4126-9b84-9fb383c1bae7"]', '9754f07e-5b47-4dcb-b207-5ead4c11899e', '2026-03-10 03:51:47+00', '2026-03-27 03:34:21+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["829d3ca3-6b4a-4d4d-b74a-51fea5cf0287"]', NULL),
	('xlq_double', 'Shared Double Ensuite (Dbl Occupancy)', 1500, '1500NTD', NULL, '["06e87c1b-6f32-4126-9b84-9fb383c1bae7"]', '9d4c6161-5077-43a9-b5a6-4d2dd7eabdce', '2026-03-10 03:51:36+00', '2026-03-27 03:34:59+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["153e1d6c-9c96-4f02-b48a-092c2298c532"]', NULL),
	('kenting_double', 'Shared Double Ensuite (Dbl Occupancy)', 1700, '1700NTD', NULL, '["a6def8c2-c040-4373-a646-46ab059156e1", "6098fde5-8530-4886-8ad8-c8357586c86b"]', 'd927d758-e4af-4ee7-b6bd-bd67e52eb4df', '2026-03-10 03:51:58+00', '2026-03-25 08:14:18+00', '9f20fab4-5faf-4978-94de-a146afe4af9d', '["829d3ca3-6b4a-4d4d-b74a-51fea5cf0287", "153e1d6c-9c96-4f02-b48a-092c2298c532"]', NULL);


--
-- Data for Name: Other_Addons; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."Other_Addons" ("title", "price", "display_name", "currency", "EO_dives_other_addons", "EO_courses_other_addons", "_id", "Created Date", "Updated Date", "Owner") VALUES
	('Light Rental 1 Day', 200, 'Light Rental (1 Day)', 'NTD', '["7ae1c2c2-f939-46e5-b021-4623861b26b6","8b721a55-2f2b-4ae9-9a56-656c75239cfe","41fd5cbd-e3ff-4c29-9d8b-34f80f194134","196e5bce-99a9-466b-b83a-fdc60c3b05fd","f849f633-42f0-4407-93d4-2e1662200075"]', '["d00c7a8f-d98d-499f-bd4a-9b2f00ced954","846989e2-dd1b-47d5-a919-d44079115637"]', '0e299749-8b3d-4d0b-9655-cf2b146c3570', '2026-04-07 06:24:00+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Camera Rental 3 dive', 1000, 'Camera Rental (3 Dives)', 'NTD', '["41fd5cbd-e3ff-4c29-9d8b-34f80f194134","196e5bce-99a9-466b-b83a-fdc60c3b05fd"]', NULL, '22e83bc5-3fa4-4b4d-98be-6f69e9314df9', '2026-04-07 06:23:14+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Camera Rental 2 dive', 800, 'Camera Rental (2 Dives)', 'NTD', '["8b721a55-2f2b-4ae9-9a56-656c75239cfe"]', NULL, '3417a5cb-1757-42eb-ae5a-0288a20457b4', '2026-04-07 06:22:51+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('SMB 1 Day', 100, 'SMB Rental', 'NTD', '["8b721a55-2f2b-4ae9-9a56-656c75239cfe","41fd5cbd-e3ff-4c29-9d8b-34f80f194134","196e5bce-99a9-466b-b83a-fdc60c3b05fd"]', NULL, '45d529b9-c16d-40e5-b4f1-fe7590c29d64', '2026-04-07 06:20:26+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Camera Rental 1 dive', 500, 'Camera Rental (1 Dive)', 'NTD', NULL, NULL, '5165524d-4b81-4614-88f4-cff472951ea9', '2026-04-07 06:21:18+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('AOW South', 10500, 'Advanced Open Water Course', 'NTD', NULL, NULL, '71d9784d-e506-4dc5-8fde-90ec622714bd', '2026-04-06 08:30:15+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Deep South', 5800, 'Deep Specialty Course', 'NTD', '["829d3ca3-6b4a-4d4d-b74a-51fea5cf0287"]', NULL, '75a877da-1931-4cb6-b669-84d5b7071ed4', '2026-04-06 08:29:07+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Shorty 1 day', 100, 'Extra Shorty Wetsuit (1 day)', 'NTD', '["7ae1c2c2-f939-46e5-b021-4623861b26b6","f849f633-42f0-4407-93d4-2e1662200075"]', NULL, '8154bbc3-f5bb-49ce-b934-61cb2eb308a7', '2026-04-07 06:25:08+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('SMB 2 days', 200, 'SMB Rental (2 Days)', 'NTD', '["829d3ca3-6b4a-4d4d-b74a-51fea5cf0287"]', NULL, '8250698a-41ae-4ba9-b7cf-4bdc5516b224', '2026-04-07 04:53:27+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Light Rental 2 Days', 400, 'Light Rental (2 Days)', 'NTD', NULL, '["5f472d80-d246-4730-bff5-093d6c055d0c"]', '889c458a-f046-470e-b624-e3267cdca9ea', '2026-04-07 06:24:24+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Light Rental 3 Days', 600, 'Light Rental (3 Days)', 'NTD', '["08ae6dd9-e926-4ae3-b6a3-490d25acc4f9"]', NULL, 'a713841d-b636-4577-adaa-5369dd605b37', '2026-04-07 06:24:49+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('EANx during trip', 6400, 'Enriched Air(Nitrox) Specialty Course', 'NTD', '["8b721a55-2f2b-4ae9-9a56-656c75239cfe"]', NULL, 'a7c41ab9-5d17-4712-a884-dcd8926479aa', '2026-04-06 08:29:41+00', '2026-04-09 08:42:39+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('Shorty 2 days', 200, 'Extra Shorty Wetsuit (2 days)', 'NTD', NULL, '["5f472d80-d246-4730-bff5-093d6c055d0c"]', 'b12da045-7328-499b-98e5-24173d87f02c', '2026-04-07 06:25:52+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('EFR Course Discount', 3920, 'EFR Course', 'NTD', NULL, '["146c37ea-dd58-46cf-b146-c88afa78b683"]', 'bd523b91-080b-4f0a-b747-dff6f7d724f1', '2026-04-16 03:51:00+00', '2026-04-16 03:51:00+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
	('SMB 3 Day', 300, 'SMB Rental (3 Days)', 'NTD', '["08ae6dd9-e926-4ae3-b6a3-490d25acc4f9"]', NULL, 'e1046878-d0d3-4a13-bcd4-c3c4520b3c64', '2026-04-07 06:20:59+00', '2026-04-09 08:41:01+00', 'b37fefa3-09b1-4e00-a824-f6b884e43572');


-- activities table was removed (see migration 20260421150000).


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."profiles" ("id", "created_at", "updated_at", "full_name", "display_name", "phone", "date_of_birth", "nationality", "id_number", "emergency_contact_name", "emergency_contact_phone", "cert_agency", "cert_level", "cert_number", "cert_date", "medical_notes", "avatar_url", "role", "height_cm", "weight_kg", "shoe_size", "gender", "contact_method", "contact_id", "nitrox_certified", "logged_dives", "last_dive_date") VALUES
	('8ac28aa7-2091-4d3f-aa31-a3a55c2fdc22', '2026-04-16 11:45:20.042382+00', '2026-04-16 11:45:20.042382+00', 'person one', 'mr person', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'diver', NULL, NULL, NULL, NULL, NULL, NULL, false, 0, NULL),
	('962f07ec-ce11-4eef-bf41-219f86b49cd4', '2026-04-16 12:14:56.776354+00', '2026-04-16 12:14:56.776354+00', 'billy two', 'b dawg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'diver', NULL, NULL, NULL, NULL, NULL, NULL, false, 0, NULL),
	('11111111-1111-1111-1111-111111111111', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', 'Test Diver', 'Diver', '+886-900-000-000', '1992-07-14', 'Taiwanese', 'A123456789', 'Emergency Contact', '+886-900-000-001', 'PADI', 'Advanced Open Water', 'PADI-AOW-2023-042', '2023-06-10', 'Mild shellfish allergy', NULL, 'diver', 172.0, 68.0, 'EU 41', 'male', 'whatsapp', '+886-900-000-000', false, 15, '2026-03-15'),
	('22222222-2222-2222-2222-222222222222', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', 'Alice Chen', 'Alice', '+886-912-345-678', '1995-03-22', 'Taiwanese', NULL, 'Chen Wei', '+886-912-000-001', 'PADI', 'Advanced Open Water', 'PADI-AOW-2024-001', '2024-02-18', NULL, NULL, 'diver', 165.0, 55.0, 'EU 38', 'female', 'line', 'alice-line', true, 32, '2026-03-28'),
	('33333333-3333-3333-3333-333333333333', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', 'Bob Williams', 'Bob', '+1-555-234-5678', '1988-11-05', 'American', NULL, 'Sarah Williams', '+1-555-234-0000', 'SSI', 'Open Water', 'SSI-OW-2023-042', '2023-04-07', NULL, NULL, 'diver', 183.0, 82.0, 'US 11', 'male', 'phone', '+1-555-234-5678', false, 8, '2026-01-10'),
	('44444444-4444-4444-4444-444444444444', '2026-04-21 01:31:27.817174+00', '2026-04-21 01:31:27.817174+00', 'Test Admin', 'Admin', '+886-900-000-100', '1985-02-20', 'Taiwanese', NULL, 'Admin Emergency Contact', '+886-900-000-101', 'PADI', 'Divemaster', 'PADI-DM-2020-007', '2020-08-15', NULL, NULL, 'admin', 178.0, 75.0, 'EU 43', 'female', 'whatsapp', '+886-900-000-100', true, 512, '2026-04-15');


-- Seed bookings for diver@diver.diver (11111111…) and admin@admin.admin (44444444…).
-- Admins can also hold bookings as divers. Real EO_dive / EO_course _ids above.
INSERT INTO "public"."bookings" ("id", "created_at", "user_id", "eo_dive_id", "eo_course_id", "status", "notes") VALUES
	('b0000000-0000-0000-0000-000000000001', '2026-04-21 01:31:27.817174+00', '11111111-1111-1111-1111-111111111111', '829d3ca3-6b4a-4d4d-b74a-51fea5cf0287', NULL, 'confirmed', NULL),
	('b0000000-0000-0000-0000-000000000002', '2026-04-21 01:31:27.817174+00', '11111111-1111-1111-1111-111111111111', '08ae6dd9-e926-4ae3-b6a3-490d25acc4f9', NULL, 'pending', 'Ask about tank rental'),
	('b0000000-0000-0000-0000-000000000003', '2026-04-21 01:31:27.817174+00', '11111111-1111-1111-1111-111111111111', NULL, 'a39a1c3f-c108-42e5-b800-d85ba1dfe9a8', 'confirmed', NULL),
	('b0000000-0000-0000-0000-000000000004', '2026-04-21 01:31:27.817174+00', '44444444-4444-4444-4444-444444444444', '41fd5cbd-e3ff-4c29-9d8b-34f80f194134', NULL, 'confirmed', 'Assisting as DM'),
	('b0000000-0000-0000-0000-000000000005', '2026-04-21 01:31:27.817174+00', '44444444-4444-4444-4444-444444444444', NULL, 'c4a44d82-8bc3-4b00-93aa-a41f7ae0615b', 'pending', NULL);


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."payments" ("id", "created_at", "user_id", "booking_id", "amount", "currency", "status", "method", "note", "recorded_by") VALUES
	('24e2e45a-6cf2-4f18-9003-da723f45ea5a', '2026-04-21 01:31:27.817174+00', '22222222-2222-2222-2222-222222222222', NULL, 2800.00, 'TWD', 'paid', 'Bank transfer', 'Paid in full', '44444444-4444-4444-4444-444444444444'),
	('26325f69-72fe-4c5f-b30e-914686a485d2', '2026-04-21 01:31:27.817174+00', '33333333-3333-3333-3333-333333333333', NULL, 2800.00, 'TWD', 'paid', 'Bank transfer', 'Paid in full', '44444444-4444-4444-4444-444444444444'),
	('0ac31368-add0-4d96-a98e-597b525bf80c', '2026-04-21 01:31:27.817174+00', '33333333-3333-3333-3333-333333333333', NULL, 18000.00, 'TWD', 'paid', 'Bank transfer', 'Paid in full', '44444444-4444-4444-4444-444444444444'),
	('23a69e47-269a-4f36-a9a7-3992e532c338', '2026-04-21 01:31:27.817174+00', '11111111-1111-1111-1111-111111111111', NULL, 2800.00, 'TWD', 'pending', NULL, 'Awaiting payment', '44444444-4444-4444-4444-444444444444');


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 15, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict TtMW9zHTPlP95fyaFWtgpdwfT52R8gYglW1bXVX6rCkCKWcLOIQTJTb0Hk7t6gQ

RESET ALL;
