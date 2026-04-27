-- Backfill public."DiveTravel" with the 60-row export from the Wix
-- collection (DiveTravel.csv). Pre-migration the table was empty and
-- the EO_dives.DiveTravel_reference FK was deferred; with rows now
-- present we add and validate the FK.
--
-- Extra columns (slug / event_type / picture / description / details /
-- prerequisites / itinerary / event_date / price / sort_order /
-- trip_link / planned_trip / details_document / local_event_link /
-- local / trip / tagline / tagline_text) come along so the full Wix
-- export survives — upcoming_dives only uses included / not_included /
-- transportation today, but admins may want the rest later.

begin;

alter table public."DiveTravel"
  add column slug text,
  add column event_type text,
  add column picture text,
  add column description text,
  add column tagline text,
  add column tagline_text text,
  add column details text,
  add column prerequisites text,
  add column itinerary text,
  add column event_date text,
  add column price text,
  add column sort_order timestamptz,
  add column trip_link text,
  add column planned_trip boolean,
  add column details_document text,
  add column local_event_link text,
  add column local boolean,
  add column trip boolean;

insert into public."DiveTravel" (_id, title, included, not_included, transportation, slug, event_type, picture, description, tagline, tagline_text, details, prerequisites, itinerary, event_date, price, sort_order, trip_link, planned_trip, details_document, local_event_link, local, trip, "Created Date", "Updated Date", "Owner") values
  ('00055e84-c763-44e8-9efc-929cc5a70d65', 'Yehliu 4BD EANx', 'Transportation(if needed), Local Diving Insurance, 4 Boat Dives, 4 Nitrox Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/yehliu-boat-diving/jun-26', 'Local Boat Diving', 'wix:image://v1/b37fef_eb9fd3a1bacc4befbd13f008acbf22b6~mv2_d_2000_1333_s_2.jpg/Boat%20Diving.jpg#originWidth=2000&originHeight=1333', '<p class="font_8">Fun Divers Tw is heading out to Yehliu to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.&nbsp;</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</p>', 'Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!', '<p class="font_8"><u>費用包含：</u><br>
交通，船潛兩支高氧，潛導，個人指位無線電示標<br>
Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Locator Beacon<br>
<br>
<u>團費 Tour Price</u>: $3,200</p>
<p class="font_8"><br></p>
<p class="font_8"><u>課程Courses:</u></p>
<p class="font_8">高氧課程 $5,600 (原價 $6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)<br>
<br>
<u>額外費用 Additional:</u><br>
一天基本裝備租借 Basic Equipment Rental: $1200<br>
<br>
潛水錶租借 (必備) Computer Rental <strong>(required):</strong> $300<br>
<br>
浮力袋租借(必備) SMB Rental <strong>(required): </strong>$150<br>
<br>
潛水險 (必要) Diving Insurance <strong>(required):</strong> $400<br>
</p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額<br>
Please transfer the total As Soon As Possible to confirm your seat.<br>
<br>
匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904<br>
分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品<br>
＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Sun Protection</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>*Dive Location may change due to weather conditions</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><u>Schedule:</u></p>
<p class="font_8"><br></p>
<p class="font_8">06:15 Meet at Fun Divers Tw<br>
06:30 Depart Fun Divers Tw<br>
07:30 Meet at Port<br>
08:00 Boat Departs<br>
12:00 Boat Returns<br>
12:30 Wash Gear/Shower<br>
13:30 Lunch<br>
14:30 Depart for Taipei<br>
15:30 Arrive Fun Divers Tw<br>
&nbsp;<br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip<br>
• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip<br>
• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW & Nitrox Certification Required', '06:15 - Meet at Fun Divers
07:30 - Meet at Port
08:00 - Boat Departs
17:00 - Boat Returns (wash gear at port)
17:30 - Depart for Taipei', 'Jun 26', '3,200 NTD', '2021-06-25T20:00:00Z', NULL, false, NULL, 'cce2ddd8-cd87-4657-b7e2-3188c07af34a', true, NULL, '2021-03-26T04:13:32Z', '2026-04-09T08:36:25Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('01cf0fc7-b7db-4653-bb29-92d6e9274d29', '82.5', NULL, NULL, NULL, '/DiveTravel/82.5/2024-03-31', 'Local Shore Diving', 'wix:image://v1/b37fef_e737e654b94f4e6a91e2e5a523e3054f~mv2_d_4026_3008_s_4_2.jpg/nudi%20blue%20and%20yellow%20smaller.jpg#originWidth=4026&originHeight=3008', '<p class="font_8">A beautiful dive site with a wall to dive along.&nbsp; Keep your eyes open for the Pikachu Nudibranch!</p>', '<p class="font_8">A beautiful dive site with a wall to dive along.&nbsp; Keep your eyes open for the Pikachu Nudibranch!</p>', NULL, '<p class="font_8">Come out and explore 82.5 with Fun Divers!</p>
<p class="font_8"><br></p>
<p class="font_8">We will depart Fun Divers Tw at 8:30am so please arrive by 8:15am. If you are meeting at the dive site, we should arrive by 9:15am</p>
<p class="font_8"><br>
RSVP early since there are limited spots available.</p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額<br>
</p>
<p class="font_8">Please transfer the total amount As Soon As Possible to confirm your seat.<br>
<br>
Please transfer payments to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Be sure to bring sun protection, snacks, water, and swimsuit.<br>
<br>
If you have any questions about courses or any other events, please feel free to send us a message!</p>', 'Advanced Certification Required', NULL, '2024-03-31', '1,500NTD', '2019-10-10T16:00:00Z', NULL, true, NULL, '5efcc605-3086-420b-a15c-43694ece1237', true, NULL, '2019-07-25T11:26:05Z', '2026-04-16T13:21:20Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('07785aa1-a9fb-4778-af07-48762b03feaf', 'Lambai Island/Xiao Liuqiu', 'Return Ferry Tickets, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 2 Days Full Coverage Local Diving Insurance.', 'Additional Food, Drinks & Entertainment are NOT included.
Optional Night Dive is NOT included.', 'You can take the HSR and meet us at the hotel in Kaohsiung and then travel to the Ferry Port with us.  
Round Trip Transportation with us is 1300NTD', NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_8ea21518788d4905a979167bb7802232~mv2_d_4043_3032_s_4_2.jpg/turtle%20swimming.JPG#originWidth=4043&originHeight=3032', '<p class="font_8">A weekend trip to Lambai Island to enjoy some time away from the city!&nbsp; We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!&nbsp; Come join us on this wonderful trip and see why divers love Xiao Liuqiu!</p>', '<p class="font_8">A multi-day trip to a&nbsp;beautiful coral Island off the coast of Kaohsiung. Turtles galore!&nbsp; Come explore this gem with Fun Divers Tw!</p>', 'A weekend trip to Lambai Island to enjoy some time away from the city!  We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!  Come join us on this wonderful trip and see why divers love Xiao Liuqiu!', '<p class="font_8">小琉球 小琉球 Beautiful Lambai</p>
<p class="font_8"><br></p>
<p class="font_8">A weekend trip to Lambai Island to enjoy some time away from the city! We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening! Come join us on this wonderful trip and see why divers love Xiao Liuqiu!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">往返東港船票， 兩晚上住宿 ，早餐 x 2，午餐 x 2，晚餐 x 1，機車(兩人一台)，船潛四支，岸潛一支, 潛水險。</p>
<p class="font_8"><br></p>
<p class="font_8">Included:</p>
<p class="font_8">Round Trip Ferry, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 1 Shore Dive, Diving Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">＊額外之餐費與娛樂費用請自理</p>
<p class="font_8">Additional Food, Drinks &amp; Entertainment are NOT included</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price:</p>
<p class="font_8">背包房 Bunk Room: $11,800</p>
<p class="font_8">雙人房 Basic Double Room: $13,500 (double occupancy) (limited availability)</p>
<p class="font_8">Private room: $15,500</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用Additional:</p>
<p class="font_8">兩天裝備租借 Basic Equipment Rental: $1,200 x 2 days</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1,600 x 2 days</p>
<p class="font_8">(includes Dive Computer and SMB)</p>
<p class="font_8">台北東港來回交通費 Return Transport Taipei-Donggang port: $1,600</p>
<p class="font_8">Transport Kaohsiung-Donggang - $300</p>
<p class="font_8">Optional Night Dive: $1000</p>
<p class="font_8">Light Rental: $200</p>
<p class="font_8"><br></p>
<p class="font_8">課程Courses:</p>
<p class="font_8">高氧課程 Enriched Air Nitrox Specialty $6,400 (原價 Normal Price $7,200)</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,800 (原價 Normal Price $6,800)</p>
<p class="font_8">進階課程 Advanced Open Water $11,200 (原價 Normal Price $12,500)</p>
<p class="font_8"><br></p>
<p class="font_8">行程 Approximate Itinerary:</p>
<p class="font_8"><br></p>
<p class="font_8">Day 1</p>
<p class="font_8">16:00 離開台北Depart Fun Divers Dive Center (earlier if possible)</p>
<p class="font_8">20:00飯店Hotel Kaohsiung</p>
<p class="font_8"><br></p>
<p class="font_8">Day 2</p>
<p class="font_8">07:00 早餐 Breakfast</p>
<p class="font_8">08:00 出發 Depart</p>
<p class="font_8">09:00 東港漁港 Donggang Dock－小琉球 Liu Qiu Island</p>
<p class="font_8">10:00 安潛一支 1 Shore Dive</p>
<p class="font_8">11:30 中餐 Lunch</p>
<p class="font_8">12:30 船潛兩支 2 Boat Dives</p>
<p class="font_8">18:00 吃到飽烤肉 All you can eat BBQ Dinner</p>
<p class="font_8"><br></p>
<p class="font_8">Day 3</p>
<p class="font_8">07:30 早餐Breakfast</p>
<p class="font_8">08:00 船潛兩支 2 Boat Dives</p>
<p class="font_8">12:30 中餐 Lunch</p>
<p class="font_8">14:00 小琉球 Liu Qiu Island ─ 東港 Donggang</p>
<p class="font_8">14:30 離開東港 Depart from Donggang</p>
<p class="font_8">20:30 抵達台北 Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請於匯入訂金 $8,000 Please transfer $8,000 deposit to confirm your booking.</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to:</p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀⾏：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分⾏：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶 Remember to Bring:</p>
<p class="font_8">- 證照卡 Certification Card</p>
<p class="font_8">- 潛水日誌 Log Book</p>
<p class="font_8">- 電腦表 Dive Computer(required) (rental 300/day)</p>
<p class="font_8">- 浮力棒 (SMB) Surface Marker Buoy(required) (rental 150/day)</p>
<p class="font_8">- 暈船藥 Seasick Pills</p>
<p class="font_8">- 防賽 Sun Protection</p>
<p class="font_8">- 大毛巾Towel</p>
<p class="font_8">- 薄夾克Jacket</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</p>
<p class="font_8">· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</p>
<p class="font_8">· 07天前取消，不予以退費 － Within 7 days of trip, no refund</p>', 'Advanced Certification Recommended', 'Day 1
16:00 離開台北Depart Fun Divers Dive Center (earlier if possible)
20:00飯店Hotel Kaohsiung

Day 2
07:00 早餐 Breakfast
08:00 出發 Depart
09:00 東港漁港 Donggang Dock－小琉球 Liu Qiu Island
10:00 安潛一支 1 Shore Dive
11:30 中餐 Lunch
12:30 船潛兩支 2 Boat Dives
18:00 吃到飽烤肉 All you can eat BBQ Dinner

Day 3
07:30 早餐Breakfast
08:00 船潛兩支 2 Boat Dives
12:30 中餐 Lunch
14:00 小琉球 Liu Qiu Island ─ 東港 Donggang
14:30 離開東港 Depart from Donggang
20:30 抵達台北 Arrive in Taipei', NULL, 'Starting at 10,200 NTD', '2020-05-14T16:00:00Z', 'b718703b-b6d6-43ff-b56e-f886ed67d9c5', false, NULL, NULL, NULL, true, '2019-01-06T07:46:06Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('16292936-767d-465c-b58d-82a81604924f', 'Yehliu Boat Diving', NULL, NULL, NULL, '/DiveTravel/yehliu-boat-diving/sep-5', 'Boat Diving', 'wix:image://v1/b37fef_dea5801e2b484d25abdbbcaea90af9a9~mv2.jpg/2020-07-25%2015.24.30.jpg#originWidth=800&originHeight=533', '<p class="font_8">Fun Divers Tw will visit Yehliu Geo Park for some boat diving! &nbsp;Come relax and check out the scenery above and below the water at Yehliu!</p>', '<p class="font_8">Yehliu Geo Park has stunning scenery both above and below the water! &nbsp;Come explore this beautiful place with Fun Divers Tw!</p>', NULL, '<p class="font_8">野柳 Yeliu</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含: 船潛兩支高氧,<br>
Included: 2 Boat Nitrox Dives</p>
<p class="font_8"><br></p>
<p class="font_8">＊餐費用請自理</p>
<p class="font_8">Food and Drinks are NOT included</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: &nbsp;$4,000</p>
<p class="font_8">交通費用 Return Transport: $200</p>
<p class="font_8"><br></p>
<p class="font_8">(交通車有8個位子Total of 10 spots reserved)</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用Additional:<br>
 兩天裝備租借Full Equipment Rental: $1,200</p>
<p class="font_8"><br></p>
<p class="font_8">10:30 瘋潛水集合 Meet at Fun Divers Dive Center</p>
<p class="font_8"><br></p>
<p class="font_8">課程Courses:</p>
<p class="font_8">高氧課程 $5,000 (原價 $5,800) -- Enriched Air Nitrox Specialty $5,200 (Normal $6,000)</p>
<p class="font_8">深潛課程$5,000) -- Deep Dive Specialty $5,200 (Normally $6,000)</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
 中國信託銀行：822<br>
 帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶防曬用品,浮力袋(船潛必備)，電腦表，紀錄書， 身份證號或居留證號</p>
<p class="font_8">＊Remember to Bring: Certification Card, Log Book, Dive Computer, Surface Marker Buoy (SMB)</p>
<p class="font_8"><br></p>
<p class="font_8"><u>臨時取消行程之賠償金額 Cancellation Fee</u></p>
<p class="font_8">· 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip</p>
<p class="font_8">· 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip</p>
<p class="font_8">· 5天前取消，不予以退費 － Within 5 days of trip price, there will be no refund</p>', 'Advanced and Nitrox Certification Required', NULL, 'Sep 5', '4,000 NTD', '2020-09-04T17:00:00Z', NULL, false, NULL, 'cce2ddd8-cd87-4657-b7e2-3188c07af34a', true, NULL, '2020-08-10T07:02:54Z', '2026-04-09T08:14:50Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('1743a1b4-0d48-409f-a7bf-e8d1c399dc12', 'Lamay Island', 'Return Ferry Tickets, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 2 Days Full Coverage Local Diving Insurance.', NULL, NULL, NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_f76afdb6881e495392d867a3b5697132~mv2_d_4608_3456_s_4_2.jpg/turtle%20closeup%20smaller.JPG#originWidth=4608&originHeight=3456', '<p class="font_8 p1"><span style="font-family: corben, serif">A weekend trip to Lamay Island to enjoy some time away from the city!&nbsp; We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!&nbsp; Come join us on this wonderful trip and see why divers love Xiao Liuqiu!</span></p>', '<p class="font_8 p1"><span style="font-family: corben, serif">A multi-day trip to a&nbsp;beautiful coral Island off the coast of Kaohsiung. Turtles galore!&nbsp; Come explore this gem with Fun Divers Tw!</span></p>', 'A weekend trip to Lambai Island to enjoy some time away from the city!  We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!  Come join us on this wonderful trip and see why divers love Xiao Liuqiu!', '<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">小琉球 小琉球 Lambai Lambai</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">費用包含：</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">往返東港船票， 兩晚上住宿 ，早餐 x 2，午餐 x 2，晚餐 x 1，機車(兩人一台)，船潛四支， 岸潛一支。</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Included:</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Return Ferry, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 1 Shore Dive.</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊額外之餐費與娛樂費用請自理</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Additional Food, Drinks &amp; Entertainment are NOT included</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">團費 Tour Price:</span><br />
雙人房 Double Room: $10,800 (double occupancy)<br />
背包房Capsule Room: $10,200</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">(交通車有8個位子 Total of 8 spots reserved)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">歡迎非潛水員參加 Non-Divers are also welcome to join $5,800</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">額外費用 Additional:</span><br />
兩天裝備租借 Full Equipment Rental: $1,200 x 2<br />
台北東港來回交通費 Return Transport: $1,400</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">課程 Courses:</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">高氧課程 $4,800 (原價 $5,500) -- Enriched Air Nitrox Specialty $5,200 (Normal $6,000)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">深潛課程 $4,800 (原價 $5,600) -- Deep Dive Specialty $4,800 (Normally $6,000)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">進階課程 $8,000 (原價 $10,000) -- Advanced Open Water $8,400 (Normally $10,400)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">初級課程 $10,600 (原價 $13,900) -- Open Water Course $11,000 (Normally $14,400)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊ 請於匯入訂金$8,000 Please transfer $8,000 deposit to confirm your booking.</span></span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">餘款需於02/21付清 The remaining balance must be paid by 02/21.</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br />
中國信託銀行：822<br />
帳號：1305 4100 1904</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">Please transfer the deposit to:</span><br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904</span><br />
&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊記得攜帶防曬用品,浮力袋(船潛必備)，電腦表，紀錄書， 身份證號或居留證號</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊Remember to Bring:</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- Certification Card</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- Log Book</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- ARC No. or Passport No. / ID Card No.</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- Surface Marker Buoy (SMB) &ndash; (Highly recommended)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">臨時取消行程之賠償金額 Cancellation Fee</span></span></p>

<ul class="font_7" style="font-family:avenir-lt-w01_35-light1475496,sans-serif">
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</span></p>
	</li>
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</span></p>
	</li>
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</span></p>
	</li>
</ul>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">行程 Approximate Itinerary:</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Day 1</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">20:00 土城捷運第一出口集合 Meet at Tucheng MRT Station Exit 1<br />
00:00 中央飯店 Centre Hotel Kaohsiung</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Day 2</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">07:30 早餐 Breakfast</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">08:00 出發 Depart</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">09:00 東港漁港 Donggang Dock－小琉球 Liu Qiu Island</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">10:00 安潛一支 1 Shore Dive</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">11:30 中餐 Lunch</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">12:30 船潛兩支 2 Boat Dives</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">18:00 吃到飽烤肉 All you can eat BBQ Dinner</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Day 3</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">07:30 早餐Breakfast</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">08:00 船潛兩支 2 Boat Dives</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">12:30 中餐 Lunch</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">13:30 自由時間 Free Time</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">15:00 小琉球 Liu Qiu Island ─ 東港 Donggang</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">16:00 離開東港 Depart from Donggang</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">21:30 抵達台北 Arrive in Taipei</span></p>', 'Advanced Certification Recommended', NULL, NULL, '10,200 NTD', '2020-02-20T16:00:00Z', 'b718703b-b6d6-43ff-b56e-f886ed67d9c5', false, NULL, NULL, NULL, true, '2019-08-16T12:24:12Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('185d5385-d581-47ba-a27c-42e63eca4b78', 'East Coast PM 2BD Air', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/cauliflower-garden/oct-02', 'Boat Diving', 'wix:image://v1/b37fef_519ef15551bd481c824f50e9b6ece493~mv2.jpg/cauliflowers.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">We will be doing 2 boat dives on the East Coast of Taiwan. One will be at Cauliflower Garden, the other at the Power Plant Outflow. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring two different dive sites!</p>', 'Come explore the East Coast with Fun Divers Tw!  We will be trying to find dolphins and exploring two different dive sites!', '<p class="font_8">Cauliflower Garden and Power Plant Outflow</p>
<p class="font_8"><br></p>
<p class="font_8">Come check out the Beautiful Cauliflower Garden and Power Plant Outflow with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支，潛導，潛水保險</p>
<p class="font_8">Included: Transportation, 2 Boat Dives, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,600</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8"><br></p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200<br>
 全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Dive Computer – All divers MUST have<br>
- Surface Marker Buoy (SMB) – All divers MUST have</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW Certification Required', '10:50 - Meet at Fun Divers
12:30 - Meet at Port
13:00 - Boat Departs
17:00 - Boat Returns (wash gear at port)
17:30 - Depart for Taipei', 'Oct 02', '3,600 NTD', '2022-10-01T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2026-04-09T08:18:04Z', '2026-04-09T08:30:39Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('198ca0da-41ea-4ff2-a12e-d5967a5ca574', 'East Coast AM 2BD Air', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/cauliflower-garden/oct-02', 'Boat Diving', 'wix:image://v1/b37fef_519ef15551bd481c824f50e9b6ece493~mv2.jpg/cauliflowers.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">We will be doing 2 boat dives on the East Coast of Taiwan. One will be at Cauliflower Garden, the other at the Power Plant Outflow. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring two different dive sites!</p>', 'Come explore the East Coast with Fun Divers Tw!  We will be trying to find dolphins and exploring two different dive sites!', '<p class="font_8">Cauliflower Garden and Power Plant Outflow</p>
<p class="font_8"><br></p>
<p class="font_8">Come check out the Beautiful Cauliflower Garden and Power Plant Outflow with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支，潛導，潛水保險</p>
<p class="font_8">Included: Transportation, 2 Boat Dives, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,600</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8"><br></p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200<br>
 全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Dive Computer – All divers MUST have<br>
- Surface Marker Buoy (SMB) – All divers MUST have</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW Certification Required', '05:20 - Meet at Fun Divers
06:30 - Meet at Port
07:00 - Boat Departs
12:00 - Boat Returns (wash gear at port)
12:30 - Depart for Taipei', 'Oct 02', '3,600 NTD', '2022-10-01T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2026-04-09T08:17:22Z', '2026-04-09T08:30:32Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('20852f95-21ad-4b64-881e-af7b1cc90eaf', 'Penghu', NULL, NULL, NULL, '/DiveTravel/penghu/jun-9-12', 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_9e2d13b565044a9fa4520902f6599a17~mv2.jpg/308645903_907275396923498_333093198297937161_n.jpg#originWidth=900&originHeight=600', '<p class="font_8">Fun Divers Tw is heading to the remote islands of Penghu! &nbsp;We will be doing 8 boat dives over 3 days in the amazing Nanfangsidao National Park.&nbsp;Come join us and see why this beautiful place is at the top of divers'' lists in Taiwan!</p>', '<p class="font_8">Penghu is considered a Must-See dive destination in Taiwan due to its beauty and remoteness! Space is limited, so book early to secure your spot!</p>', NULL, '<p class="font_8"><strong>跟瘋潛水去澎湖! Dive Penghu with Fun Divers Tw!</strong></p>
<p class="font_8">由於澎湖的距離與美景, 它是台灣必潛景點之一!<br>
名額有限, 請盡快報名!</p>
<p class="font_8"><br></p>
<p class="font_8">Penghu is considered a Must-See dive destination in Taiwan due to its beauty and remoteness! By far, the best diving in all of Taiwan! Space is limited, better book early to secure your spot!</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>團費Tour Price:</strong></u></p>
<p class="font_8">上下舖 Bunk Room (shared bathroom): 27,200NTD/each 台幣27,200/人<br>
上下套房 Bunk Room (Ensuite): 31,000ntd/each (Double occupancy) &nbsp;台幣31,000/人(兩人一房)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>費用包含 Included:</strong></u></p>
<p class="font_8">潛水：3日8支船潛(含導潛)<br>
將軍島的餐點住宿上全包<br>
兩人一台機車<br>
三天潛水保險<br>
導潛小費<br>
三天GPS定位信標</p>
<p class="font_8"><br></p>
<p class="font_8">Dives: 3 Days, 8 Boat Dives (Dive Guides Included)<br>
Meals and Accommodation on Jiang Jun Island<br>
Shared Motorbike<br>
3 Days of Full Diving Insurance<br>
Divemaster Tips (1000ntd/each)<br>
3 Days Locator Beacon Rental</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>❋團費不包含Package does not include:</strong></u></p>
<p class="font_8">三天基本裝備租借 Basic Equipment Rental: $1,200 x 3 days<br>
三天全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1,600 x 3 days (includes Dive Computer and SMB)<br>
馬公台北來回，原則上以飛機為主(機票約 $4400)Taipei-Magong flights (approximately 4400ntd)<br>
潛水裝備超重行李費(超過10 公斤, $15/公斤) Oversize baggage surcharge for Dive Gear (15ntd/kg over 10kg)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>行程 Approximate Itinerary:</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>06/09</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>06:00</strong> 松山機場集合Meet at Taipei Songshan Airport</p>
<p class="font_8"><strong>07:00</strong> 松山機場起飛Depart from Songshan Airport</p>
<p class="font_8"><strong>08:00</strong> 抵達馬公機, 搭乘計程車到碼頭Arrive at Magong Airport and Taxi to Port</p>
<p class="font_8"><strong>09:00</strong> 乘船到將軍嶼, 安排房間, 享用午餐. Ferry to Jiang Jun Island. Check into rooms and have lunch</p>
<p class="font_8">下午Afternoon: 船潛2支, 2 Boat Dives</p>
<p class="font_8">傍晚Evening: 晚餐 Dinner</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>06/10 &amp; 06/11</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8">南方四島船潛, 每天各3支加3餐. 潛點依當天氣候和海況決定.<br>
Daily Itinerary will vary depending on dive conditions and dive locations. There will be 3 Dives both days in Nan Fang Si National Park as well as breakfast, lunch and dinner.</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>06/12</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>07:00</strong> 搭船回馬公Ferry back to Magong</p>
<p class="font_8"><strong>12:15</strong> 馬公機場起飛Depart Magong Airport</p>
<p class="font_8"><strong>13:10</strong> 抵達台北 Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊ 保確您的名額, 請匯入訂金$15,000<br>
Please transfer $15,000 deposit to confirm your booking.</strong></p>
<p class="font_8"><br></p>
<p class="font_8">餘款需於05/20付清 The remaining balance must be paid by 05/20.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶防曬用品、浮力袋(船潛必備) 、電腦錶(船潛必備) 、紀錄書、暈船藥、浴巾，身份證號或居留證號、潛水流鉤 (必備)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊Remember to Bring:</strong></p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Seasick Pills (if necessary)</p>
<p class="font_8">- Towel</p>
<p class="font_8">- ARC No. or Passport No. / ID Card No.</p>
<p class="font_8">- Surface Marker Buoy (SMB) – (Required for boat dives)</p>
<p class="font_8">- Dive Computer (Required for boat dives)</p>
<p class="font_8">- Reef Hook (Required)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>注意事項Notes:</strong></u></p>
<p class="font_8"><strong>- </strong>潛水員必須自行訂購松山-澎湖來回機票. 我們建議先盡快訂購松山到澎湖的航班. 在訂購機票前, 請來電跟我們確認.</p>
<p class="font_8"><strong>- </strong>在澎湖潛水,有可能遇上強大的海流和有深度的潛點, 是具有挑戰性的. 參加的潛水員需備進階執照及50支氣瓶以上</p>
<p class="font_8"><strong>- </strong>如有特殊狀況發生(如天災: 颱風, 地震)而滯留, 須追加食宿費用.</p>
<p class="font_8"><br></p>
<p class="font_8">- <strong>Divers must book their own flights to Magong from Songshan. We recommend booking the flight as soon as possible.</strong> &nbsp;Please get in touch with us before booking the flight.</p>
<p class="font_8">- The dives in Penghu are challenging with possible strong currents and deeper dive sites. All divers must be advanced certified with a minimum of 50 dives.</p>
<p class="font_8">- In the event of an overstay being required due to emergencies (typhoon, earthquake, etc.) the diver will be responsible for any additional charges incurred.</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>臨時取消行程之賠償金額 Cancellation Fee</strong></u></p>
<p class="font_8">60天前取消，行程費用之25% － 25% of Deposit within 60 days of the trip<br>
30天前取消，行程費用之50% － 50% of Deposit within 30 days of the trip<br>
21天前取消，不予以退費 － Within 21 days of trip, there will be no refund</p>', 'Advanced Certified with 50 Dives', NULL, 'Jun 9-12', 'Starting at 27,200 NTD', '2023-06-08T16:00:00Z', '1a7fefc1-dbd4-4ef8-bcc3-aff99e098558', true, NULL, NULL, NULL, true, '2021-01-10T12:59:48Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('210bd0d7-93e4-4951-bc99-c5f3347089dd', 'Anilao, Philippines', NULL, NULL, NULL, '/DiveTravel/anilao%2C-philippines/2023-jan-24-28', 'International Dive Trip', 'wix:image://v1/b37fef_b3ac4c53be1d407d84484f9f16e7c3fc~mv2.jpg/Anilao%20Sunset.jpg#originWidth=1200&originHeight=799', '<p class="font_8">Fun Divers Tw will head to Anilao for 4 days of diving, including 12 boat dives and 2 night dives! &nbsp;Be sure to book early and get your plane tickets while they are still cheap!</p>', '<p class="font_8">Amazing macro and crystal clear waters make Anilao a great destination for divers! &nbsp;</p>', NULL, '<p class="font_8"><strong>Dive Anilao with Fun Divers Tw!</strong></p>
<p class="font_8"><br></p>
<p class="font_8">Borders are open! Let’s go to the Philippines and dive the warm waters of Anilao! Great for macro and good visibility! Book early while flights are cheap!</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>Tour Price:</strong></u></p>
<p class="font_8">Double Room: 29,800NTD/each (double occupancy)<br>
Double Room: 34,500NTD/each (single occupancy)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>Included:</strong></u></p>
<p class="font_8">Dives: 4 Days, 12 Boat Dives, 2 night dives<br>
Meals and Accommodation in Anilao</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>Package does not include:</strong></u></p>
<p class="font_8">Basic Equipment Rental: $1,200 x 4 days<br>
Full Equipment Rental: $1,600 x 4 days (includes Dive Computer and SMB)</p>
<p class="font_8">Taipei-Manila flights (approximately 10,000ntd)</p>
<p class="font_8">Dive insurance:<br>
(Contact us for recommendation)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>Approximate Itinerary:</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>01/24</strong></u></p>
<p class="font_8"><strong>01:40</strong>Depart from Taoyuan Airport</p>
<p class="font_8"><strong>04:00</strong>Arrive at Manila Airport and Taxi to Resort</p>
<p class="font_8"><strong>06:00</strong>Arrive at Resort</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>01/24, 27</strong></u></p>
<p class="font_8">Breakfast</p>
<p class="font_8">2 Boat Dives</p>
<p class="font_8">Lunch</p>
<p class="font_8">1 Boat Dives</p>
<p class="font_8">Evening: Dinner</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>01/25, 26</strong></u></p>
<p class="font_8">Diving will follow the same day schedule and may vary depending on dive conditions for the night dives on the 24thand 25th.</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>01/28</strong></u></p>
<p class="font_8"><strong>16:00</strong>Taxi to Manila Airport</p>
<p class="font_8"><strong>23:05</strong> Depart Manila Airport</p>
<p class="font_8"><strong>01:15</strong>Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Please transfer $15,000 deposit to confirm your booking.</strong></p>
<p class="font_8">The remaining balance must be paid by 01/01.</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊Remember to Bring:</strong></p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Seasick Pills (if necessary)</p>
<p class="font_8">- ARC No. or Passport No. / ID Card No.</p>
<p class="font_8">- Surface Marker Buoy (SMB) – (Required for boat dives)</p>
<p class="font_8">- Dive Computer (Required for boat dives)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>Notes:</strong></u></p>
<p class="font_8">Divers must book their own flights to Manila from Taipei. We recommend booking the flight as soon as possible. Please get in touch with us before booking the flight.</p>
<p class="font_8">In the event of an overstay being required due to emergencies (typhoon, earthquake, etc.) the diver will be responsible for any additional charges incurred.</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>臨時取消行程之賠償金額 Cancellation Fee</strong></u></p>
<p class="font_8">60天前取消，行程費用之25% － 25% of Deposit within 60 days of the trip<br>
30天前取消，行程費用之50% － 50% of Deposit within 30 days of the trip<br>
21天前取消，不予以退費 － Within 21 days of trip, there will be no refund</p>', 'AOW Certification Required', NULL, '2023 Jan 24-28', 'Starting at 29,800ntd', '2023-01-24T04:00:00Z', NULL, false, NULL, NULL, NULL, true, '2022-09-27T07:12:01Z', '2026-04-16T13:21:20Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('2b8d42fa-0738-4df2-80c1-e682f71c93da', 'Bat Cave', NULL, NULL, NULL, NULL, 'Fun Diving and BBQ', 'wix:image://v1/b37fef_df5ef3980c1649108968ff48cdb2988c~mv2.jpg/charcoal.jpg#originWidth=800&originHeight=450', '<p class="p1"><span style="font-family:corben,serif">We will be having a Barbecue at Bat Cave on Friday, September 13th.&nbsp; We will also be doing three dives with no extra charge for the third dive, so come on out and celebrate with us!&nbsp;</span></p>', '<p class="p1"><span style="font-family:corben,serif">Come join Fun Divers TW as we celebrate Moon Festival in the traditional way with a Barbecue!&nbsp; We will also be celebrating in the not-so-traditional way with Diving!</span></p>', NULL, '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Come join Fun Divers Tw as we celebrate Moon Festival in the traditional way with a Barbecue!&nbsp; We will also be celebrating in the not-so-traditional way with Diving!&nbsp;</span></p>
<p class="font_8 p1"><br></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">We will be having a Barbecue at Bat Cave on Friday, September 13th.&nbsp; We will also be doing three dives with no extra charge for the third dive, so come on out and celebrate with us!&nbsp;</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">&nbsp;</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Cost:</span></p>
<p class="font_8 p1"><br></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">1200NTD for 2 Dives (3rd dive is free!)</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">1000NTD for Equipment Rental</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">500NTD for BBQ (please let us know if you have any dietary restrictions)</span></p>
<p class="font_8 p1"><br></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Book Early as transportation is limited!&nbsp;</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Hope to see you in the water!</span></p>', 'Divers and Non-Divers Welcome', NULL, NULL, 'See Details', '2019-09-12T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2019-08-12T11:15:41Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('2e2034e6-977a-4267-8b8e-07768f458aba', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/sep-9%2C-10%2C-11', 'PADI Open Water Course', 'wix:image://v1/b37fef_b22c67c4e51440c1929b2292262e7b15~mv2.jpg/20170514-IMG_3567.jpg#originWidth=1600&originHeight=1067', '<p class="font_8">The PADI Open Water Course is the first step in your underwater journey!&nbsp; Learn how to use Scuba Diving Equipment, how to handle yourself underwater, and how to fully enjoy your time underwater.&nbsp; Let Fun Divers TW introduce you to the amazing world of Scuba Diving in Taiwan (and the world)!</p>', '<p class="font_8">Start your underwater adventure by getting your PADI Open Water Certification! Fun Divers Tw is starting an Open Water Course and&nbsp;there are still a couple spots available!</p>', NULL, '<p class="font_8">Do you want to learn to Scuba Dive?! Now is your chance! Fun Divers Tw is starting a PADI Open Water Course for July! &nbsp;This course will be a PADI E-Learning Course so the academic portion will all be done on your own and we will meet for the Pool and Ocean sessions. See the schedule below.<br>
 <br>
 <strong>Price</strong> ：14,600ntd</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8">Price includes E-Learning, transportation, and gear rental. Due to Covid concerns, students will need to purchase their own Mask and Snorkel for use during the course. There is a selection to choose from at Fun Divers Tw.<br>
 <br>
 今年夏天來成為合格的PADI潛水員吧！<br>
 Learn Scuba Diving with Fun Divers Tw!<br>
 The Way Diving Should Be Taught<br>
 <br>
 Fun Divers 課程已完全更新，符合PADI教學課程之規定。為了能夠更安全的享受潛水活動，請跟我們一起學習安全且符合規定的潛水新知吧！<br>
 <br>
 <strong>09 Sep: 8:30am-4pm </strong><br>
 先上泳池 ，下午回來Fun Divers潛水教室考試<br>
 Knowledge Check and Pool lessons<br>
 Bring your swimsuit, towel and a snack<br>
 <br>
 <strong>10 &amp; 11 Sep: 8:30am-4pm</strong></p>
<p class="font_8">Open Water Dives</p>
<p class="font_8">Bring your swimsuit, towel, snacks, water and logbook</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer a 5000ntd deposit to confirm your spot in the class. Notify Fun Divers Tw when the transfer is complete.<br>
 <br>
Please transfer payments to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He<br>
 <br>
 ＊戶外課程將視天氣狀況作調整</p>
<p class="font_8">Find out more information about the Open Water Course on our <a href="https://www.fundiverstw.com/courses-1/padi-open-water-course">website</a>!</p>', 'None', NULL, 'Sep 9, 10, 11', '14,600 NTD', '2022-09-08T16:00:00Z', NULL, true, NULL, NULL, true, NULL, '2019-06-18T05:55:39Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('351fc2b9-8e9f-4d67-8c3f-69b88a4b2691', 'East Coast PM 2BD EANx', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/cauliflower-garden/oct-02', 'Boat Diving', 'wix:image://v1/b37fef_519ef15551bd481c824f50e9b6ece493~mv2.jpg/cauliflowers.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">We will be doing 2 boat dives on the East Coast of Taiwan. One will be at Cauliflower Garden, the other at the Power Plant Outflow. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring two different dive sites!</p>', 'Come explore the East Coast with Fun Divers Tw!  We will be trying to find dolphins and exploring two different dive sites!', '<p class="font_8">Cauliflower Garden and Power Plant Outflow</p>
<p class="font_8"><br></p>
<p class="font_8">Come check out the Beautiful Cauliflower Garden and Power Plant Outflow with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支，潛導，潛水保險</p>
<p class="font_8">Included: Transportation, 2 Boat Dives, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,600</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8"><br></p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200<br>
 全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Dive Computer – All divers MUST have<br>
- Surface Marker Buoy (SMB) – All divers MUST have</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW & Nitrox Certification Required', '10:50 - Meet at Fun Divers
12:30 - Meet at Port
13:00 - Boat Departs
17:00 - Boat Returns (wash gear at port)
17:30 - Depart for Taipei', 'Oct 02', '3,600 NTD', '2022-10-01T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2026-04-09T08:18:00Z', '2026-04-09T08:30:24Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('357315e2-bef0-4849-b432-569d19849863', 'Lambai Island', 'Return Ferry Tickets, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 2 Days Full Coverage Local Diving Insurance.', NULL, NULL, '/DiveTravel/lambai-island/mar-10-12', 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_e363b181077c4aaabc4431c0988d85db~mv2.jpg/PC190353.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">A weekend trip to Lambai Island to enjoy some time away from the city!&nbsp; We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!&nbsp; Come join us on this wonderful trip and see why divers love Xiao Liuqiu!</p>', '<p class="font_8">Visit this&nbsp;beautiful coral Island off the coast of Kaohsiung. Turtles galore!&nbsp; Come explore this gem with Fun Divers Tw!</p>', 'A weekend trip to Lambai Island to enjoy some time away from the city!  We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening!  Come join us on this wonderful trip and see why divers love Xiao Liuqiu!', '<p class="font_8">小琉球 小琉球 Beautiful Lambai</p>
<p class="font_8">A weekend trip to Lambai Island to enjoy some time away from the city! &nbsp;We will be diving with sea turtles, exploring wrecks, and having BBQ in the evening! &nbsp;Come join us on this wonderful trip and see why divers love Xiao Liuqiu!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>費用包含：</strong></p>
<p class="font_8">往返東港船票， 兩晚上住宿 ，早餐 x 2，午餐 x 2，晚餐 x 1，機車(兩人一台)，船潛四支， 潛水險。</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Included:</strong></p>
<p class="font_8">Return Ferry, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Boat Dives, 2 Days Full Diving Insurance.</p>
<p class="font_8">＊額外之餐費與娛樂費用請自理</p>
<p class="font_8">Additional Food, Drinks &amp; Entertainment are NOT included</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>團費 Tour Price:</strong></p>
<p class="font_8">背包房 Bunk Room: $11,800</p>
<p class="font_8">雙人房 Basic Double Room: $13,500 (double occupancy)</p>
<p class="font_8"><br></p>
<p class="font_8">歡迎非潛水員參加 Non-Divers are also welcome to join $6,400 (bunk room)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>額外費用Additional:</strong></p>
<p class="font_8">兩天裝備租借 Basic Equipment Rental: $1,200 x 2 days</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1,600 x 2 days</p>
<p class="font_8">(includes Dive Computer and SMB)</p>
<p class="font_8">Optional Night Dive: $800</p>
<p class="font_8">Light Rental: $200</p>
<p class="font_8">台北東港來回交通費 Return Transport: $1,400</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>課程Courses:</strong></p>
<p class="font_8">高氧課程 Enriched Air Nitrox Specialty $6,000 (原價 Normal Price $6,800)</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,200 (原價 Normal Price $6,200)</p>
<p class="font_8">進階課程 Advanced Open Water $11,000 (原價 Normal Price $12,200)<br>
初級課程 Open Water Course $11,600 (Normally $14,600)</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>行程Approximate Itinerary:</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Day 1</strong></p>
<p class="font_8">16:00 離開台北Depart Fun Divers Dive Center (earlier if possible)<br>
20:00飯店Hotel Kaohsiung</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Day 2</strong></p>
<p class="font_8">07:30 早餐 Breakfast</p>
<p class="font_8">08:00 出發 Depart</p>
<p class="font_8">09:00 東港漁港 Donggang Dock－小琉球 Liu Qiu Island</p>
<p class="font_8">10:00 安潛一支 1 Shore Dive</p>
<p class="font_8">11:30 中餐 Lunch</p>
<p class="font_8">12:30 船潛兩支 2 Boat Dives</p>
<p class="font_8">18:00 吃到飽烤肉 All you can eat BBQ Dinner</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Day 3</strong></p>
<p class="font_8">07:30 早餐Breakfast</p>
<p class="font_8">08:00 船潛兩支 2 Boat Dives</p>
<p class="font_8">12:30 中餐 Lunch</p>
<p class="font_8">14:30 小琉球 Liu Qiu Island ─ 東港 Donggang</p>
<p class="font_8">15:30 離開東港 Depart from Donggang</p>
<p class="font_8">21:30 抵達台北 Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請於匯入訂金 $8,000 Please transfer $8,000 deposit to confirm your booking.</p>
<p class="font_8">餘款需於02/20 付清 The remaining balance must be paid by 02/20.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Please transfer the deposit to:</strong></p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀⾏：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分⾏：雙和</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊記得攜帶 Remember to Bring</strong>:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 電腦表 Dive Computer(required) (rental 300/day)<br>
- 浮力棒 (SMB) Surface Marker Buoy(required) (rental 150/day)<br>
- 暈船藥 Seasick Pills<br>
- 防賽 Sun Protection</p>
<p class="font_8">- 大毛巾Towel</p>
<p class="font_8">- 薄夾克Jacket</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>臨時取消行程之賠償金額 Cancellation Fee</strong></u></p>
<p class="font_8">· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</p>
<p class="font_8">· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</p>
<p class="font_8">· 07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</p>', 'Advanced Certification Recommended', NULL, 'Mar 10-12', 'Starting at 11,800 NTD', '2023-03-09T16:00:00Z', 'b718703b-b6d6-43ff-b56e-f886ed67d9c5', false, NULL, NULL, NULL, true, '2020-12-04T08:31:54Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('3b66dea5-6f23-42ea-be72-c159a426ebe3', 'Wan An Jian Wreck Diving', NULL, NULL, NULL, '/DiveTravel/wan-an-jian-wreck-diving/aug-27', 'Boat Diving', 'wix:image://v1/b37fef_cefb9d928f144074ae7a99e0ab13b95f~mv2.jpg/Wan%20An%20Jian%20Wreck.jpg#originWidth=900&originHeight=508', '<p class="font_8">We will be doing 2 boat dives on the massive Wan An Jian Wreck. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring a wreck!</p>', NULL, '<p class="font_8">Wan An Jian Wreck Dives</p>
<p class="font_8"><br></p>
<p class="font_8">Come check out the massive Wan An Jian Military Wreck with Fun Divers Tw! We will be doing 2 dives on the wreck to explore it fully.</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支高氧，潛導，潛水保險</p>
<p class="font_8">Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,600</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200<br>
全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">課程Courses:</p>
<p class="font_8">高氧課程 $5,600 (原價$6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8"><br></p>
<p class="font_8">- ARC/ID Card (for Coast Guard)</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Dive Computer – All divers MUST have<br>
- Surface Marker Buoy (SMB) – All divers MUST have</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'Advanced Certified', NULL, 'Aug 27', '3,600 NTD', '2022-08-26T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2022-06-17T04:36:40Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('418a7178-3e35-4a42-b718-1dc335bcef60', 'Yehliu Boat Diving', NULL, NULL, NULL, '/DiveTravel/yehliu-boat-diving/aug-14', 'Local Boat Diving', 'wix:image://v1/b37fef_85f1f222b0bf481c925ebdf59ff1738a~mv2.jpg/blue%20and%20white%20nudi%202.jpg#originWidth=2440&originHeight=1823', '<p class="font_8">Fun Divers Tw is heading out to Yehliu Geo Park to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.&nbsp;</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</p>', NULL, '<p class="font_8"><u>費用包含：</u><br>
交通，船潛兩支高氧，潛導，個人指位無線電示標<br>
Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Locator Beacon<br>
<br>
<u>團費 Tour Price</u>: $3,200</p>
<p class="font_8"><br></p>
<p class="font_8"><u>課程Courses:</u></p>
<p class="font_8">高氧課程 $5,600 (原價 $6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)<br>
<br>
<u>額外費用 Additional:</u><br>
一天基本裝備租借 Basic Equipment Rental: $1200<br>
<br>
潛水錶租借 (必備) Computer Rental <strong>(required):</strong> $300<br>
<br>
浮力袋租借(必備) SMB Rental <strong>(required): </strong>$150<br>
<br>
潛水險 (必要) Diving Insurance <strong>(required):</strong> $400<br>
</p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額<br>
Please transfer the total As Soon As Possible to confirm your seat.<br>
<br>
匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904<br>
分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品<br>
＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Sun Protection</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>*Dive Location may change due to weather conditions</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><u>Schedule:</u></p>
<p class="font_8"><br></p>
<p class="font_8">06:15 Meet at Fun Divers Tw<br>
06:30 Depart Fun Divers Tw<br>
07:30 Meet at Port<br>
08:00 Boat Departs<br>
12:00 Boat Returns<br>
12:30 Wash Gear/Shower<br>
13:30 Lunch<br>
14:30 Depart for Taipei<br>
15:30 Arrive Fun Divers Tw<br>
&nbsp;<br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip<br>
• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip<br>
• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'Advanced and Nitrox Certification Required', NULL, 'Aug 14', '3,200 NTD', '2021-08-13T20:00:00Z', NULL, false, NULL, 'cce2ddd8-cd87-4657-b7e2-3188c07af34a', true, NULL, '2021-03-26T04:13:49Z', '2026-04-09T08:14:50Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('421492ca-ef89-4102-ba6b-01c9d068732e', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI EFR Course', 'wix:image://v1/b37fef_3970088889d24834a7ab01a1fca962b6~mv2.jpg/EFR_print_05(1).jpg#originWidth=1200&originHeight=900', '<p class="p1"><span style="font-family:corben,serif">In the <span style="text-decoration:underline"><a href="https://www.fundiverstw.com/Courses/PADI-EFR-Course">PADI EFR Course</a></span>, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.</span></p>', '<p class="p1"><span style="font-family:corben,serif">Discover simple to follow steps for emergency care. This course focuses on building confidence in lay rescuers and increasing their willingness to respond when faced with a medical emergency in a non-stressful learning environment.&nbsp; You don&#39;t have to be a diver to take this course.</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Do you know what to do if someone is injured or not breathing?&nbsp; Learn how to perform CPR and handle emergency situations confidently!&nbsp; Take the PADI Emergency First Responder (EFR) Course with Fun Divers Tw and learn from a former EMT!</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">In the PADI EFR Course, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Course Price:&nbsp; 4800 NTD for the course +1800 for the book</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Get a discount if you sign up with a friend!</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4500 NTD/Each for 2</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4200 NTD/Each for 3</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4000 NTD/Each for 4+</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Upcoming Course Schedule:&nbsp;&nbsp; Classes are from 9am &ndash; 3pm</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">November 9th</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">November 23rd</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">December 14th</span></p>

<p class="p1"><br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Please transfer the total amount to confirm your spot in the class.&nbsp; Notify Fun Divers Tw when the transfer is complete.<br />
<br />
Please transfer payments to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904</span></p>', 'Open to all (divers and non-divers welcome)', NULL, NULL, '4,800 NTD', '2019-11-22T18:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-11-05T08:46:35Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('42f2ba4a-0b9f-4ef5-a9f3-e0e6c8e508d5', 'RR + Shore 2B1S', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 1 Shore Dive, 2 Nitrox Tanks, 1 Air Tank, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/keelung-island-boat-diving/jun-19', 'Local Boat Diving', 'wix:image://v1/b37fef_1410542b4f30466c937394e6e934efb3~mv2.jpg/Moray%20small%20LDB%204.jpg#originWidth=4026&originHeight=3008', '<p class="font_8">Fun Divers Tw is heading out to Rainbow Reef, near Keelung Island to do some boat diving!&nbsp; Come explore some of the amazing off-shore dive sites with us and see why we love boat diving so much.&nbsp; We will be doing 2 boat dives.</p>', '<p class="font_8">Visit Rainbow Reef in the morning and then Batcave in the afternoon. &nbsp;We will do 2 boat dives and 1 shore dive!</p>', 'Visit Rainbow Reef in the morning and then Batcave in the afternoon.  We will do 2 boat dives and 1 shore dive!', '<p class="font_8">Come Boat Diving with Fun Divers as we return to Keelung Island for some Fun in the Sun!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支高氧，潛導，潛水保險</p>
<p class="font_8"><br></p>
<p class="font_8">Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,200</p>
<p class="font_8"><br></p>
<p class="font_8">課程Courses:</p>
<p class="font_8">高氧課程 $5,600 (原價 $6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品 ＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard) - Certification Card - Log Book - Sun Protection</p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip</p>
<p class="font_8">• 5天前取消，不予以退費 － Within 5 days of trip, there will be no refund</p>', 'AOW & Nitrox Certification Required', '06:15 - Meet at Fun Divers
07:30 - Meet at Port
08:00 - Boat Departs
12:00 - Boat Returns 
12:30 - Drive to Batcave
14:30 - Wash Gear
15:00 - Return to Taipei', 'Jun 19', '3,200 NTD', '2022-06-18T20:00:00Z', NULL, false, NULL, NULL, true, NULL, '2021-03-26T04:13:40Z', '2026-04-09T08:28:44Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('54566f97-7287-44f3-b663-8fc718d57610', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI Nitrox Course', 'wix:image://v1/b37fef_d384c617d2c94d13b56f3264e6f1c314~mv2.jpg/Nitrox%20Tanks.jpg#originWidth=1666&originHeight=1030', '<p class="font_8">The PADI Enriched Air Nitrox&nbsp;Diver course is PADI’s most popular specialty scuba course for several reasons.</p>
<ul class="font_8">
  <li><p class="font_8">Nitrox&nbsp;allows you to dive at deeper depths for longer times</p></li>
  <li><p class="font_8">Nitrox&nbsp;gives you more no decompression time, especially on repetitive scuba dives.</p></li>
  <li><p class="font_8">Nitrox allows for a shorter surface interval between multi-dive days</p></li>
</ul>
<p class="font_8">Nitrox is especially popular for divers who plan to dive while traveling, as some resorts and&nbsp;liveaboards&nbsp;only dive with nitrox and require the certification.</p>
<p class="font_8"><br></p>
<p class="font_8">If staying down longer and getting back in the water sooner sounds appealing, then don’t hesitate to become an enriched air diver.</p>', '<p class="font_8">The PADI&nbsp;Enriched Air Nitrox Course is the&nbsp;most popular PADI specialty course. Scuba diving with EANx gives you extra no decompression time, especially on repetitive scuba dives.</p>', NULL, '<p class="font_8">Become An Enriched Air Nitrox Diver &nbsp;成為高氧潛水員</p>
<p class="font_8"><br></p>
<p class="font_8">With EANx(Nitrox) you can extend your NDL’s and do more dives, more safely!&nbsp;</p>
<p class="font_8"><strong>Price:</strong> &nbsp;</p>
<p class="font_8">Chinese Book: 5,800ntd&nbsp;</p>
<p class="font_8">English Book: 6,000ntd</p>
<p class="font_8"><br></p>
<p class="font_8">Classroom: 2 hours 教室：兩個小時&nbsp;</p>
<p class="font_8">Dives: 2 Nitrox tanks 潛兩支高氧</p>
<p class="font_8"><br></p>
<p class="font_8">Full Basic Set of Equipment Rental 一天裝備租借： $1200</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Book now and get a discount on the Crest CR-4 Dive Computer while taking the course.</strong></p>
<p class="font_8">During Course: 6200ntd (normally 6500ntd)</p>
<p class="font_8"><br></p>
<p class="font_8">For more information about the <a href="https://www.fundiverstw.com/Courses/PADI-Enriched-Air-Specialty-Course"><u>PADI EANx Course Here</u></a>!</p>', 'Open Water Certified', NULL, NULL, 'See Details for price', '2020-05-08T16:00:00Z', NULL, false, NULL, NULL, false, NULL, '2019-07-01T06:17:06Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('5568aec5-6839-4c55-9d8f-626675b72927', 'Keelung Island Boat Diving', NULL, NULL, NULL, '/DiveTravel/keelung-island-boat-diving/aug-7', 'Local Boat Diving', 'wix:image://v1/b37fef_83c8811ad4c54cd1ac251c0ca16e0bdf~mv2_d_4026_3008_s_4_2.jpg/Sea%20Fan%20and%20Soft%20Coral.jpg#originWidth=4026&originHeight=3008', '<p class="font_8">Fun Divers Tw is heading out to Rainbow Reef, near Keelung Island to do some boat diving!&nbsp; Come explore some of the amazing off-shore dive sites with us and see why we love boat diving so much.&nbsp; We will be doing 2 boat dives.</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! We will explore Rainbow Reef, an underwater pinnacle with abundant sea life!</p>', NULL, '<p class="font_8">Come Boat Diving with Fun Divers as we return to Keelung Island for some Fun in the Sun!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支高氧，潛導，潛水保險</p>
<p class="font_8"><br></p>
<p class="font_8">Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,200</p>
<p class="font_8"><br></p>
<p class="font_8">課程Courses:</p>
<p class="font_8">高氧課程 $5,600 (原價 $6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)</p>
<p class="font_8">進階課程 Advanced Open Water $11,000 (原價 Normal Price $12,200)</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品 ＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard) - Certification Card - Log Book - Sun Protection</p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip</p>
<p class="font_8">• 5天前取消，不予以退費 － Within 5 days of trip, there will be no refund</p>', 'Advanced and Nitrox Certification Required', NULL, 'Aug 7', '3,200 NTD', '2022-08-06T20:00:00Z', NULL, false, NULL, NULL, true, NULL, '2022-06-17T03:16:06Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('5c7687aa-1f95-4124-9eba-50692ed29764', 'Badouzi PM 2 BD EANx', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, NULL, 'Local Boat Diving', 'wix:image://v1/b37fef_6929f50c76a34b16893242611734139e~mv2_d_4000_3000_s_4_2.jpg/david%20entry.JPG#originWidth=4000&originHeight=3000', '<p class="p1"><span style="font-family:corben,serif">Fun Divers Tw is heading out to Badouzi Harbor to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.</span></p>', '<p class="p1"><span style="font-family:corben,serif">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</span></p>', 'Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!', '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">厭倦了岸潛需要背上背下裝備嗎？來參加我們的八斗子船潛行程吧~<br />
Tired of the heavy lifting on shore dives?<br />
Come explore the outer reaches of Badouzi Bay by Boat<br />
<br />
費用包含：<br />
交通，保險 ，船潛兩支， 兩支氣瓶，潛導<br />
Included: Transport, Travel Insurance, 2 Boat Dives, 2 Tanks, Dive Guide<br />
<br />
<span style="font-weight:bold">團費 Tour Price:</span> $3,200<br />
<br />
<span style="font-weight:bold">額外費用 Additional:</span><br />
一天裝備租借 Full Equipment Rental: $1000<br />
<br />
＊請儘早匯入全額費用以確保您的名額<br />
Please transfer the total amount As Soon As Possible to confirm your seat.</span><br />
<br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Please transfer the deposit to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904<br />
<br />
<span style="font-weight:bold">＊記得攜帶防曬用品,浮力袋(船潛必備),電腦表<br />
＊Remember to Bring:</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">-ID Card (or passport)(for Coast Guard)<br />
- Certification Card<br />
- Log Book<br />
- Surface Marker Buoy (SMB) &ndash; All divers MUST have<br />
<br />
臨時取消行程之賠償金額 Cancellation Fee<br />
&bull; 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip<br />
&bull; 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip<br />
&bull; 5天前取消，不予以退費 － Within 5 days of trip price, there will be no refund</span></p>', 'AOW & Nitrox Certification Required', '10:45 - Meet at Fun Divers
12:00 - Meet at Port
12:30 - Boat Departs
17:00 - Boat Returns (wash gear at port)
17:30 - Depart for Taipei', NULL, '3,200 NTD', '2019-10-04T20:00:00Z', NULL, false, NULL, 'f6055090-f3af-4b49-b784-c4971a7d2c5a', true, NULL, '2019-07-25T11:17:05Z', '2026-04-09T08:35:18Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('6233a861-a6d5-4fae-b8ea-9585e09fad08', 'Panglao', NULL, NULL, NULL, NULL, 'International Dive Trip', 'wix:image://v1/b37fef_314c4d8b5ff74e39b8d0c56c04c13c8c~mv2.jpg/S__11411536_0.jpg#originWidth=1570&originHeight=1042', NULL, '<p class="font_8">Panglao is a diver’s paradise with a variety of dive sites and an abundance of sea life!</p>', NULL, '<p class="font_8">6D/5N Diving Trip to Panglao, Bohol, Philippines&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">2025/12/9-12/14</p>
<p class="font_8">(AOW Certification required for this trip)</p>
<p class="font_8"><br></p>
<p class="font_8">Panglao is a diver’s paradise with a variety of dive sites and an abundance of sea life! &nbsp;Located in the Bohol Province of the Philippines, it is on the list of must-see places for all divers! &nbsp;During the trip, we will do 14 dives, including trips to the islands of Balicasag, Pamilacan, and Napaling, as well as 2 night dives. &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">Itinerary (Tentative, subject to dive conditions):</p>
<p class="font_8">12/09: Travel to Panglao</p>
<p class="font_8"><br></p>
<p class="font_8">12/10-12/13</p>
<p class="font_8">Daily itinerary will vary depending on the day’s dive sites. We will do 3 day dives each day and on 2 of the days, we will do a night dive as well. &nbsp;</p>
<p class="font_8">Some of the sites we will visit include:</p>
<p class="font_8">Balicasag Island, Pamilacan Island, and Napaling Reef. &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">12/14: Travel back to Taipei</p>
<p class="font_8"><br></p>
<p class="font_8">Trip Price (Per Person):</p>
<p class="font_8">32,900NTD – Shared Room (2 Pax)</p>
<p class="font_8">41,200NTD – Private Room (1 Pax)</p>
<p class="font_8"><br></p>
<p class="font_8">Price Includes:</p>
<p class="font_8">Round trip transportation from Bohol Airport(TAG) to Dive Resort, 5 Nights Room, 14 Boat Dives, Accommodation, Dive Guides, Boat Fees, Outer Island Fees, Diving Tax, Tips, All meals after arrival at the resort.</p>
<p class="font_8"><br></p>
<p class="font_8">Not Included:</p>
<p class="font_8">Plane Tickets, Passport Fees, Corkage, Dive Insurance (DAN insurance recommended for all international dive trips)</p>
<p class="font_8"><br></p>
<p class="font_8">Additional:</p>
<p class="font_8">Full Equipment Rental: $1,800 x 4 (including Computer, SMB, Dive Light)</p>
<p class="font_8">Nitrox Tanks: $400/ea</p>
<p class="font_8"><br></p>
<p class="font_8">Course Discounts:</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,500 (原價 Normal Price $6,800)</p>
<p class="font_8">高氧課程 Enriched Air Nitrox Specialty $6,200 (原價 Normal Price $7,200)</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer $15,000 deposit to confirm your booking.&nbsp;</p>
<p class="font_8">The remaining balance must be paid by 11/11.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to:&nbsp;</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8">- Certification Card (Advanced required)</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Passports</p>
<p class="font_8">- Surface Marker Buoy (SMB) – (Required)&nbsp;</p>
<p class="font_8">- Dive Computer (Required)</p>
<p class="font_8">- Reef Hooks (useful but not required)</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">•	60天前取消，行程費用之25% － 25% of Deposit within 60 days of the trip</p>
<p class="font_8">•	30天前取消，行程費用之50% － 50% of Deposit within 30 days of the trip</p>
<p class="font_8">•	21天前取消，不予以退費 － Within 21 days of trip, there will be no refund&nbsp;</p>
<p class="font_8"><br></p>', 'AOW Certification Required', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-29T04:54:56Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('62b9b3a4-ed8c-4681-baed-19c39d316972', 'Bat Cave', NULL, NULL, NULL, NULL, 'Women''s Day Fun Diving Special', 'wix:image://v1/b37fef_50b3da3950ab411a96ed28b0ee4b04bb~mv2.jpg/WDD19_Logo_300dpi_icon_05_RGB.jpg#originWidth=763&originHeight=762', '<p class="p1"><span style="font-family:corben,serif">Fun Divers Tw is celebrating PADI Women&#39;s Day by offering 50% off Diving and Equipment Rental for all women.&nbsp; We are also offering a 20% discount on all gear purchased by women that day!&nbsp; &nbsp;Don&#39;t miss out on this awesome deal!!!</span></p>', '<p class="p1"><span style="font-family:corben,serif">In honor of PADI Women&#39;s Day, Fun Divers Tw is offering Fun Diving and Equipment Rental at 50% off for all women divers!</span></p>', NULL, '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Fun Divers Tw will be heading out at 8:30 in the morning on July 20th.&nbsp; &nbsp;</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Contact us now to reserve your spot.</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Price:&nbsp; Women:&nbsp; 50% off Diving and Gear rental</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp;20% Gear purchases</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Standard price: Diving 1200ntd</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;Gear Rental 1000ntd&nbsp;</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Don''t forget to bring your certification card, log book,&nbsp;snacks, towel and sun protection!</span></p>', 'Open to all levels of divers', NULL, NULL, '50% off Diving and Gear Rental', '2019-07-19T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2019-07-01T06:38:46Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('66862864-3e6c-4bd3-a84f-f307502b5cc5', '7 Star/Kenting', '5 Boat Dives (2 Air, 3 Nitrox)
Bunkroom Accommodation (2 nights) + 2 breakfasts + 1 dinner + 2 lunches + full coverage local diving insurance + diving guide fee', 'Additional Food, Drinks & Entertainment are NOT included', 'You can meet us in Kenting, traveling by Train&Bus, or driving yourself.
Round Trip Transportation with Fun Divers Taiwan: 1800ntd', NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_a4be3af87a29488185d944aee75ffda9~mv2.jpg/P2080453-Giant%20Trevally-Similan-Surin%20Islands.jpg#originWidth=3684&originHeight=2078', NULL, '<p class="font_8">Have the chance to see Rays, Trevallies, and Giant Barracudas at Seven Stars Reef!</p>', 'Have the chance to see Rays, Trevallies, and Giant Barracudas at Seven Stars Reef!', '<h6 class="font_6">Trip Overview:</h6>
<p class="font_8">You have a chance to see some big pelagics, such as schools of Jackfish, surrounding you. If you are lucky, you can also encounter large tuna/nurse sharks/whale sharks/hammerhead sharks/manta rays/eagle rays/white tip reef sharks. The water temperature at 7 Stars will likely be 24-26C.</p>
<p class="font_8"><br></p>
<h6 class="font_6">Fun Divers Pickup: &nbsp;(Limited seating)</h6>
<p class="font_8">If you are going to Kenting by yourself, please meet at <a href="https://maps.app.goo.gl/LAaznA8gqUZgcmnu7"><u>M</u></a><u>ario''s Dive Center</u></p>
<p class="font_8"><br></p>
<p class="font_8">* Transportation is at your own expense</p>
<p class="font_8">Boat Return Time on Day 3 approximately 12pm in Kenting</p>
<p class="font_7"><br></p>
<h6 class="font_6">Price:</h6>
<p class="font_8">Bunk room (4~6 people shared room) - 12,900ntd</p>
<p class="font_8">Double bed ensuite (2 people occupancy) - 14,600ntd</p>
<p class="font_8"><br></p>
<h6 class="font_6">Included:</h6>
<p class="font_8">Saturday: 3 boat dives at 7 Stars (3 nitrox tanks)</p>
<p class="font_8">Sunday: 2 boat dives in Kenting (2 Air tanks)</p>
<p class="font_8">Accommodation (2 nights) + 2 breakfasts + 1 dinner + 2 lunches + full coverage diving insurance + diving guide fee</p>
<p class="font_8"><br></p>
<h6 class="font_6">Not included:</h6>
<p class="font_8">Round Trip Transportation with us: 1800ntd</p>
<p class="font_8"><br></p>
<p class="font_8">＊額外之餐費與娛樂費用請自理</p>
<p class="font_8">＊Additional Food, Drinks &amp; Entertainment are NOT included</p>
<p class="font_8"><br></p>
<h6 class="font_6">Payment:</h6>
<p class="font_8">＊ 保確您的名額, 請匯入訂金$8,000</p>
<p class="font_8">Please transfer $8,000 deposit to confirm your booking.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">Please transfer the deposit to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶 Remember to Bring:</p>
<p class="font_8">- 證照卡 Certification Card</p>
<p class="font_8">- 潛水日誌 Log Book</p>
<p class="font_8">- 電腦表 Dive Computer</p>
<p class="font_8">- 浮力棒 (SMB) Surface Marker Buoy</p>
<p class="font_8">- 暈船藥 Seasick Pills</p>
<p class="font_8">- 防賽 Sun Protection</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</p>
<p class="font_8">· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</p>
<p class="font_8">· 07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</p>', 'Advanced & EANx Certification Required (Deep Certification Recommended)', 'Day 1: Arrive in Kenting
Day 2: 3 Boat dives (Nitrox)
Day 3: am: 2 Boat dives (Air)
pm: Depart', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-16T07:14:40Z', '2026-04-16T13:21:30Z', '9f20fab4-5faf-4978-94de-a146afe4af9d'),
  ('66a14d79-02ff-479b-828d-a93065490107', 'Weekend Fun Diving', NULL, NULL, NULL, '/DiveTravel/weekend-fun-diving/jul-23%2C-24', 'Local Fun Diving', 'wix:image://v1/b37fef_0386b474d7ad4e5eb46fd69d752935b2~mv2.jpg/P7170243.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">A lovely dive site full of soft corals and giant groupers.&nbsp; Also a great place to see nudibranchs.</p>', '<p class="font_8">A lovely dive site full of soft coral and giant groupers. Also a great place to see Nudibranchs!</p>', NULL, '<p class="font_8">Come out and do some Fun Diving with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">Notes: We will be leaving Fun Divers at 8:30am each day. Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.</p>
<p class="font_8"><br></p>
<p class="font_8">Price includes transportation, 2 tanks, and dive guide and Full Coverage Dive Insurance.</p>
<p class="font_8"><br></p>
<p class="font_8">Basic Equipment Rental is 1200NTD/day</p>
<p class="font_8"><br></p>
<p class="font_8">Schedule:</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Saturday, July 23</strong>: Secret Garden (1500ntd) (Secret Garden is a more challenging dive site so Advanced Certification Required)</p>
<p class="font_8"><strong>Saturday, July 23</strong>: Bat Cave (1400ntd)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Sunday, July 24</strong>: Canyons (1600ntd) (Canyons is a more challenging dive site so Advanced Certification Required)</p>
<p class="font_8"><br></p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額 Please transfer the total amount As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer payments to:</p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Space is limited, so book early!</p>', NULL, NULL, 'Jul 23, 24', 'Starting at 1,400', '2022-07-22T17:30:00Z', NULL, false, NULL, 'cb84ef01-98e5-4b17-b06d-3fc681a0107a', true, NULL, '2022-07-19T05:27:57Z', '2026-04-09T08:14:50Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('6b55bb0b-afb6-4a2d-a732-54df212103a9', 'Turtle Island 3BD 2Air1EANx', 'Transportation(if needed), Local Diving Insurance, 3 Boat Dives, 1 Nitrox Tank, 2 Air Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/turtle-island/jun-17', 'Boat Diving', 'wix:image://v1/9f20fa_4724345e7c8e4eb1b5b2c1ddf3b473e8~mv2.jpg/divers%20and%20hotspring.jpg#originWidth=4008&originHeight=3008', '<p class="font_8">Turtle Island is a volcanic island located to the east of Yilan. &nbsp;It is home to the Milky Way (or Milky Sea) which is actually the result of an Underwater Hot Spring. &nbsp;The hot, sulfurous water mixes with the surrounding seawater and combine to make white, cloudy patterns. &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">When diving there, visibility can be very limited but the unique dive environment makes it a worthwhile trip. &nbsp;Dolphins are also often spotted in the area surrounding the island which is a popular spot for dolphin and whale watching tours.</p>', '<p class="font_8">Come dive at an underwater hot spring and keep an eye out for dolphins during the trip!</p>', 'Come dive at an underwater hot spring and keep an eye out for dolphins during the trip!', '<p class="font_8">Come Explore Turtle Island With Fun Divers on our First Boat Diving Trip of the Season!</p>
<p class="font_8"><br></p>
<p class="font_8">We will be doing 3 Dives, including Wan An Jian Military Wreck and a Dive at an Underwater Hot Spring (The Milky Way)! We will also be keeping our eyes out for dolphins around the island!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>團費 Tour Price: $4,800</strong></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛三支，潛導， 潛水險<br>
Included: Transportation, 3 Boat Dives, Dive Guide and Full Coverage Dive Insurance.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>課程Courses:</strong></p>
<p class="font_8">高氧課程 $6,000 (原價 $6,600) -- Enriched Air Nitrox Specialty $6,000 (Normal $6,600)</p>
<p class="font_8">進階課程 Advanced Open Water $10,400 (原價Normal Price $12,200)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>額外費用 Additional:</strong></p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒)Full Equipment Rental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required):$300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Schedule:</strong></p>
<p class="font_8">05:00 Meet at Fun Divers Tw</p>
<p class="font_8">05:15 Depart Fun Divers Tw</p>
<p class="font_8">06:30 Meet at Port</p>
<p class="font_8">07:00 Boat Departs</p>
<p class="font_8">17:00 Boat Returns</p>
<p class="font_8">17:30 Wash Gear</p>
<p class="font_8">19:00 Arrive Fun Divers Tw</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額 Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦! 中國信託銀行：822 帳號：1305 4100 1904 分行：雙和</p>
<p class="font_8"><strong>Please transfer the payment to:</strong></p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8"><strong>＊Remember to Bring:</strong></p>
<p class="font_8">ARC/ID Card (for Coast Guard) - Certification Card - Log Book - Sun Protection - Lunch/snacks - Water</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW & Nitrox Certification Required', '05:20 - Meet at Fun Divers
06:30 - Meet at Port
07:00 - Boat Departs
16:00 - Boat Returns (wash gear at port)
16:30 - Depart for Taipei', 'Jun 17', '4,800 NTD', '2023-06-16T16:00:00Z', NULL, true, NULL, 'd2d0329e-88b3-4ea1-9f74-c7099512cffc', true, NULL, '2021-09-03T06:55:25Z', '2026-04-16T13:21:20Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('6df2e318-fc07-48dd-84d0-2e28a18a430a', 'Badouzi AM 2 BD Air', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, NULL, 'Local Boat Diving', 'wix:image://v1/b37fef_180ce15d03e24b0694ce1100c9bdd345~mv2.jpg/Badouzi%20and%20the%20Boat.jpg#originWidth=800&originHeight=450', '<p class="font_8">Fun Divers Tw is heading out to Badouzi Harbor to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</p>', 'Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!', '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">厭倦了岸潛需要背上背下裝備嗎？來參加我們的八斗子船潛行程吧~<br>
Tired of the heavy lifting on shore dives?<br>
Come explore the outer reaches of Badouzi Bay by Boat<br>
<br>
費用包含：<br>
交通，保險 ，船潛兩支， 兩支氣瓶，潛導<br>
Included: Transportation(if needed), Travel Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>團費 Tour Price:</strong></span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"> $3,200<br>
<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>額外費用 Additional:</strong></span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><br>
一天裝備租借 Full Equipment Rental: $1000<br>
<br>
＊ 請儘早匯入訂金$2,000 ，餘款9/14前完成匯款即可。<br>
Please transfer a $2,000 deposit As Soon As Possible to confirm your seat.<br>
The remaining balance must be paid on September 14th when we meet.<br>
<br>
Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>＊記得攜帶防曬用品,浮力袋(船潛必備),電腦表<br>
＊Remember to Bring:</strong></span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">-ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Surface Marker Buoy (SMB) – All divers MUST have<br>
<br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip<br>
• 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip<br>
• 5天前取消，不予以退費 － Within 5 days of trip price, there will be no refund</span></p>', 'AOW Certification Required', '06:15 - Meet at Fun Divers
07:30 - Meet at Port
08:00 - Boat Departs
12:00 - Boat Returns (wash gear at port)
12:30 - Depart for Taipei', NULL, '3,200 NTD', '2019-09-13T20:00:00Z', NULL, false, NULL, 'ce562dca-32d5-4d05-8a82-027a55404703', true, NULL, '2026-04-09T08:11:06Z', '2026-04-09T08:35:18Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('6f0d27de-59e9-4563-941b-51c9d1084f40', 'Penghu', NULL, NULL, NULL, NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_63da112189aa4c3585f5c9595b4749d8~mv2.jpg/290297154_2210120709138064_5250126471948204383_n.jpg#originWidth=1478&originHeight=1108', NULL, NULL, NULL, '<p class="font_8">跟瘋潛水去澎湖! Dive Penghu with Fun Divers Tw!&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">由於澎湖的距離與美景, 它是台灣必潛景點之一! 名額有限, 請盡快報名! Penghu is considered a Must-See dive destination in Taiwan due to its beauty and remoteness! By far, the best diving in all of Taiwan! Space is limited, better book early to secure your spot! &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含 Included:&nbsp;</p>
<p class="font_8">潛水：3日8支船潛(含導潛) 將軍島的餐點住宿上全包 兩人一台機車 三天潛水保險 導潛小費 三天GPS定位信標&nbsp;</p>
<p class="font_8">Dives: 3 Days, 8 Boat Dives (Dive Guides Included) Meals and Accommodation on Jiang Jun Island Shared Motorbike 3 Days of Full Diving Insurance Divemaster Tips (1000ntd/each) 3 Days Locator Beacon Rental &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">❋團費不包含Package does not include:&nbsp;</p>
<p class="font_8">三天基本裝備租借 Basic Equipment Rental: $1,200 x 3 days&nbsp;</p>
<p class="font_8">三天全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1,600 x 3 days (includes Dive Computer and SMB)&nbsp;</p>
<p class="font_8">馬公台北來回，原則上以飛機為主(機票約 $4400) Taipei-Magong flights (approximately 4400ntd)&nbsp;</p>
<p class="font_8">潛水裝備超重行李費 (超過10 公斤, $15/公斤) Oversize baggage surcharge for Dive Gear (15ntd/kg over 10kg)&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">&nbsp;行程 Approximate Itinerary: &nbsp;</p>
<p class="font_8">Day 1 09:00 乘船到將軍嶼, 安排房間, 享用午餐. Ferry to Jiang Jun Island. Check into rooms and have lunch&nbsp;</p>
<p class="font_8">下午Afternoon: 船潛2支, 2 Boat Dives&nbsp;</p>
<p class="font_8">傍晚Evening: 晚餐 Dinner &nbsp;</p>
<p class="font_8">Days 2&amp;3 &nbsp;南方四島船潛, 每天各3支加2餐. 潛點依當天氣候和海況決定. Daily Itinerary will vary depending on dive conditions and dive locations. There will be 3 Dives both days in Nan Fang Si National Park as well as breakfast and lunch. Dinner on your own</p>
<p class="font_8">Day 4 07:00 搭船回馬公Ferry back to Magong &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 保確您的名額, 請匯入訂金$15,000 Please transfer $15,000 deposit to confirm your booking. 餘款需於04/15付清 The remaining balance must be paid by 04/15. &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶防曬用品、浮力袋(船潛必備) 、電腦錶(船潛必備) 、紀錄書、暈船藥、浴巾，身份證號或居留證號、潛水流鉤 (必備) &nbsp;＊Remember to Bring: - Sun Protection - Certification Card - Log Book - Seasick Pills (if necessary) - Towel - ARC No. or Passport No. / ID Card No. - Surface Marker Buoy (SMB) – (Required for boat dives) - Dive Computer (Required for boat dives) - Reef Hook (Required) &nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">注意事項Notes: 潛水員必須自行訂購松山-澎湖來回機票. 我們建議先盡快訂購松山到澎湖的航班. 在訂購機票前, 請來電跟我們確認. 在澎湖潛水,有可能遇上強大的海流和有深度的潛點, 是具有挑戰性的. 參加的潛水員需備進階執照及50支氣瓶以上 如有特殊狀況發生(如天災: 颱風, 地震)而滯留, 須追加食宿費用. Divers must book their own flights to Magong from Songshan. We recommend booking the flight as soon as possible. Please get in touch with us before booking the flight.</p>', 'Advanced & EANx Certification Required (Deep Certification Recommended)
Minimum of 50 Logged Dives Required', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-25T05:40:15Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('7b1b8d27-eb7d-44ad-8344-d86576a1671c', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI Open Water Course', 'wix:image://v1/b37fef_454df03ce4384e07bfd5f3d9153b928a~mv2.png/Open%20water.jpg#originWidth=2000&originHeight=1333', '<p class="font_8">The PADI Open Water Course is the first step in your underwater journey!&nbsp; Learn how to use Scuba Diving Equipment, how to handle yourself underwater, and how to fully enjoy your time underwater.&nbsp; Let Fun Divers TW introduce you to the amazing world of Scuba Diving in Taiwan (and the world)! &nbsp;</p>', '<p class="font_8">Start your underwater adventure by getting your PADI Open Water Certification! <strong>Sign up before April 30th to get a discount!</strong></p>', NULL, '<p class="font_8">Do you want to learn to Scuba Dive?! Now is your chance! Fun Divers Tw is starting a PADI Open Water Course on June 6th!</p>
<p class="font_8"><br></p>
<p class="font_8">You can also choose between having class in person or doing PADI e-learning for the academic portion!</p>
<p class="font_8"><br>
<strong>Price</strong> (English Book)：14,400ntd&nbsp;</p>
<p class="font_8">特價(Chinese Book)：14,000ntd</p>
<p class="font_8"><br></p>
<p class="font_8">Price includes books, transportation, and gear rental</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8">今年夏天來成為合格的PADI潛水員吧！<br>
Learn Scuba Diving with Fun Divers Tw!<br>
The Way Diving Should Be Taught<br>
<br>
Fun Divers 課程已完全更新，符合PADI教學課程之規定。為了能夠更安全的享受潛水活動，請跟我們一起學習安全且符合規定的潛水新知吧！<br>
<br>
<strong>6 Jun : 9:00am~5pm (if doing in-person class)</strong><br>
上教室 ，知識複習 ，小考<br>
Do classroom lessons, go over knowledge reviews, and quizzes.<br>
Don''t forget to bring your books</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>7 Jun : 8:30am~4pm<br>
</strong>先上泳池 ，下午回來Fun Divers潛水教室考試<br>
Pool lessons<br>
Bring your swimsuit, towel and a snack</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>13 &amp; 14 Jun : 8:30am-4pm</strong></p>
<p class="font_8">Open Water Dives</p>
<p class="font_8">Bring your swimsuit, towel, snacks, water and logbook</p>
<p class="font_8"><br></p>
<p class="font_8">＊戶外課程將視天氣狀況作調整</p>
<p class="font_8">Find out more information about the <a href="https://www.fundiverstw.com/Courses/PADI-Open-Water-Course"><u>Open Water Course Here</u></a>!</p>', 'Beginning Level Course Open to All', NULL, NULL, '14,400 NTD', '2020-06-05T16:00:00Z', NULL, false, NULL, NULL, false, false, '2019-06-18T05:55:37Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('7e143e8f-25bc-4daa-80ba-5d6526372f1f', 'Bat Cave ', NULL, NULL, NULL, NULL, 'Local Shore Diving', 'wix:image://v1/b37fef_af67f50d528549109e0cbf9d05f73978~mv2_d_4026_3008_s_4_2.jpg/Moray%202%20(2).jpg#originWidth=4026&originHeight=3008', '<p class="p1"><span style="font-family:corben,serif">Come Fun Diving with Fun Divers TW as we head out to Bat Cave, one of our favorite Dive Sites!&nbsp;</span></p>', '<p class="p1"><span style="font-family:corben,serif">Come Fun Diving with Fun Divers TW as we head out to Bat Cave, one of our favorite Dive Sites!</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Come out and explore Bat Cave with Fun Divers!&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Notes:<br />
We will be leaving Fun Divers at 8:30am.&nbsp; Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.&nbsp;</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Price is 1200NTD and includes transportation, 2 tanks, and dive guide.</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Equipment rental is 1000NTD</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">＊請儘早匯入全額費用以確保您的名額<br />
Please transfer the total amount As Soon As Possible to confirm your seat.<br />
<br />
Please transfer payments to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904<br />
<br />
Space is limited, so book early!</span></p>', 'Open to all levels of divers', NULL, NULL, '1,200 NTD', '2019-10-11T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2019-04-23T11:51:39Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('7ed20eda-daf2-46a5-90e2-84f63caf6001', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/sep-20%2C-26%2C-27', 'PADI Open Water Course with E-Learning', 'wix:image://v1/b37fef_8dba58f065a9486781cd03ddb65a5cc5~mv2.jpg/2018-06-30%2010.07.26.jpg#originWidth=2000&originHeight=1125', '<p class="font_8">The PADI Open Water Course is the first step in your underwater journey!&nbsp; Learn how to use Scuba Diving Equipment, how to handle yourself underwater, and how to fully enjoy your time underwater.&nbsp; Let Fun Divers TW introduce you to the amazing world of Scuba Diving in Taiwan (and the world)!</p>', '<p class="font_8">Start your underwater adventure by getting your PADI Open Water Certification!</p>', NULL, '<p class="font_8">Do you want to learn to Scuba Dive?! Now is your chance! Fun Divers Tw is starting a PADI Open Water Course on September 20th!&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">This course will be a PADI E-Learning Course so the academic portion will all be done on your own and we will meet for the Pool and Ocean sessions. See the schedule below.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Price</strong> ：14,400ntd</p>
<p class="font_8">Price includes E-Learning, transportation, and gear rental</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8">今年夏天來成為合格的PADI潛水員吧！<br>
Learn Scuba Diving with Fun Divers Tw!<br>
The Way Diving Should Be Taught<br>
<br>
Fun Divers 課程已完全更新，符合PADI教學課程之規定。為了能夠更安全的享受潛水活動，請跟我們一起學習安全且符合規定的潛水新知吧！<br>
<br>
<strong>20 Sep : 8:30am~4pm<br>
</strong>先上泳池 ，下午回來Fun Divers潛水教室考試<br>
Knowledge Check and Pool lessons<br>
Bring your swimsuit, towel and a snack</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>26 &amp; 27 Sep : 8:30am-4pm</strong></p>
<p class="font_8">Open Water Dives</p>
<p class="font_8">Bring your swimsuit, towel, snacks, water and logbook</p>
<p class="font_8"><br></p>
<p class="font_8">＊戶外課程將視天氣狀況作調整</p>
<p class="font_8"><br></p>', 'Beginning Level Course Open to All', NULL, 'Sep 20, 26, 27', '14,400 NTD', '2020-09-19T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2020-07-20T04:19:25Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8004a94e-7d35-414f-b46e-b2c842f80b45', 'Badouzi PM 2 BD Air', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, NULL, 'Local Boat Diving', 'wix:image://v1/b37fef_6929f50c76a34b16893242611734139e~mv2_d_4000_3000_s_4_2.jpg/david%20entry.JPG#originWidth=4000&originHeight=3000', '<p class="p1"><span style="font-family:corben,serif">Fun Divers Tw is heading out to Badouzi Harbor to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.</span></p>', '<p class="p1"><span style="font-family:corben,serif">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</span></p>', 'Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!', '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">厭倦了岸潛需要背上背下裝備嗎？來參加我們的八斗子船潛行程吧~<br />
Tired of the heavy lifting on shore dives?<br />
Come explore the outer reaches of Badouzi Bay by Boat<br />
<br />
費用包含：<br />
交通，保險 ，船潛兩支， 兩支氣瓶，潛導<br />
Included: Transport, Travel Insurance, 2 Boat Dives, 2 Tanks, Dive Guide<br />
<br />
<span style="font-weight:bold">團費 Tour Price:</span> $3,200<br />
<br />
<span style="font-weight:bold">額外費用 Additional:</span><br />
一天裝備租借 Full Equipment Rental: $1000<br />
<br />
＊請儘早匯入全額費用以確保您的名額<br />
Please transfer the total amount As Soon As Possible to confirm your seat.</span><br />
<br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Please transfer the deposit to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904<br />
<br />
<span style="font-weight:bold">＊記得攜帶防曬用品,浮力袋(船潛必備),電腦表<br />
＊Remember to Bring:</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">-ID Card (or passport)(for Coast Guard)<br />
- Certification Card<br />
- Log Book<br />
- Surface Marker Buoy (SMB) &ndash; All divers MUST have<br />
<br />
臨時取消行程之賠償金額 Cancellation Fee<br />
&bull; 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip<br />
&bull; 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip<br />
&bull; 5天前取消，不予以退費 － Within 5 days of trip price, there will be no refund</span></p>', 'AOW Certification Required', '10:45 - Meet at Fun Divers
12:00 - Meet at Port
12:30 - Boat Departs
17:00 - Boat Returns (wash gear at port)
17:30 - Depart for Taipei', NULL, '3,200 NTD', '2019-10-04T20:00:00Z', NULL, false, NULL, 'f6055090-f3af-4b49-b784-c4971a7d2c5a', true, NULL, '2026-04-09T08:11:10Z', '2026-04-09T08:35:18Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('885d42e6-63bf-4064-9355-6e5dbb39f594', 'East Coast Boat Diving', NULL, NULL, NULL, '/DiveTravel/east-coast-boat-diving/apr-30', 'Boat Diving', 'wix:image://v1/b37fef_6929f50c76a34b16893242611734139e~mv2_d_4000_3000_s_4_2.jpg/david%20entry.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">We will be doing 2 boat dives on the East Coast, trying to find dolphins and exploring a wreck. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring a wreck!</p>', NULL, '<p class="font_8"><u>費用包含</u>：</p>
<p class="font_8"><br>
交通，船潛兩支，潛導<br>
Included: Transportation, 2 Boat Dives, Dive Guide<br>
<br>
<u>團費 Tour Price</u>: $3,200<br>
<br>
<u>額外費用 Additional:</u><br>
一天基本裝備租借 Basic Equipment Rental: $1200<br>
<br>
潛水錶租借 (必備) Computer Rental <strong>(required):</strong> $300<br>
<br>
浮力袋租借(必備) SMB Rental <strong>(required): </strong>$150</p>
<p class="font_8"><br>
&nbsp;</p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額<br>
Please transfer the total As Soon As Possible to confirm your seat.<br>
<br>
匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904<br>
分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品<br>
＊Remember to Bring:</p>
<p class="font_8"><br></p>
<p class="font_8">- ARC/ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Sun Protection</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>*Dive Location may change due to weather conditions</strong><br>
&nbsp;</p>
<p class="font_8"><u>Schedule:</u></p>
<p class="font_8"><br></p>
<p class="font_8">06:00 Meet at Fun Divers Tw<br>
06:15 Depart Fun Divers Tw<br>
07:30 Meet at Port<br>
08:00 Boat Departs<br>
12:00 Boat Returns<br>
12:30 Wash Gear/Shower<br>
13:30 Lunch<br>
14:30 Depart for Taipei<br>
15:30 Arrive Fun Divers Tw</p>
<p class="font_8"><br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip<br>
• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip<br>
• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'Advanced Certified', NULL, 'Apr 30', '3,200 NTD', '2021-04-29T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2021-03-25T10:19:47Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('886a0221-b657-4060-a623-5a32515017f3', 'Batcave', NULL, NULL, NULL, '/DiveTravel/batcave/aug-14', 'Local Fun Diving with Night Dive', 'wix:image://v1/b37fef_354e7dc9f79d45fdb32f3df4a632c94f~mv2.jpg/Baby%20Squid%20Close%20ND%20WM.jpg#originWidth=2274&originHeight=1707', '<p class="font_8">Let’s do some Night Diving!&nbsp; Fun Divers Tw is heading out for a 3 dive day with a night dive!&nbsp; Join us for a great night time adventure!</p>', '<p class="font_8">Let’s do some Night Diving!&nbsp; Fun Divers Tw is heading out for a 3 dive day with a night dive!&nbsp; Join us for a great night time adventure!</p>', NULL, '<p class="font_8">Let’s &nbsp;do some Night Diving! &nbsp;Fun Divers Tw is heading to &nbsp;Bat Cave for 2 day dives and a night dive!&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">Join us for a great night&nbsp;time adventure!</p>
<p class="font_8"><br></p>
<p class="font_8">Notes:<br>
We will be leaving Fun Divers at 11:00am. &nbsp;Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.</p>
<p class="font_8"><br></p>
<p class="font_8">Price is 2200NTD and includes transportation, 3 tanks, full coverage diving insurance, and dive guide.</p>
<p class="font_8"><br></p>
<p class="font_8">Basic Equipment Rental is 1200NTD<br>
Flashlight Rental is 200NTD</p>
<p class="font_8"><br></p>
<p class="font_8">Space is limited, so book early!</p>
<p class="font_8"><br></p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額<br>
Please transfer the total amount As Soon As Possible to confirm your seat.<br>
<br>
<strong>Please transfer payments to:</strong><br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Be sure to bring sun protection, snacks, water, and swimsuit.</p>', 'Advanced Certification Required for Night Dive', NULL, 'Aug 14', '2,200 NTD', '2022-08-13T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2019-08-12T10:41:41Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8b2e190d-0800-4cdd-9947-ea23a6e35f15', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/may-29', 'Buoyancy Specialty Course', 'wix:image://v1/b37fef_6b01226a00034f9d998bf0952daa3a26~mv2.jpg/tina%20and%20tiffany%20and%20the%20wreck.jpg#originWidth=3812&originHeight=2847', '<p class="font_8">The PADI Peak Performance Buoyancy Specialty Course focuses on improving your underwater buoyancy, trim, and swimming efficiency. &nbsp;Divers will do different buoyancy exercises and practice breathing techniques all under the guidance of a PADI Instructor.</p>', '<p class="font_8">Buoyancy is one of the most important skills for a diver to improve. Come work on yours with Fun Divers Tw!</p>', NULL, '<p class="font_8">Fun Divers is running a Buoyancy Specialty Course for divers that want to improve their buoyancy and dive skills. The Course will include a classroom session, 2 dives and buoyancy workshops both in and out of the water.</p>
<p class="font_8"><br></p>
<p class="font_8">We will cover many skills during the Buoyancy Specialty Course, including:</p>
<p class="font_8">· Proper Weighting and Weight Distribution</p>
<p class="font_8">· Achieving Neutral Buoyancy</p>
<p class="font_8">· Proper Trim and Kicking styles</p>
<p class="font_8">· Breathing Techniques and Using Lungs to Control Buoyancy</p>
<p class="font_8"><br></p>
<p class="font_8">Reasons <strong>ALL</strong>divers should work on their buoyancy:</p>
<p class="font_8">· Cause less damage to the environment</p>
<p class="font_8">· Feel more comfortable in the water</p>
<p class="font_8">· Improves your air consumption rate</p>
<p class="font_8">· Makes for longer dives</p>
<p class="font_8">· More relaxed and longer dives mean MORE FUN!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Cost:</strong> $6200 including transportation, tanks, and classroom session with instructor</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Gear Rental:</strong> $1200 for basic set</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Course Schedule:</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>May 29:</strong> Meet at Fun Divers Tw at 8:30</p>
<p class="font_8">Classroom portion will be done online and will be scheduled for a time that is convenient for everyone.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Notes:</strong></p>
<p class="font_8"><br></p>
<p class="font_8">Remember to bring your Logbook, sun protection, and a snack.</p>
<p class="font_8">Learn Scuba Diving with Fun Divers Dive Center!<br>
The Way Diving Should Be Taught!<br>
今年夏天來成為合格的PADI潛水員吧！</p>
<p class="font_8">Please transfer the total amount to confirm your spot.<br>
<br>
Please transfer payments to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Space is limited, so book early!</p>', 'PADI Open Water Certified', NULL, 'May 29', '6200 NTD', '2022-05-28T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2022-05-10T04:32:38Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8d21dc75-1f1d-4cb6-9903-6e353dd63ef2', 'East Coast AM 2BD EANx ', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, '/DiveTravel/cauliflower-garden/oct-02', 'Boat Diving', 'wix:image://v1/b37fef_519ef15551bd481c824f50e9b6ece493~mv2.jpg/cauliflowers.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">We will be doing 2 boat dives on the East Coast of Taiwan. One will be at Cauliflower Garden, the other at the Power Plant Outflow. &nbsp;Space is limited so book early!</p>', '<p class="font_8">Come explore the East Coast with Fun Divers Tw! &nbsp;We will be trying to find dolphins and exploring two different dive sites!</p>', 'Come explore the East Coast with Fun Divers Tw!  We will be trying to find dolphins and exploring two different dive sites!', '<p class="font_8">Cauliflower Garden and Power Plant Outflow</p>
<p class="font_8"><br></p>
<p class="font_8">Come check out the Beautiful Cauliflower Garden and Power Plant Outflow with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">交通，船潛兩支，潛導，潛水保險</p>
<p class="font_8">Included: Transportation, 2 Boat Dives, Dive Guide, Full Coverage Dive Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price: $3,600</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8"><br></p>
<p class="font_8">一天基本裝備租借 Basic Equipment Rental: $1200<br>
 全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 (includes Dive Computer and SMB)</p>
<p class="font_8">潛水錶租借 (必備) Computer Rental (required): $300</p>
<p class="font_8">浮力袋租借(必備) SMB Rental (required): $150</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the total As Soon As Possible to confirm your seat.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀行：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:</p>
<p class="font_8">Wong, Dennis</p>
<p class="font_8">CTBC Bank Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品</p>
<p class="font_8">＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)</p>
<p class="font_8">- Certification Card</p>
<p class="font_8">- Log Book</p>
<p class="font_8">- Sun Protection</p>
<p class="font_8">- Dive Computer – All divers MUST have<br>
- Surface Marker Buoy (SMB) – All divers MUST have</p>
<p class="font_8"><br></p>
<p class="font_8">*Dive Location may change due to weather conditions</p>
<p class="font_8"><br></p>
<p class="font_8">臨時取消行程之賠償金額 Cancellation Fee</p>
<p class="font_8">• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip</p>
<p class="font_8">• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip</p>
<p class="font_8">• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'AOW & Nitrox Certification Required', '05:20 - Meet at Fun Divers
06:30 - Meet at Port
07:00 - Boat Departs
12:00 - Boat Returns (wash gear at port)
12:30 - Depart for Taipei', 'Oct 02', '3,600 NTD', '2022-10-01T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2021-03-26T04:15:07Z', '2026-04-09T08:30:20Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8dba1d70-eb07-4a00-81ce-e4543d7f6fc8', 'Batcave', NULL, NULL, NULL, '/DiveTravel/batcave/jul-3', 'Local Fun Diving with Night Dive', 'wix:image://v1/b37fef_9df8db23977e4acf8eafeae8dadeab7c~mv2.jpg/Decorator%20Crab%20BC.jpg#originWidth=3200&originHeight=2402', '<p class="font_8">Let’s do some Night Diving!&nbsp; Fun Divers Tw is heading out for a 3 dive day with a night dive!&nbsp; Join us for a great night time adventure!</p>', '<p class="font_8">Let’s do some Night Diving!&nbsp; Fun Divers Tw is heading out for a 3 dive day with a night dive!&nbsp; Join us for a great night time adventure!</p>', NULL, '<p class="font_8">Let’s &nbsp;do some Night Diving! &nbsp;Fun Divers Tw is heading to &nbsp;Bat Cave for 2 day dives and a night dive!&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">Join us for a great night&nbsp;time adventure!</p>
<p class="font_8"><br></p>
<p class="font_8">Notes:<br>
We will be leaving Fun Divers at 11:00am. &nbsp;Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.</p>
<p class="font_8"><br></p>
<p class="font_8">Price is 2200NTD and includes transportation, 3 tanks, full coverage diving insurance, and dive guide.</p>
<p class="font_8"><br></p>
<p class="font_8">Basic Equipment Rental is 1200NTD<br>
Flashlight Rental is 200NTD</p>
<p class="font_8"><br></p>
<p class="font_8">Space is limited, so book early!</p>
<p class="font_8"><br></p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額<br>
Please transfer the total amount As Soon As Possible to confirm your seat.<br>
<br>
<strong>Please transfer payments to:</strong><br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Be sure to bring sun protection, snacks, water, and swimsuit.</p>', 'Advanced Certification Required for Night Dive', NULL, 'Jul 3', '2,200 NTD', '2022-07-02T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2022-06-28T05:38:53Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('9132a35b-2256-4abf-a7a7-a36342586530', 'Green Island', NULL, NULL, NULL, NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_bace0fbdeabd4a928136dfb96f34ef55~mv2.jpg/20151115-IMG_7819.jpg#originWidth=1600&originHeight=1065', '<p class="p1"><span style="font-family:corben,serif">A multi-day trip to Green Island to explore the beautiful waters of the Pacific!&nbsp; We will have time to explore underwater at artificial reefs, coral reefs as well as some of the local wrecks.&nbsp; There is also the option to visit the Zhaori Hot Springs, one of only 3 natural salt water hot springs in the world!</span></p>', '<p class="p1"><span style="font-family:corben,serif">A diving wonderland with a huge variety of sea life.&nbsp; Come explore this gem off the southeast coast of Taiwan with Fun Divers Tw!</span></p>', NULL, '<p class="p1"><span class="wixGuard">​</span></p>', NULL, NULL, NULL, '12,800 NTD', '2019-04-04T16:00:00Z', '6c8ea96c-afb2-4244-9f3e-a2e6cd040788', false, 'wix:document://v1/b37fef_e2efb3ea41f346eeb93bb20c5f682d4c.docx/Green%20Island%20Trip%20Information%20Fun%20Divers.docx', NULL, NULL, true, '2019-01-26T06:38:49Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('942cc2dc-05f8-4dc3-b524-5ecaab2608ee', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI EFR Course', 'wix:image://v1/b37fef_3970088889d24834a7ab01a1fca962b6~mv2.jpg/EFR_print_05(1).jpg#originWidth=1200&originHeight=900', '<p class="p1"><span style="font-family:corben,serif">In the <span style="text-decoration:underline"><a href="https://www.fundiverstw.com/Courses/PADI-EFR-Course">PADI EFR Course</a></span>, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.</span></p>', '<p class="p1"><span style="font-family:corben,serif">Discover simple to follow steps for emergency care. This course focuses on building confidence in lay rescuers and increasing their willingness to respond when faced with a medical emergency in a non-stressful learning environment.&nbsp; You don&#39;t have to be a diver to take this course.</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Do you know what to do if someone is injured or not breathing?&nbsp; Learn how to perform CPR and handle emergency situations confidently!&nbsp; Take the PADI Emergency First Responder (EFR) Course with Fun Divers Tw and learn from a former EMT!</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">In the PADI EFR Course, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Course Price:&nbsp; 4800 NTD for the course +1800 for the book</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Get a discount if you sign up with a friend!</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4500 NTD/Each for 2</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4200 NTD/Each for 3</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">4000 NTD/Each for 4+</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Upcoming Course Schedule:&nbsp;&nbsp; Classes are from 9am &ndash; 3pm</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">November 9th</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">November 23rd</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">December 14th</span></p>

<p class="p1"><br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Please transfer the total amount to confirm your spot in the class.&nbsp; Notify Fun Divers Tw when the transfer is complete.<br />
<br />
Please transfer payments to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904</span></p>', 'Open to all (divers and non-divers welcome)', NULL, NULL, '4,800 NTD', '2019-12-13T18:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-11-05T08:46:39Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('95a6523f-199d-4219-be47-362480f408c4', 'Lambai Island', NULL, NULL, NULL, '/DiveTravel/lambai-island/feb-5%2C-17-19', 'PADI Open Water Course', 'wix:image://v1/b37fef_acebd23599bd4c18993a88832bb22d04~mv2.jpg/polly%20turtle%207.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">The PADI Open Water Course is the first step in your underwater journey!&nbsp; Learn how to use Scuba Diving Equipment, how to handle yourself underwater, and how to fully enjoy your time underwater.&nbsp; Let Fun Divers TW introduce you to the amazing world of Scuba Diving in Taiwan (and the world)!</p>', '<p class="font_8">Come learn to dive with the Turtles of Lambai! &nbsp;Fun Divers Tw is starting a PADI Open Water Course in February and will do the Classroom and Pool portion in Taipei on Feb 5th and the Ocean portion on Lambai Island on Feb 17-19!</p>', NULL, '<p class="font_8"><u>小琉球 小琉球 Beautiful Lambai</u></p>
<p class="font_8"><br></p>
<p class="font_8">A weekend trip to Lambai Island to enjoy some time away from the city learning to dive! &nbsp;We will be diving with sea turtles, and getting our PADI Open Water Certification!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>費用包含：</strong></p>
<p class="font_8">往返東港船票， 兩晚上住宿 ，早餐 x 2，午餐 x 2，晚餐 x 1，機車(兩人一台)，課程潛水四支， 潛水險。</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Included:</strong></p>
<p class="font_8">Round Trip Ferry, 2 Nights Shared Rooms, 2 Breakfasts, 2 Lunches, 1 Dinner, 2 Days Shared Motorbike, 4 Course Dives, 2 Days Full Diving Insurance.</p>
<p class="font_8"><br></p>
<p class="font_8">＊額外之餐費與娛樂費用請自理</p>
<p class="font_8">Additional Food, Drinks &amp; Entertainment are NOT included</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>團費 Tour Price:</strong></p>
<p class="font_8">背包房 Bunk Room: $11,800</p>
<p class="font_8">雙人房 Basic Double Room: $13,500 (double occupancy)</p>
<p class="font_8"><br></p>
<p class="font_8">歡迎非潛水員參加 Non-Divers are also welcome to join $6,400 (bunk room)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>額外費用Additional:</strong></p>
<p class="font_8">兩天裝備租借 Basic Equipment Rental: $1,200 x 2 days (included with Open Water Course)</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1,600 x 2 days</p>
<p class="font_8">(includes Dive Computer and SMB)</p>
<p class="font_8">台北東港來回交通費 Return Transport: $1,400</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>課程Courses:</strong></p>
<p class="font_8">初級課程 Open Water Course $11,600 (Normally $14,600)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>行程Approximate Itinerary:</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>05 Feb: 8:30am-4pm </strong><br>
 先上泳池 ，下午回來Fun Divers潛水教室考試<br>
 Knowledge Check and Pool lessons<br>
 Bring your swimsuit, towel and a snack</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>17 Feb</strong></p>
<p class="font_8">16:00 離開台北Depart Fun Divers Dive Center (earlier if possible) <br>
20:00飯店Hotel Kaohsiung</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>18 Feb</strong></p>
<p class="font_8">07:30 早餐 Breakfast</p>
<p class="font_8">08:00 出發 Depart</p>
<p class="font_8">09:00 東港漁港 Donggang Dock－小琉球 Liu Qiu Island</p>
<p class="font_8">10:00 岸潛一支 1 Shore Dive</p>
<p class="font_8">11:30 中餐 Lunch</p>
<p class="font_8">12:30 岸潛一兩支 1 or 2 Shore Dives</p>
<p class="font_8">18:00 吃到飽烤肉 All you can eat BBQ Dinner</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>19 Feb</strong></p>
<p class="font_8">07:30 早餐Breakfast</p>
<p class="font_8">08:00 岸潛一兩支 1 or 2 Shore Dives</p>
<p class="font_8">12:30 中餐 Lunch</p>
<p class="font_8">14:30 小琉球 Liu Qiu Island ─ 東港 Donggang</p>
<p class="font_8">15:30 離開東港 Depart from Donggang</p>
<p class="font_8">21:30 抵達台北 Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請於匯入訂金 $11,000 Please transfer $11,000 deposit to confirm your booking.</p>
<p class="font_8">餘款需於02/05 付清 The remaining balance must be paid by 02/05.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Please transfer the deposit to:</strong></p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀⾏：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分⾏：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶 Remember to Bring:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 電腦表 Dive Computer(required if doing boat dives) (rental 300/day)<br>
- 浮力棒 (SMB) Surface Marker Buoy(required if doing boat dives) (rental 150/day)<br>
- 暈船藥 Seasick Pills<br>
- 防賽 Sun Protection</p>
<p class="font_8">- 大毛巾Towel</p>
<p class="font_8">- 薄夾克Jacket</p>
<p class="font_8"><br></p>
<p class="font_8"><u><strong>臨時取消行程之賠償金額 Cancellation Fee</strong></u></p>
<p class="font_8">· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</p>
<p class="font_8">· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</p>
<p class="font_8">· 07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</p>', 'Beginning Level Course Open to All', NULL, 'Feb 5, 17-19', 'See Details', '2023-02-04T16:00:00Z', 'b718703b-b6d6-43ff-b56e-f886ed67d9c5', false, NULL, NULL, false, true, '2019-04-23T05:39:19Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('9ba12b94-6749-4e8e-8ce7-795310c18f17', 'North Coast Boat Diving', NULL, NULL, NULL, '/DiveTravel/north-coast-boat-diving/aug-22', 'Local Boat Diving', 'wix:image://v1/b37fef_af67f50d528549109e0cbf9d05f73978~mv2_d_4026_3008_s_4_2.jpg/Moray%202%20(2).jpg#originWidth=4026&originHeight=3008', '<p class="font_8">Fun Divers Tw is heading out to the North Coast to do some boat diving around Keelung!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.&nbsp;</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</p>', NULL, '<p class="font_8"><u>費用包含：</u><br>
交通，船潛兩支高氧，潛導，個人指位無線電示標<br>
Included: Transportation, 2 Boat Dives with Nitrox, Dive Guide, Locator Beacon<br>
<br>
<u>團費 Tour Price</u>: $3,200</p>
<p class="font_8"><br></p>
<p class="font_8"><u>課程Courses:</u></p>
<p class="font_8">高氧課程 $5,600 (原價 $6,600) -- Enriched Air Nitrox Specialty $5,600 (Normal $6,600)<br>
<br>
<u>額外費用 Additional:</u><br>
一天基本裝備租借 Basic Equipment Rental: $1200<br>
<br>
潛水錶租借 (必備) Computer Rental <strong>(required):</strong> $300<br>
<br>
浮力袋租借(必備) SMB Rental <strong>(required): </strong>$150<br>
<br>
潛水險 (必要) Diving Insurance <strong>(required):</strong> $400<br>
</p>
<p class="font_8">＊ 請儘早匯入全額，確保您的名額<br>
Please transfer the total As Soon As Possible to confirm your seat.<br>
<br>
匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904<br>
分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the payment to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶身份證明, 潛水證, 潛水紀錄本, 防曬用品<br>
＊Remember to Bring:</p>
<p class="font_8">- ARC/ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Sun Protection</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>*Dive Location may change due to weather conditions</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><u>Schedule:</u></p>
<p class="font_8"><br></p>
<p class="font_8">06:15 Meet at Fun Divers Tw<br>
06:30 Depart Fun Divers Tw<br>
07:30 Meet at Port<br>
08:00 Boat Departs<br>
12:00 Boat Returns<br>
12:30 Wash Gear/Shower<br>
13:30 Lunch<br>
14:30 Depart for Taipei<br>
15:30 Arrive Fun Divers Tw<br>
&nbsp;<br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 15天前取消，行程費用之25% － 25% of trip price within 15 days of the trip<br>
• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip<br>
• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</p>', 'Advanced and Nitrox Certification Required', NULL, 'Aug 22', '3,200 NTD', '2021-08-21T20:00:00Z', NULL, false, NULL, NULL, true, NULL, '2021-03-26T04:14:14Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('a324e698-b857-41e7-ab6b-8d03d31b04b1', 'Long Dong Bay', NULL, NULL, NULL, '/DiveTravel/long-dong-bay/jul-31', 'Local Fun Diving', 'wix:image://v1/b37fef_546a01d581dc41dbaaf20a0543c8b6c4~mv2.jpg/Peacock%20mantis%20shrimp.jpg#originWidth=4008&originHeight=3008', '<p class="font_8">We will be exploring Long Dong Bay and enjoying the beautiful scenery above and below the water!</p>', '<p class="font_8">Come check out the beauty of Long Dong Bay with Fun Divers Tw!</p>', NULL, '<p class="font_8">Come out and explore Long Dong Bay with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">Notes:<br>
We will be leaving Fun Divers at 8:30 am. Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.</p>
<p class="font_8"><br></p>
<p class="font_8">Price is 1600NTD and includes transportation, 2 tanks, Full Coverage Dive Insurance and dive guide.</p>
<p class="font_8"><br></p>
<p class="font_8">Equipment rental is 1200NTD</p>
<p class="font_8"><br></p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額<br>
Please transfer the total amount As Soon As Possible to confirm your seat.<br>
<br>
Please transfer payments to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Space is limited, so book early!</p>', NULL, NULL, 'Jul 31', '1,600ntd', '2022-07-30T16:00:00Z', NULL, false, NULL, 'b7f7246e-3607-4c4d-b228-b1ee852c758c', true, NULL, '2020-08-10T09:16:26Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('a4983552-dd75-4838-8961-e3686b84c46b', 'Palau', NULL, NULL, NULL, NULL, 'International Dive Trip', 'wix:image://v1/b37fef_c4ab01325aaa4c9684e2d65e52a5458d~mv2.jpg/Rock%20Islands,%20Palau.jpg#originWidth=1000&originHeight=584', '<p class="font_8">A 6 day, 5 night trip to Palau with 4 days of diving!&nbsp;&nbsp;Come experience one of the best diving destinations in the world! Explore lush coral reefs, drop-off walls, the Blue Hole, sunken shipwrecks, and snorkeling in the one and only Jellyfish Lake!</p>', '<p class="p1"><span style="font-family:corben,serif;">Have the chance to swim among whale sharks, reef sharks, manta rays, blackfin barracudas, sailfish, bigeye trevally, non-stinging Jellyfish and much more! Book now to secure your spot on this amazing trip!</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Dive Palau with Fun Divers Tw! Come experience one of the best diving destinations in the world! Explore lush coral reefs, drop-off walls, the Blue Hole, sunken shipwrecks, and snorkeling in the one and only Jellyfish Lake!</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Have the chance to swim among whale sharks, reef sharks, manta rays, blackfin barracudas, sailfish, bigeye trevally, non-stinging Jellyfish and much more! Book now to secure your spot on this amazing trip!</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">費用包含：</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">Included</span>: Airport Pick-up/Drop-off, 5 Nights Shared Rooms at Palasia Hotel, 5 Buffet Breakfasts, 4 Lunches, Pick-up/Drop-off from Hotel on diving days, 12 Nitrox Dives, Snorkeling at Jellyfish Lake, environmental fees</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊額外之餐費與娛樂費用請自理</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Flights are not included, book early to get cheaper flights!</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Additional Food, Drinks &amp; Entertainment are NOT included</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">團費 Tour Price:</span><br />
雙人房 Double Room: $46,800ntd (double occupancy)</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif"><span style="font-weight:bold">額外費用 Additional:</span><br />
兩天裝備租借 Full Equipment Rental: $1,200 x 4</span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">PADI Enriched Air Nitrox Certification required</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">PADI Enriched Air Nitrox Course 4500 PADI 高氧課程 4200</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊ 請於匯入訂金$20,000 Please transfer $20,000 deposit to confirm your booking.</span></span></p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">餘款需於03/15付清 The remaining balance must be paid by 03/15.</span></span></p>

<p class="p1"><br />
<br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br />
中國信託銀行：822<br />
帳號：1305 4100 1904</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Please transfer the deposit to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904</span><br />
&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊記得攜帶防曬用品,浮力袋(船潛必備)，電腦表，紀錄書， 身份證號或居留證號</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">＊Remember to Bring:</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- Certification Card</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- Log Book</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- ARC No. or Passport No. / ID Card No.</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">- <span style="font-weight:bold">Surface Marker Buoy (SMB) &ndash; (Required)</span></span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">臨時取消行程之賠償金額 Cancellation Fee</span></span></p>

<ul class="font_7" style="font-family:avenir-lt-w01_35-light1475496,sans-serif">
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">21天前取消，行程費用之25% － 25% of Deposit within 21 days of the trip</span></p>
	</li>
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">14天前取消，行程費用之50% － 50% of Deposit within 14 days of the trip</span></p>
	</li>
	<li>
	<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</span></p>
	</li>
</ul>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">行程 Approximate Itinerary:</span></span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Apr 3</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">13:15 China Airlines Flight CI28 Taipei (TPE)-Palau (ROR) <span style="font-weight:bold">(not included in price, book separately)</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">18:05 Arrive in Palau and transfer to hotel.</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Apr 4-7</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Daily Itinerary will vary depending on dive conditions and dive locations. There will be 3 Dives daily as well as a trip to Jellyfish Lake for snorkeling.&nbsp;</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-weight:bold"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">Apr 8</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">19:05 China Airlines Flight CI27 Palau (ROR) &ndash;Taipei (TPE) <span style="font-weight:bold">(not included in price, book separately)</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">22:05 抵達台北 Arrive in Taipei</span></p>', 'Advanced Certification & Nitrox Certification Required (can do certification course during trip)', NULL, NULL, '46,800NTD', '2020-04-02T16:00:00Z', 'b2c76485-d2b5-4be1-a47a-84e109020ed1', false, NULL, NULL, NULL, true, '2020-01-16T04:51:50Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('a52867fc-f12a-4827-a00c-cea83108fcd7', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/feb-11-or-12', 'Gear Maintenance Course', 'wix:image://v1/b37fef_b1f8b06b7c2e494996f5690e33bd7319~mv2.jpg/Gear%20Course%20Picture_edited.jpg#originWidth=1108&originHeight=1477', '<p class="font_8"><strong>Why ALL divers should take this course:</strong></p>
<p class="font_8"><br></p>
<p class="font_8">· Gain an understanding of how the gear works</p>
<p class="font_8">· Have more trust in your gear</p>
<p class="font_8">· Be able to diagnose and deal with most problems on the spot</p>
<p class="font_8">· Be more self-reliant</p>', '<p class="font_8">Learn how to check and maintain your own gear with Fun Divers Tw!</p>', NULL, '<p class="font_8">Fun Divers is running a Gear Maintenance Course for divers that want to learn how to check and maintain their own gear.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Topics include:</strong></p>
<p class="font_8"><br></p>
<p class="font_8">· Checking and Adjusting Regulator Air Flow</p>
<p class="font_8">· Troubleshooting Common Problems with Gear</p>
<p class="font_8">· Proper Cleaning and Lubricating Techniques</p>
<p class="font_8">· Showing and Explaining Internal and External Parts of Regulators and BCDs</p>
<p class="font_8">(this is <strong>NOT</strong> a certification course, we will <strong>NOT</strong> be servicing internal parts of regs)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Why ALL divers should take this course:</strong></p>
<p class="font_8"><br></p>
<p class="font_8">· Gain an understanding of how the gear works</p>
<p class="font_8">· Have more trust in your gear</p>
<p class="font_8">· Be able to diagnose and deal with most problems on the spot</p>
<p class="font_8">· Be more self-reliant</p>
<p class="font_8"><br></p>
<p class="font_8">Cost: $2800 for workshop with instructor</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Notes:</strong></p>
<p class="font_8"><br></p>
<p class="font_8">Bring your own BCD and Regulators if you have them! If you don’t, you can work with our gear!</p>
<p class="font_8"><br></p>
<p class="font_8">Learn Scuba Diving with Fun Divers Dive Center!<br>
Taipei’s Number 1 Foreigner Run, PADI Dive Shop<br>
 今年夏天來成為合格的PADI潛水員吧！</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Please transfer the deposit to:</strong></p>
<p class="font_8">Wong, Dennis CTBC Bank</p>
<p class="font_8">Bank code: 822</p>
<p class="font_8">Account: 1305 4100 1904</p>
<p class="font_8">Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!</p>
<p class="font_8">中國信託銀⾏：822</p>
<p class="font_8">帳號：1305 4100 1904</p>
<p class="font_8">分⾏：雙和</p>', 'Open To All ', NULL, 'Feb 11 or 12', '2800NTD', '2023-02-11T04:00:00Z', NULL, false, NULL, NULL, true, NULL, '2022-12-29T06:37:35Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('a9edd94c-31ae-48f2-87ff-759dc73852a2', 'Bat Cave', NULL, NULL, NULL, '/DiveTravel/bat-cave/jul-16', 'Local Fun Diving', 'wix:image://v1/b37fef_affd0515ef5a4deb86ecebc31453de1a~mv2.jpg/PA173739.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">Fun Divers will be heading out to Batcave to do some fun diving. &nbsp;Explore the rock formations and search for nudibranchs and cuttlefish at one of our favorite sites!</p>', '<p class="font_8">Explore the rock formations and search for nudibranchs at Batcave!</p>', NULL, '<p class="font_8">Come out and explore Bat Cave with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Notes:</strong><br>
 We will be leaving Fun Divers at 8:30am. Be sure to bring your swimsuit, towel, snacks, sunscreen and logbooks.</p>
<p class="font_8"><br></p>
<p class="font_8">Price is 1400NTD and includes transportation, Full Coverage Dive Insurance, 2 tanks, and dive guide.</p>
<p class="font_8"><br></p>
<p class="font_8">Equipment rental is 1200NTD</p>
<p class="font_8"><br></p>
<p class="font_8">＊請儘早匯入全額費用以確保您的名額<br>
Please transfer the total amount As Soon As Possible to confirm your seat. <br>
 <br>
Please transfer payments to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
 <br>
 Space is limited, so book early!</p>', 'Open Water Certified (or higher)', NULL, 'Jul 16', '1400 NTD', '2022-07-15T16:00:00Z', NULL, false, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2021-08-31T07:03:01Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('adf69494-429f-4321-a585-38788d7f2e64', 'Bat Cave', NULL, NULL, NULL, '/DiveTravel/bat-cave/2024-03-29', 'Ocean & Beach Cleanup', 'wix:image://v1/b37fef_168aec18fa5646b2bf5f451480d6b857~mv2_d_4026_3008_s_4_2.jpg/P7212378.jpg#originWidth=4026&originHeight=3008', '<p class="font_8 p1"><span style="font-family: corben, serif">Come with Fun Divers Tw as we do our part to clean the ocean and beaches. &nbsp; Fun Divers Tw is heading to Bat Cave to do an Ocean and Beach Clean-up.&nbsp; Scuba Divers and Non-divers alike are welcome to join and help us make our Earth a cleaner place!</span></p>', '<p class="p1"><span style="font-family:corben,serif">Come with Fun Divers Tw as we do our part to clean the ocean and beaches.</span></p>', NULL, '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Be an ambassador, do your part, come help us remove trash from the ocean that brings us so much joy!<br>
<br>
Limited transportation available, so if you need a ride to the dive site, book early!<br>
<br>
When:<br>
Meet at Fun Divers at 8:45<br>
<br>
Cost:<br>
Diving - 1000ntd (includes transportation, dive guide and tanks)<br>
Equipment rental - 50% off (Full set is normally 1000ntd)</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">&nbsp;</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">RSVP early since there are limited spots available.</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">＊請儘早匯入全額費用以確保您的名額<br>
Please transfer the total amount As Soon As Possible to confirm your seat.<br>
<br>
Please transfer payments to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
Be sure to bring sunscreen, snacks, water, and swimsuit.<br>
<br>
If you have any other questions or for courses and other events, please feel free to send us a message!<br>
<br>
See you in the water!</span></p>', 'Divers and Non-Divers welcome!', NULL, '2024-03-29', '1,400 NTD ', '2019-10-18T16:00:00Z', NULL, true, NULL, '1e1be45b-6ba5-4334-82ef-8331ee24c641', true, NULL, '2019-03-14T04:21:55Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('b70672ce-cb8c-4ce2-81b1-31f219f6b204', 'Kenting', NULL, NULL, NULL, '/DiveTravel/kenting/sep-23-25', 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_c311277ae1824a88a42d551d763f5120~mv2_d_4608_2592_s_4_2.jpg/Kenting%20Jan%202019A%20(77).JPG#originWidth=4608&originHeight=2592', '<p class="font_8">A trip to Kenting to explore the underwater world at the southern tip of Taiwan.&nbsp; We may also take some time to explore the surrounding area and do some sightseeing.</p>', '<p class="font_8">A great place for diving as well as exploring above the water.&nbsp; We will check out some of the great dive sites there, swim with blue spotted stingrays, turtles and batfish.&nbsp; Then, we will visit some of the beaches and the nightmarket as well!</p>', NULL, '<p class="font_8"><strong>費用包含：</strong><br>
兩晚, 早餐x 2, 中餐x 2, 晚餐x 1, 船潛x 6, 兩天潛水險<br>
<strong>Included:</strong><br>
2 Nights Room, 2 Breakfasts, 2 Lunches, 1 Dinner, 6 Boat Dives, 2 Days Full Diving Insurance.<br>
<br>
<strong>團費 Tour Price:</strong><br>
背包房 Bunk Bed: $12,400<br>
雙人房 Double Bed: $13,000 (double occupancy)</p>
<p class="font_8">單人房 Single Room: $15,500<br>
<br>
<strong>額外費用Additional Things to Consider:</strong><br>
全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1600 x 2 days</p>
<p class="font_8">(includes Dive Computer and SMB)</p>
<p class="font_8">台北墾丁來回交通費Return Transport: $1600<br>
<br>
<strong>課程Course Discounts:</strong><br>
高氧課程 Enriched Air Nitrox Specialty $6,000 (原價 Normal Price $6,600)</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,200 (原價 Normal Price $6,200)</p>
<p class="font_8">進階課程 Advanced Open Water $11,000 (原價 Normal Price $12,200)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊ 請於匯入訂金$8,000 Please transfer $8,000 deposit to confirm your booking.</strong></p>
<p class="font_8"><strong>餘款需於09/10 付清 The remaining balance must be paid by 09/10.</strong></p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He<br>
<br>
<br>
<strong>行程Approximate Itinerary:<br>
</strong><br>
<strong>Day 1</strong></p>
<p class="font_8">18:30 Fun Divers Dive Center<br>
00:00 墾丁 Kenting</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Day 2</strong></p>
<p class="font_8">07:00 起床 Wake up<br>
07:30 早餐 Breakfast<br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch<br>
13:00 船潛兩支 2 boat dives<br>
18:00 晚餐 Dinner<br>
<br>
<strong>Day 3</strong></p>
<p class="font_8">07:00 起床 Wake up<br>
07:30 早餐 Breakfast<br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch<br>
13:00 打包行李 Pack up<br>
14:00 回台北 Drive back to Taipei<br>
<br>
＊額外之餐費與娛樂費用請自理<br>
＊Additional Food, Drinks &amp; Entertainment are NOT included<br>
<br>
＊記得攜帶 Remember to Bring:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 電腦表 Dive Computer<br>
- 浮力棒 (SMB) Surface Marker Buoy<br>
- 暈船藥 Seasick Pills<br>
- 防賽 Sun Protection<br>
<br>
<u>臨時取消行程之賠償金額Cancellation Fee</u></p>
<p class="font_8"><u>· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</u></p>
<p class="font_8"><u>· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</u></p>
<p class="font_8"><u>· 07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</u></p>', 'Advanced Certification Recommended', NULL, 'Sep 23-25', 'Starting at 12,400', '2022-09-22T16:00:00Z', '52224a76-927a-4e3e-8c52-2d34afacbdf0', false, NULL, NULL, NULL, true, '2021-09-24T05:48:35Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('bcafc396-74b5-4c08-90e0-f46e0a426402', 'Greater Xindian Pool', NULL, NULL, NULL, '/DiveTravel/greater-xindian-pool/apr-15', 'Pool Party and Try Dive', 'wix:image://v1/b37fef_04729138e6214afe9fbce95b513d6875~mv2.jpg/pool%20party%20photo.jpg#originWidth=1883&originHeight=1062', '<p class="font_8">A pool party with try dives to celebrate the start of the 2023 Season. &nbsp;Reconnect with your dive buddies and meet new ones! Bring your friends who are interested in diving and they can try it out! &nbsp;</p>
<p class="font_8"><strong>You also have a chance to win a Crest CR-4 Dive Computer!</strong></p>', '<p class="font_8">Celebrate the start of the 2023 Dive Season with Fun Divers Taiwan! &nbsp;Let''s start the season off with a blast! &nbsp;All attendees have a chance to win a Crest CR-4 Dive Computer as well as other great prizes!</p>', NULL, '<p class="font_8">Fun Divers Taiwan 瘋潛水 is having a Season Opener Pool Party and Try Dive! Reconnect with dive buddies and meet new ones. Bring friends who are interested in learning to dive as well!</p>
<p class="font_8">There will be free try dives during the party!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Date</strong>: April 15, 2023</p>
<p class="font_8"><strong>Time</strong>: 11:00-17:00</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Entry Fee</strong>: 400NTD</p>
<p class="font_8">Price includes entrance to the pool, 1 free drink, and 1 Raffle ticket</p>
<p class="font_8">Pre-book and pay to get 1 extra free raffle ticket and double your chances of winning! Buy additional tickets: 100 for 1 or 200 for 3</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Raffle Grand Prize is a Crest CR-4 Dive Computer</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Other prizes include</strong>: Free Day of Diving, Fun Divers T-Shirts, Dive Accessories and more!</p>
<p class="font_8"><br></p>
<p class="font_8">All Attendees also get a 10% discount on fun diving and courses if they sign up by April 30th. &nbsp;(Diving and course can be scheduled for anytime during the 2023 Dive Season)</p>
<p class="font_8"><br></p>', 'none', NULL, 'Apr 15', '400NTD', '2023-04-15T04:00:00Z', NULL, false, NULL, NULL, NULL, NULL, '2023-03-09T03:46:39Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('c9c1c467-bdca-4388-89d7-1a1f1eae96f5', 'Kenting', NULL, NULL, NULL, NULL, 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_c311277ae1824a88a42d551d763f5120~mv2_d_4608_2592_s_4_2.jpg/Kenting%20Jan%202019A%20(77).JPG#originWidth=4608&originHeight=2592', '<p><span style="color:#414141"><span style="font-style:normal"><span style="font-weight:400"><span style="font-size:17px"><span style="font-family:corben,serif">A trip to Kenting to explore the underwater world at the southern tip of Taiwan.&nbsp; We will also take some time to explore the surrounding area and do some sightseeing.</span></span></span></span></span></p>', '<p><span style="color:#414141"><span style="font-style:normal"><span style="font-weight:400"><span style="font-size:17px"><span style="font-family:corben,serif">A great place for diving as well as exploring above the water.&nbsp; We will check out some of the great dive sites there, swim with blue spotted stingrays, turtles and batfish.&nbsp; Then, we will visit some of the beaches and the nightmarket as well!</span></span></span></span></span></p>', NULL, '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">費用包含：<br>
早餐x 2, 中餐x 2, 晚餐x 1, 船潛x 4, 住宿兩晚<br>
Included:<br>
2 Nights Shared Room, 2 Breakfasts, 2 Lunches, 1 Dinner, 4 Boat Dives.<br>
<br>
團費 Tour Price:<br>
背包房 Capsule Bed $9,800<br>
雙人房 Double Bed $11,500<br>
Non- Diver $5,800</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">額外費用 Additional Things to Consider:<br>
兩天全套裝備租借 Full Equipment Rental: $2000<br>
台北墾丁來回交通費 Return Transport: $1600<br>
<br>
課程 Course Discounts:<br>
<br>
高氧課程 $4,700 (原價 $5,500) -- Enriched Air Nitrox Specialty $5,200 (Normal $6,000)</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">深潛課程 $4,500 (原價 $5,500) -- Deep Dive Specialty $5,000 (Normally $6,000)</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">進階課程 $8,000 (原價 $9,900) -- Advanced Open Water $8,500 (Normally $10,400)</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">初級課程 $10,500 (原價 $13,900) -- Open Water Course $11,000 (Normally $14,400)</span></p>
<p class="font_8 p1"><br></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">＊ 請於匯入訂金$8,000 Please transfer $8,000 deposit to confirm your booking.</span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">餘款需於12/6付清 The remaining balance must be paid by December 6th.</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
中國信託銀行：822<br>
帳號：1305 4100 1904</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">行程 Approximate Itinerary:</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Dec 6th (Fri)<br>
18:30 Fun Divers Dive Center<br>
00:00 墾丁 Kenting</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Dec 7th (Sat)<br>
07:00 起床 Wake up<br>
07:30 早餐 Breakfast<br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch<br>
13:00 自由時間 Free time (Go to Kenting Street, Beach…)<br>
18:00 晚餐 Dinner</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Dec 8th (Sun)<br>
07:00 起床 Wake up<br>
07:30 早餐 Breakfast<br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch<br>
13:00 打包行李 Pack up<br>
14:00 回台北 Drive back to Taipei</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">＊額外之餐費與娛樂費用請自理<br>
＊Additional Food, Drinks &amp; Entertainment are NOT included</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">＊記得攜帶 Remember to Bring:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 身份證(供海巡做身份驗證) ARC / ID Card for the coast guard<br>
- 浮力棒 (SMB) Surface Marker Buoy (Highly Suggested)<br>
- 浴巾 Towel<br>
- 防賽 Sun Protection</span></p>
<p class="font_8 p1">&nbsp;</p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">臨時取消行程之賠償金額 Cancellation Fee<br>
• 14天前取消，行程費用之25% － 25% of trip price within 14 days of the trip<br>
• 10天前取消，行程費用之50% － 50% of trip price within 10 days of the trip<br>
• 7天前取消，不予以退費 － Within 7 days of trip price, there will be no refund</span></p>', 'Advanced Certification Recommended', NULL, NULL, '9,800 NTD', '2019-12-05T16:00:00Z', '52224a76-927a-4e3e-8c52-2d34afacbdf0', false, NULL, NULL, NULL, true, '2019-10-29T14:59:06Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('cc04b6a1-c340-4c7a-885a-760565db77ef', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/jul-30%2C-31%2C-aug-6', 'PADI Advanced Course', 'wix:image://v1/b37fef_3166e2616932488aad593a8fb4c8f6d8~mv2.jpg/64365829_2620424691314544_71180475215443.jpg#originWidth=1200&originHeight=900', '<p class="font_8">By taking the PADI Advanced Course, you will learn more about the underwater world while expanding your diving skills.&nbsp; You will practice your navigation and go deeper.&nbsp; After the course, you will be certified to 30 meters which will open up more dive sites to you around the world.&nbsp; You will also be able to choose 3 specialty dives based on your interests!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Top 10 reasons to&nbsp;take the PADI Advanced Course:</strong></p>
<p class="font_8">1. Increase your knowledge of diving</p>
<p class="font_8">2. Expand the skills you’ve learned while supervised</p>
<p class="font_8">3. Dive as deep as 30m and see more</p>
<p class="font_8">4. Gain confidence in yourself</p>
<p class="font_8">5. Be more comfortable in the water</p>
<p class="font_8">6. Be more comfortable with the equipment</p>
<p class="font_8">7. Try 5 different kinds of adventure dives</p>
<p class="font_8">8. More chances to explore different dive sites locally and worldwide</p>
<p class="font_8">9. Higher credentials, less hassle when traveling</p>
<p class="font_8">10. Meet new dive buddies</p>', '<p class="font_8">The PADI Advanced Open Water Diver Course is a great way to improve your diving skills, get additional diving experience under the supervision of an instructor and increase your knowledge about diving.&nbsp;</p>', NULL, '<p class="font_8"><u><strong>PADI Advanced Open Water Course with Fun Divers Tw</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8">Come take the next step and get your PADI Advanced Certification with Fun Divers Tw!</p>
<p class="font_8">By taking the PADI Advanced Course, you will learn more about the underwater world while expanding your diving skills. You will practice your navigation and go deeper. After the course, you will be certified to 30 meters which will open up more dive sites to you around the world.&nbsp;</p>
<p class="font_8"><br></p>
<p class="font_8">The course includes 5 dives, 2 of which are required (deep &amp; navigation) and you will also be able to choose 3 specialty dives based on your interests! Choose which specialties are right for you! See your options on our <a href="https://www.fundiverstw.com/specialties">website</a>!</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Course Price</strong>：$12,200</p>
<p class="font_8">價錢 ：$12,200</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Gear Rental</strong>: 1200ntd/Day.<br>
 <br>
Course fees include PADI E-Learning, SMB, Reel, Transportation and Full Coverage Diving Insurance. &nbsp;Students are required to purchase their own masks and snorkels due to covid concerns.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Current Course Dives Scheduled:</strong></p>
<p class="font_8"><strong>Jul 30: </strong>2 Dive Day</p>
<p class="font_8"><strong>Jul 31: </strong>2 Dive Day</p>
<p class="font_8"><strong>Aug 06: </strong>3 Dive Day with Night Dive</p>
<p class="font_8"><br></p>
<p class="font_8">If the above dates don’t work for you, contact us and we can work out a schedule for you!</p>
<p class="font_8"><br></p>
<p class="font_8">Transfer 5000ntd Deposit to the account below to secure your spot!</p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
 中國信託銀行：822<br>
 帳號：1305 4100 1904<br>
 分行：雙和</p>
<p class="font_8">Please transfer the deposit to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">Learn Scuba Diving with Fun Divers Tw! The Way Diving Should Be Taught!<br>
 今年夏天來成為合格的PADI潛水員吧！</p>
<p class="font_8">Find out more information about the PADI Advanced Course on our <a href="https://www.fundiverstw.com/Courses/PADI-Advanced-Course">website</a>!</p>', 'PADI Open Water Certification (or other organization equivalent) Required before taking this course', NULL, 'Jul 30, 31, Aug 6', '12,200 NTD', '2022-07-29T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-08-13T10:35:05Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('ce661c4c-874c-43e5-8f63-562c46a7a9cf', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI Advanced Course', 'wix:image://v1/b37fef_3166e2616932488aad593a8fb4c8f6d8~mv2.jpg/64365829_2620424691314544_71180475215443.jpg#originWidth=1200&originHeight=900', '<p class="p1"><span style="font-family:corben,serif">By taking the<span style="text-decoration:underline"><a href="https://www.fundiverstw.com/Courses/PADI-Advanced-Course"> PADI Advanced Course</a></span>, you will learn more about the underwater world while expanding your diving skills.&nbsp; You will practice your navigation and go deeper.&nbsp; After the course, you will be certified to 30 meters which will open up more dive sites to you around the world.&nbsp; You will also be able to choose 3 specialty dives based on your interests!</span></p>

<p class="p1"><span style="font-family:corben,serif">​</span></p>

<p class="p1"><span style="font-family:corben,serif">Top 10 reasons to&nbsp;take the PADI Advanced Course:</span></p>

<p class="p1"><span style="font-family:corben,serif">1. Increase your knowledge of diving</span></p>

<p class="p1"><span style="font-family:corben,serif">2. Expand the skills you&rsquo;ve learned while supervised</span></p>

<p class="p1"><span style="font-family:corben,serif">3. Dive as deep as 30m and see more</span></p>

<p class="p1"><span style="font-family:corben,serif">4. Gain confidence in yourself</span></p>

<p class="p1"><span style="font-family:corben,serif">5. Be more comfortable in the water</span></p>

<p class="p1"><span style="font-family:corben,serif">6. Be more comfortable with the equipment</span></p>

<p class="p1"><span style="font-family:corben,serif">7. Try 5 different kinds of adventure dives</span></p>

<p class="p1"><span style="font-family:corben,serif">8. More chances to explore different dive sites locally and worldwide</span></p>

<p class="p1"><span style="font-family:corben,serif">9. Higher credentials, less hassle when traveling</span></p>

<p class="p1"><span style="font-family:corben,serif">10. Meet new dive buddies</span></p>', '<p class="font_8 p1"><span style="font-family: corben, serif">The PADI Advanced Open Water Diver Course is a great way to improve your diving skills, get additional diving experience under the supervision of an instructor and increase your knowledge about diving.&nbsp;</span></p>', NULL, '<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Come take the next step in your diving adventure and get your PADI Advanced Certification with Fun Divers Tw!</span></span><br>
&nbsp;</p>
<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">By taking the PADI Advanced Course, you will learn more about the underwater world while expanding your diving skills. You will practice your navigation and go deeper. After the course, you will be certified to 30 meters which will open up more dive sites to you around the world. You will also be able to choose 3 specialty dives based on your interests! Choose which specialties are right for you!</span></span></p>
<p class="font_8" style="font-size: 17px"><br>
&nbsp;<span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>Course Price (with English Book) </strong></span></span><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">：$10,400</span></span></p>
<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>價錢 (中文教材)</strong></span></span><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">：$10,000</span></span><br>
&nbsp;</p>
<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>Get a discount if you sign up with a friend!</strong></span></span></p>
<p class="font_8" style="font-size: 17px"><br>
&nbsp;<span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Gear Rental: 1200ntd/Day.</span></span></p>
<p class="font_8"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Additional gear rental charge for some specialties.</span></span></p>
<p class="font_8" style="font-size: 17px"><br>
&nbsp;<span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Course fees include Books and Transportation.</span></span></p>
<p class="font_8" style="font-size: 17px">&nbsp;</p>
<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">Learn Scuba Diving with Fun Divers Tw! The Way Diving Should Be Taught!</span></span></p>
<p class="font_8" style="font-size: 17px"><span style="font-size: 17px"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">今年夏天來成為合格的PADI潛水員吧！</span></span></p>', 'PADI Open Water Certification (or other organization equivalent) Required before taking this course', NULL, NULL, '10,400 NTD', '2020-05-15T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-05-15T06:52:12Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('cfe5ff09-96a9-47b1-ab6e-20d026ef5a40', 'Happy World Pool', NULL, NULL, NULL, NULL, 'Free Try Dive', 'wix:image://v1/b37fef_b22c67c4e51440c1929b2292262e7b15~mv2.jpg/20170514-IMG_3567.jpg#originWidth=1600&originHeight=1067', '<p class="p1"><span style="font-family:corben,serif">Are you curious about diving but not sure if it is right for you?&nbsp; Come give Scuba Diving a try in the comfort of a swimming pool and see what it is like to breathe underwater for the first time!&nbsp; You will get to try on the gear, practice breathing under water, and even go for an underwater swim using the Scuba Gear!&nbsp;&nbsp;</span></p>', '<p class="p1"><span style="font-family:corben,serif;">Are you curious about diving but not sure if it is right for you?&nbsp; Come give Scuba Diving a try in the comfort of a swimming pool and see what it is like to breathe underwater for the first time!</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif">週六(4/20) Fun Divers 特別為大家準備了一場免費的泳池體驗潛水！想知道在水中吐泡泡的感覺嗎？歡迎來大新店游泳池找我們體驗喔！<br />
加拿大國慶日慶祝活動，當天報名PADI潛水課程的朋友，即可獲得免費面鏡及呼吸管一組～<br />
<br />
Want to know what it feels like to breath underwater? Curious about scuba diving but not sure if it is for you?<br />
<br />
Come try Scuba Diving with Fun Divers for FREE, Saturday, April 20th at Happy World.<br />
<br />
We will be in the water from 10am-1pm. Come by and see what you are missing!<br />
<br />
Notes:<br />
<br />
Be sure to bring a swimsuit and swim cap.<br />
The pool entrance fee for those who want to do the try dive is 100ntd but after you try scuba diving, stay and enjoy the pool facilities! There are hot tubs, saunas, children&rsquo;s play area, indoor heated pool, and other facilities to try out.<br />
<br />
前往大新店泳池參加體驗潛水的朋友們～<br />
大新店招待入門票$100(原價$300)<br />
趕快把握機會哦！</span></p>', NULL, NULL, NULL, 'FREE(just pay pool entry fee)', '2019-04-19T16:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-03-15T00:54:01Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('d6919b8b-afd3-43e1-a45c-d6ee5c7c331a', 'Badouzi AM 2 BD EANx', 'Transportation(if needed), Local Diving Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide', 'Gear Rental, Food/Drinks', NULL, NULL, 'Local Boat Diving', 'wix:image://v1/b37fef_180ce15d03e24b0694ce1100c9bdd345~mv2.jpg/Badouzi%20and%20the%20Boat.jpg#originWidth=800&originHeight=450', '<p class="font_8">Fun Divers Tw is heading out to Badouzi Harbor to do some boat diving!&nbsp; Come Explore some of the amazing off-shore dive sites with us and see why we love diving there so much.&nbsp; We will be doing 2 boat dives at 2 different sites.</p>', '<p class="font_8">Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!</p>', 'Explore some of the local dive sites not reachable from shore! See wrecks, artificial reefs and natural reefs with abundant sea life!', '<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">厭倦了岸潛需要背上背下裝備嗎？來參加我們的八斗子船潛行程吧~<br>
Tired of the heavy lifting on shore dives?<br>
Come explore the outer reaches of Badouzi Bay by Boat<br>
<br>
費用包含：<br>
交通，保險 ，船潛兩支， 兩支氣瓶，潛導<br>
Included: Transportation(if needed), Travel Insurance, 2 Boat Dives, 2 Nitrox Tanks, Dive Guide<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>團費 Tour Price:</strong></span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"> $3,200<br>
<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>額外費用 Additional:</strong></span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><br>
一天裝備租借 Full Equipment Rental: $1000<br>
<br>
＊ 請儘早匯入訂金$2,000 ，餘款9/14前完成匯款即可。<br>
Please transfer a $2,000 deposit As Soon As Possible to confirm your seat.<br>
The remaining balance must be paid on September 14th when we meet.<br>
<br>
Please transfer the deposit to:<br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
<br>
</span><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif"><strong>＊記得攜帶防曬用品,浮力袋(船潛必備),電腦表<br>
＊Remember to Bring:</strong></span></p>
<p class="font_8 p1"><span style="font-family: avenir-lt-w01_35-light1475496, sans-serif">-ID Card (for Coast Guard)<br>
- Certification Card<br>
- Log Book<br>
- Surface Marker Buoy (SMB) – All divers MUST have<br>
<br>
臨時取消行程之賠償金額 Cancellation Fee<br>
• 10天前取消，行程費用之25% － 25% of trip price within 10 days of the trip<br>
• 7天前取消，行程費用之50% － 50% of trip price within 7 days of the trip<br>
• 5天前取消，不予以退費 － Within 5 days of trip price, there will be no refund</span></p>', 'AOW & Nitrox Certification Required', '06:15 - Meet at Fun Divers
07:30 - Meet at Port
08:00 - Boat Departs
12:00 - Boat Returns (wash gear at port)
12:30 - Depart for Taipei', NULL, '3,200 NTD', '2019-09-13T20:00:00Z', NULL, false, NULL, 'ce562dca-32d5-4d05-8a82-027a55404703', true, NULL, '2019-05-15T07:33:10Z', '2026-04-09T08:35:18Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('d94f4b25-c101-4834-980f-7e75722671cb', 'Kenting', NULL, NULL, NULL, '/DiveTravel/kenting/dec-16-18', 'Multi-Day Fun Diving Trip', 'wix:image://v1/b37fef_0386b474d7ad4e5eb46fd69d752935b2~mv2.jpg/P7170243.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">A trip to Kenting to explore the underwater world at the southern tip of Taiwan.&nbsp; We may also take some time to explore the surrounding area and do some sightseeing.</p>', '<p class="font_8">A great place for diving as well as exploring above the water.&nbsp; We will check out some of the great dive sites there, swim with blue spotted stingrays, turtles and batfish.&nbsp; Then, we will visit some of the beaches and the nightmarket as well!</p>', NULL, '<p class="font_8"><strong>費用包含：</strong><br>
 兩晚, 早餐x 2, 中餐x 2, 晚餐x 1, 船潛x 6, 兩天潛水險<br>
 <strong>Included:</strong><br>
2 Nights Room, 2 Breakfasts, 2 Lunches, 1 Dinner, 6 Boat Dives, 2 Days Full Diving Insurance.<br>
 <br>
 <strong>團費 Tour Price:</strong> <br>
 背包房 Bunk Bed: $12,400<br>
 雙人房 Double Bed: $13,000 (double occupancy)</p>
<p class="font_8">單人房 Single Room: $15,500 <br>
 <br>
 <strong>額外費用Additional Things to Consider:</strong><br>
 全套裝備租借(含電腦錶和浮力棒) Full Equipment Rental: $1600 x 2 days</p>
<p class="font_8">(includes Dive Computer and SMB)</p>
<p class="font_8">台北墾丁來回交通費Return Transport: $1600 <br>
 <br>
 <strong>課程Course Discounts:</strong><br>
 高氧課程 Enriched Air Nitrox Specialty $6,000 (原價 Normal Price $6,600)</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,200 (原價 Normal Price $6,200)</p>
<p class="font_8">進階課程 Advanced Open Water $11,000 (原價 Normal Price $12,200)</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>＊ 請於匯入訂金$8,000 Please transfer $8,000 deposit to confirm your booking.</strong></p>
<p class="font_8"><strong>餘款需於12/01 付清 The remaining balance must be paid by 12/01.</strong></p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
 中國信託銀行：822<br>
 帳號：1305 4100 1904</p>
<p class="font_8">分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to: <br>
 Wong, Dennis<br>
 CTBC Bank<br>
 Bank code: 822<br>
 Account: 1305 4100 1904<br>
Branch: Shuang He<br>
 <br>
 <br>
 <strong>行程Approximate Itinerary:<br>
 </strong><br>
 <strong>Day 1</strong></p>
<p class="font_8">18:30 Fun Divers Dive Center<br>
00:00 墾丁 Kenting</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Day 2</strong></p>
<p class="font_8">07:00 起床 Wake up <br>
07:30 早餐 Breakfast <br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch <br>
13:00 船潛兩支 2 boat dives<br>
18:00 晚餐 Dinner<br>
 <br>
 <strong>Day 3</strong></p>
<p class="font_8">07:00 起床 Wake up <br>
07:30 早餐 Breakfast <br>
08:00 船潛兩支 2 boat dives<br>
12:00 中餐 Lunch <br>
13:00 打包行李 Pack up<br>
14:00 回台北 Drive back to Taipei<br>
 <br>
 ＊額外之餐費與娛樂費用請自理<br>
 ＊Additional Food, Drinks &amp; Entertainment are NOT included <br>
 <br>
 ＊記得攜帶 Remember to Bring:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 電腦表 Dive Computer<br>
- 浮力棒 (SMB) Surface Marker Buoy<br>
- 暈船藥 Seasick Pills<br>
- 防賽 Sun Protection<br>
 <br>
 <u>臨時取消行程之賠償金額Cancellation Fee</u></p>
<p class="font_8"><u>· 14天前取消，行程費用之25% － 25% of Deposit within 14 days of the trip</u></p>
<p class="font_8"><u>· 10天前取消，行程費用之50% － 50% of Deposit within 10 days of the trip</u></p>
<p class="font_8"><u>· 07天前取消，不予以退費 － Within 7 days of trip, there will be no refund</u></p>', 'Advanced Certification Recommended', NULL, 'Dec 16-18', 'Starting at 12,400', '2022-12-15T16:00:00Z', '52224a76-927a-4e3e-8c52-2d34afacbdf0', false, NULL, NULL, NULL, true, '2022-09-07T02:46:29Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('e02ff469-09b8-449b-95e8-95d8c0a373b1', 'Secret Garden', NULL, NULL, NULL, '/DiveTravel/secret-garden/2024-03-30', 'Local Shore Diving', 'wix:image://v1/b37fef_40a5952412534a118f65ed71551422e4~mv2_d_4026_3008_s_4_2.jpg/Lobster1.jpg#originWidth=4026&originHeight=3008', '<p class="font_8">A lovely dive site full of soft corals and giant groupers.&nbsp; Also a great place to see nudibranchs.</p>', '<p class="font_8">A lovely dive site full of soft coral and giant groupers. Also a great place to see Nudibranchs!</p>', NULL, '<p class="font_8">Fun Divers Tw&nbsp;is heading to Secret Garden to do some fun diving!&nbsp; Come join us for some fun in the sun and under the water!</p>
<p class="font_8">&nbsp;</p>
<p class="font_8">We depart from Fun Divers at 8:30 am and return at 4:30 pm.</p>
<p class="font_8"><br></p>
<p class="font_8">Price: 1500ntd for 2 dives including: tanks, transportation, dive guide, and full coverage local dive insurance.</p>
<p class="font_8">&nbsp;</p>
<p class="font_8">Gear rental is 1500ntd for a full set, including dive computer.</p>
<p class="font_8">&nbsp;</p>
<p class="font_8">RSVP early since there are limited spots available.</p>
<p class="font_8">&nbsp;</p>
<p class="font_8">Be sure to bring sunscreen, snacks, water, and swimsuit.&nbsp;&nbsp;If you have any other questions about courses and other events, please feel free to send us a message!&nbsp;&nbsp;See you in the water!</p>', 'A challenging but beautiful dive site', NULL, '2024-03-30', '1,500 NTD', '2020-05-22T16:00:00Z', NULL, true, NULL, 'cb84ef01-98e5-4b17-b06d-3fc681a0107a', true, NULL, '2019-03-14T04:57:40Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('e57fe3a2-d9ae-4902-ae4b-3e58f4d248fb', 'Fun Divers Dive Center', NULL, NULL, NULL, '/DiveTravel/fun-divers-dive-center/sep-17%2C-24%2C-25', 'PADI Open Water Course', 'wix:image://v1/b37fef_db627ed59e1844f7bdaadb1bf73e674c~mv2_d_4000_3000_s_4_2.jpg/brian%20swimming.JPG#originWidth=4000&originHeight=3000', '<p class="font_8">The PADI Open Water Course is the first step in your underwater journey!&nbsp; Learn how to use Scuba Diving Equipment, how to handle yourself underwater, and how to fully enjoy your time underwater.&nbsp; Let Fun Divers TW introduce you to the amazing world of Scuba Diving in Taiwan (and the world)! &nbsp;</p>', '<p class="font_8">Start your underwater adventure by getting your PADI Open Water Certification!&nbsp;</p>', NULL, '<p class="font_8">Do you want to learn to Scuba Dive?! Now is the last chance to do it in the North! Fun Divers Tw is starting a course on September 17th! &nbsp;This course will be a PADI E-Learning Course so the academic portion will all be done on your own and we will meet for the Pool and Ocean sessions. See the schedule below.<br>
 <br>
 <strong>Price</strong> ：14,600ntd</p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8">Price includes E-Learning, transportation, and gear rental. Due to Covid concerns, students will need to purchase their own Mask and Snorkel for use during the course. There is a selection to choose from at Fun Divers Tw.<br>
 <br>
 今年夏天來成為合格的PADI潛水員吧！<br>
 Learn Scuba Diving with Fun Divers Tw!<br>
 The Way Diving Should Be Taught<br>
 <br>
 Fun Divers 課程已完全更新，符合PADI教學課程之規定。為了能夠更安全的享受潛水活動，請跟我們一起學習安全且符合規定的潛水新知吧！<br>
 <br>
 <strong>17 Sep: 8:30am-4pm </strong><br>
 先上泳池 ，下午回來Fun Divers潛水教室考試<br>
 Knowledge Check and Pool lessons<br>
 Bring your swimsuit, towel and a snack<br>
 <br>
 <strong>24 &amp; 25 Sep: 8:30am-4pm</strong></p>
<p class="font_8">Open Water Dives</p>
<p class="font_8">Bring your swimsuit, towel, snacks, water and logbook</p>
<p class="font_8">Please transfer a 5000ntd deposit to confirm your spot in the class. Notify Fun Divers Tw when the transfer is complete.<br>
 <br>
Please transfer payments to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He<br>
 <br>
 ＊戶外課程將視天氣狀況作調整</p>
<p class="font_8">Find out more information about the Open Water Course on our <a href="https://www.fundiverstw.com/courses-1/padi-open-water-course">website</a>!</p>', 'Beginning Level Course Open to All', NULL, 'Sep 17, 24, 25', '14,600 NTD', '2022-09-16T16:00:00Z', NULL, false, NULL, NULL, true, false, '2021-04-06T03:39:31Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('e60cef1a-6f94-40e7-a480-9b1f1ce38004', 'Orchid Island', NULL, NULL, NULL, '/DiveTravel/orchid-island/may-05-08', 'Multi-Day Dive Trip', 'wix:image://v1/b37fef_4a6d3d96a1994fe08f5730a938a4c88d~mv2.jpg/320547905_1220142575584864_5730544204671620220_n.jpg#originWidth=1224&originHeight=816', '<p class="font_8">A dive trip to explore the crystal clear waters of Orchid Island. &nbsp;We will be exploring amazing wrecks, reefs and pinnacles! &nbsp;We will also explore this remote island above the water as well!</p>', '<p class="font_8">Come dive the crystal clear waters of Orchid Island and see why this is rated one of the best spots for diving in Taiwan!</p>', NULL, '<p class="font_8">2023 May 05-08 Orchid</p>
<p class="font_8"><u><strong>蘭嶼 Orchid Island</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8">Come see the spectacular Orchid Island and enjoy the clear water and amazing sea life!</p>
<p class="font_8"><br></p>
<p class="font_8">費用包含：</p>
<p class="font_8">來回船票， 三晚上住宿 ，早餐 x 3，午餐 x 2，晚餐 x 2，機車(兩人一台)，船潛六支，兩天潛水保險。</p>
<p class="font_8"><br></p>
<p class="font_8">Included:</p>
<p class="font_8">Return Ferry, 3 Nights Shared Rooms , 3 Breakfasts, 2 Lunches, 2 Dinners, 3 Days Shared Motorbike, 6 Boat Dives, 2 Days Full Coverage Diving Insurance</p>
<p class="font_8"><br></p>
<p class="font_8">＊額外之餐費與娛樂費用請自理</p>
<p class="font_8">Additional Food, Drinks &amp; Entertainment are NOT included</p>
<p class="font_8"><br></p>
<p class="font_8">團費 Tour Price:</p>
<p class="font_8">四人通舖房Shared Quad Room: $25,500 (4 people in room)</p>
<p class="font_8">雙人房 Double Room: $27,400 (double occupancy)</p>
<p class="font_8">(交通車有16個位子 Total of 16 spots reserved)</p>
<p class="font_8"><br></p>
<p class="font_8">額外費用 Additional:</p>
<p class="font_8">基本裝備租借 Basic Equipment Rental: $1,200 x 2 days</p>
<p class="font_8">全套裝備租借(含電腦錶和浮力棒)Full EquipmentRental: $1600 x 2 days (includes Dive Computer and SMB)</p>
<p class="font_8">台北墾丁來回交通費 Taipei/Kenting Return Transport: $1,600</p>
<p class="font_8"><br></p>
<p class="font_8">課程 Courses:</p>
<p class="font_8">高氧課程 Enriched Air Nitrox Specialty $6,000 (原價 Normal Price $6,600)</p>
<p class="font_8">深潛課程 Deep Dive Specialty $5,200 (原價 Normal Price $6,200)</p>
<p class="font_8">進階課程 Advanced Open Water $11,000 (原價 Normal Price $12,200)</p>
<p class="font_8"><br></p>
<p class="font_8">行程Approximate Itinerary:</p>
<p class="font_8"><br></p>
<p class="font_8">May 5th</p>
<p class="font_8">(As early as possible): 瘋潛水集合 Meet at Fun Divers Dive Center<br>
Evening: 抵達墾丁Arrive in Kenting</p>
<p class="font_8"><br></p>
<p class="font_8">May 6th</p>
<p class="font_8">06:00 早餐 Breakfast</p>
<p class="font_8">06:45 出發 Depart</p>
<p class="font_8">07:30 後壁湖漁港 Houbihu Dock－蘭嶼 Orchid Island</p>
<p class="font_8">09:30 自由時間 Free Time</p>
<p class="font_8">11:30 中餐 Lunch</p>
<p class="font_8">12:30 船潛兩支 2 Boat Dives</p>
<p class="font_8">18:00 晚餐 Dinner</p>
<p class="font_8"><br></p>
<p class="font_8">May 7th</p>
<p class="font_8">07:30 早餐Breakfast</p>
<p class="font_8">08:00 船潛兩支 2 Boat Dives</p>
<p class="font_8">12:00 中餐 Lunch</p>
<p class="font_8">13:00 船潛兩支 2 Boat Dives</p>
<p class="font_8">18:00 晚餐 Dinner</p>
<p class="font_8"><br></p>
<p class="font_8">May 8th</p>
<p class="font_8">07:30 早餐Breakfast</p>
<p class="font_8">09:30 蘭嶼 Orchid Island ─ 後壁湖漁港 Houbihu Dock</p>
<p class="font_8">12:00 離開墾丁 Depart from Kenting</p>
<p class="font_8">19:00 抵達台北 Arrive in Taipei</p>
<p class="font_8"><br></p>
<p class="font_8">＊ 請於匯入訂金$15,000 Please transfer $15,000 deposit to confirm your booking.</p>
<p class="font_8">餘款需於04/25付清 The remaining balance must be paid by 04/25.</p>
<p class="font_8"><br></p>
<p class="font_8">匯款帳號如下，匯款完畢,請私訊Wong, Dennis哦!<br>
 中國信託銀行：822<br>
 帳號：1305 4100 1904<br>
 分行：雙和</p>
<p class="font_8"><br></p>
<p class="font_8">Please transfer the deposit to: <br>
Wong, Dennis<br>
CTBC Bank<br>
Bank code: 822<br>
Account: 1305 4100 1904<br>
Branch: Shuang He</p>
<p class="font_8"><br></p>
<p class="font_8">＊記得攜帶Remember to Bring:<br>
- 證照卡 Certification Card<br>
- 潛水日誌 Log Book<br>
- 電腦表 Dive Computer(required) (rental 300/day)<br>
- 浮力棒 (SMB) Surface Marker Buoy(required) (rental 150/day)<br>
- 暈船藥 Seasick Pills<br>
- 防賽 Sun Protection</p>
<p class="font_8">- 大毛巾Towel</p>
<p class="font_8">- 薄夾克Jacket</p>
<p class="font_8"><br></p>
<p class="font_8"><u>臨時取消行程之賠償金額Cancellation Fee</u></p>
<p class="font_8">· 28天前取消，行程費用之25% － 25% of Deposit within 28 days of the trip</p>
<p class="font_8">· 14天前取消，行程費用之50% － 50% of Deposit within 14 days of the trip</p>
<p class="font_8">· 10天前取消，不予以退費 － Within 10 days of trip, there will be no refund</p>', 'Advanced Diver (can do course during trip)', NULL, 'May 05-08', 'Starting at 25,500 NTD', '2023-05-04T16:00:00Z', 'b8d64fe7-d7c2-487a-b4a0-9899d014bb9b', false, 'wix:document://v1/ugd/b37fef_a2ab1951e88b49b085805bff32b3d0dd.docx/Orchid%20Island%20May%202023.docx', NULL, NULL, true, '2020-05-25T00:53:04Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('eb686139-46ec-4c7c-abe5-5613e6f6731e', 'Long Dong Bay Weekend', '2 Shore Dives, Tanks, Weights, Dive Guide, Transportation from Fun Divers Tw, and Full Coverage Local Dive Insurance', 'Gear Rental, food & drinks are not included', NULL, '/DiveTravel/long-dong-bay/2024-03-28', 'Local Shore Diving', 'wix:image://v1/b37fef_dd7896ba82d140999eb8d813d246920b~mv2.jpg/Long%20Dong%20Bay%20bird''s%20eye.jpg#originWidth=600&originHeight=399', NULL, '<p class="font_8">A popular site, whose name translates to "Dragon''s Cave Bay". Explore the underwater ridge and the Squid Farms when in season!</p>', 'A popular site, whose name translates to "Dragon''s Cave Bay". Explore the underwater ridge and the Squid Farms when in season!', NULL, 'Must be a certified diver.', '8:20 - Meet at Fun Divers Tw
8:30 - Depart Fun Divers Tw
9:30 - Arrive at Long Dong Bay
2 Shore Dives
14-15:00 - Depart Long Dong Bay
15-16:00 - Arrive Fun Divers Tw', '2024-03-28', '1,600 NTD', NULL, NULL, true, NULL, '9fe728dc-4ca7-4d90-bad0-6aaf6edb5329', true, NULL, '2024-03-14T05:16:12Z', '2026-04-09T12:28:35Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('eb8ce40c-8ece-477a-aeeb-828dec28a69b', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI Rescue Course', 'wix:image://v1/b37fef_089babb8c3cf4f7b8c993a574dbbaa0a~mv2.jpg/rescue%20course%20picture.jpg#originWidth=1000&originHeight=667', '<p class="font_8">The PADI Rescue Diver Course prepares you to deal with dive emergencies, minor and major, using a variety of techniques. Through knowledge development and rescue exercises, you learn what to look for and how to respond. During rescue scenarios, you put into practice your knowledge and skills.</p>
<p class="font_8">Topics include:</p>
<ul class="font_8">
  <li><p class="font_8">Self-rescue</p></li>
  <li><p class="font_8">Recognizing and managing stress in other divers</p></li>
  <li><p class="font_8">Emergency management and equipment</p></li>
  <li><p class="font_8">Rescuing panicked divers on the surface and underwater</p></li>
  <li><p class="font_8">Rescuing unresponsive divers on the surface and underwater</p></li>
  <li><p class="font_8">Missing diver procedures&nbsp;</p></li>
</ul>', '<p class="font_8">Learn to manage or prevent problems in or out of the water.&nbsp; Be the dive buddy others can rely on!&nbsp;&nbsp;&nbsp;The PADI Rescue Diver course is a challenging, yet rewarding course that will make you a better diver who is more confident in their abilities!</p>', NULL, '<p class="font_8"><u><strong>PADI Rescue Course with Fun Divers Tw</strong></u></p>
<p class="font_8"><br></p>
<p class="font_8">Are you ready to be the best diver you can be? Come take the PADI Rescue Diver course with Fun Divers Tw!</p>
<p class="font_8"><br></p>
<p class="font_8">In this course you will learn how to prevent emergencies before they happen and deal with emergencies when they do happen. It is a challenging, yet rewarding course that will make you a better diver who is more confident in their abilities!</p>
<p class="font_8"><br></p>
<p class="font_8">To get your PADI Rescue Diver Certification, you must have a current First Aid/CPR Certification. For those who don’t have one, we can schedule you for a PADI Emergency First Responder (EFR) Course in conjunction with the Rescue Diver Course.</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Course price:</strong> &nbsp;</p>
<p class="font_8">Rescue Course: 9,200ntd</p>
<p class="font_8">EFR Course: 5,800ntd</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Get a discount if you sign up with a friend!</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Gear rental:</strong> 1200ntd/day</p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Course Schedule:</strong></p>
<p class="font_8"><br></p>
<p class="font_8"><strong>Jun 6:</strong> Rescue Course Classroom and Pool Session</p>
<p class="font_8"><strong>Jun 7:</strong> Rescue Course Ocean Session at Batcave</p>
<p class="font_8"><br></p>
<p class="font_8">Contact us about scheduling your PADI EFR Course</p>
<p class="font_8"><br></p>
<p class="font_8">See more details about the PADI Rescue Course on our <a href="https://www.fundiverstw.com/Courses/PADI-Rescue-Diver-Course">website</a>!</p>', 'PADI Advanced Certification and 20 Dives Minimum Reqiured', NULL, NULL, '9,200 NTD', '2020-06-05T17:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-05-15T07:17:24Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('f974d3d1-49c0-4d63-a28c-076360781a3c', 'Long Dong Bay Weekday', '2 Shore Dives, Tanks, Weights, Dive Guide, Transportation from Fun Divers Tw, and Full Coverage Local Dive Insurance', 'Gear Rental, food & drinks are not included', NULL, '/DiveTravel/long-dong-bay/2024-03-28', 'Local Shore Diving', 'wix:image://v1/b37fef_dd7896ba82d140999eb8d813d246920b~mv2.jpg/Long%20Dong%20Bay%20bird''s%20eye.jpg#originWidth=600&originHeight=399', NULL, '<p class="font_8">A popular site, whose name translates to "Dragon''s Cave Bay". Explore the underwater ridge and the Squid Farms when in season!</p>', 'A popular site, whose name translates to "Dragon''s Cave Bay". Explore the underwater ridge and the Squid Farms when in season!', NULL, 'Must be a certified diver.', '8:50 - Meet at Fun Divers Tw
9:00 - Depart Fun Divers Tw
10:00 - Arrive at Long Dong Bay
2 Shore Dives
14-15:00 - Depart Long Dong Bay
15-16:00 - Arrive Fun Divers Tw', '2024-03-28', '1,600 NTD', NULL, NULL, true, NULL, '9fe728dc-4ca7-4d90-bad0-6aaf6edb5329', true, NULL, '2026-04-09T12:28:17Z', '2026-04-09T12:28:58Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('fc241464-c7ff-44d0-8439-6f3b8ea4c350', 'Fun Divers Dive Center', NULL, NULL, NULL, NULL, 'PADI EFR Course', 'wix:image://v1/b37fef_3970088889d24834a7ab01a1fca962b6~mv2.jpg/EFR_print_05(1).jpg#originWidth=1200&originHeight=900', '<p class="p1"><span style="font-family:corben,serif">In the <span style="text-decoration:underline"><a href="https://www.fundiverstw.com/Courses/PADI-EFR-Course">PADI EFR Course</a></span>, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.</span></p>', '<p class="p1"><span style="font-family:corben,serif">Discover simple to follow steps for emergency care. This course focuses on building confidence in lay rescuers and increasing their willingness to respond when faced with a medical emergency in a non-stressful learning environment.&nbsp; You don&#39;t have to be a diver to take this course.</span></p>', NULL, '<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Do you know what to do if someone is injured or not breathing?&nbsp; Learn how to perform CPR and handle emergency situations confidently!&nbsp; Take the PADI Emergency First Responder (EFR) Course with Fun Divers Tw!</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;"><span class="wixGuard">​</span></span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">In the PADI EFR Course, you will learn how to administer basic first aid as well as how to perform CPR properly.&nbsp; You will also be taught how to use an Automated External Defibrillator (AED).&nbsp; The PADI EFR Course is the equivalent of the Red Cross First Aid Certification and is recognized worldwide.&nbsp;</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Course Price:&nbsp; 5800 NTD</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Get a discount if you sign up with a friend!</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Upcoming Course Schedule:&nbsp;&nbsp;</span></p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">December 29th, 12-4 pm</span></p>

<p class="p1">&nbsp;</p>

<p class="p1"><span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">See more details about the PADI EFR Course on our <a href="https://www.fundiverstw.com/Courses/PADI-EFR-Course">website</a>!</span></p>

<p class="p1"><br />
<span style="font-family:avenir-lt-w01_35-light1475496,sans-serif;">Please transfer the total amount to confirm your spot in the class.&nbsp; Notify Fun Divers Tw when the transfer is complete.<br />
<br />
Please transfer payments to:<br />
Wong, Dennis<br />
CTBC Bank<br />
Bank code: 822<br />
Account: 1305 4100 1904</span><br />
&nbsp;</p>', 'Open to all (divers and non-divers welcome)', NULL, NULL, '5,800 NTD', '2019-12-28T18:00:00Z', NULL, false, NULL, NULL, true, NULL, '2019-05-15T07:25:54Z', '2026-04-09T08:14:51Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572');

-- All EO_dives.DiveTravel_reference values in seed.sql now resolve.
alter table public."EO_dives"
  add constraint "EO_dives_DiveTravel_reference_fkey"
  foreign key ("DiveTravel_reference")
  references public."DiveTravel"(_id)
  on update cascade on delete set null;

commit;
