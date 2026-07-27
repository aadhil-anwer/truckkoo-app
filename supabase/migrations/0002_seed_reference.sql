-- Truckkoo — reference data.
--
-- Both tables below are lifted from the live website so the app and the site can
-- never disagree about a city name or a truck tier. If the website changes,
-- regenerate rather than hand-edit.

-- Truck taxonomy, verbatim from ~/truckkoo/index.html (the qfTruck select and
-- the truck cards). Five tiers. Do not invent a sixth.
insert into public.truck_types (code, name_en, name_ar, description_en, description_ar, capacity_kg, sort) values
  ('pickup', 'Small pickup (1 ton)',       'بيك أب صغير',        'Small home moves, single items, quick deliveries.',      'نقل منزلي صغير، قطع مفردة، توصيل سريع.',        1000,  10),
  ('hiup',   'Hi-up (3 tons)',             'هاي أب',              'Furniture, appliances and mid-size cargo with lifting tail.', 'أثاث وأجهزة وحمولات متوسطة مع رافعة خلفية.', 3000,  20),
  ('10t',    '10-ton truck',               'شاحنة ١٠ طن',         'Commercial freight and construction materials.',        'شحن تجاري ومواد بناء.',                        10000, 30),
  ('20t',    '20-ton trailer',             'تريلة ٢٠ طن',         'Heavy haulage and long-distance loads.',                'نقل ثقيل وحمولات لمسافات طويلة.',               20000, 40),
  ('40t',    'Trailer — up to 40 tons',    'تريلة — حتى ٤٠ طن',   'Maximum capacity for industrial and cross-border freight.', 'أقصى سعة للشحن الصناعي وعبر الحدود.',       40000, 50)
on conflict (code) do nothing;

-- NOTE: there is deliberately no 'unsure' row here. "Not sure — advise me" is
-- the ABSENCE of a truck type: loads.truck_type_code IS NULL. Adding a row for
-- it would make the null case ambiguous.

-- 46 cities, lifted verbatim from the website's CITIES array.
-- Source: ~/truckkoo/js/main.js  — do not retype these by hand.
insert into public.cities (name_en, name_ar, country, corridor, sort) values
  ('Muscat', 'مسقط', 'OM', 'Muscat governorate', 10),
  ('Muttrah', 'مطرح', 'OM', 'Muscat governorate', 20),
  ('Seeb', 'السيب', 'OM', 'Muscat governorate', 30),
  ('Bawshar', 'بوشر', 'OM', 'Muscat governorate', 40),
  ('Al Amerat', 'العامرات', 'OM', 'Muscat governorate', 50),
  ('Qurayyat', 'قريات', 'OM', 'Muscat governorate', 60),
  ('Barka', 'بركاء', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 70),
  ('Al Musanaah', 'المصنعة', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 80),
  ('Suwaiq', 'السويق', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 90),
  ('Al Khaburah', 'الخابورة', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 100),
  ('Saham', 'صحم', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 110),
  ('Sohar', 'صحار', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 120),
  ('Liwa', 'لوى', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 130),
  ('Shinas', 'شناص', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 140),
  ('Rustaq', 'الرستاق', 'OM', 'Batinah coast (Muscat - Sohar corridor)', 150),
  ('Nizwa', 'نزوى', 'OM', 'Interior and Dhahirah', 160),
  ('Bahla', 'بهلاء', 'OM', 'Interior and Dhahirah', 170),
  ('Samail', 'سمائل', 'OM', 'Interior and Dhahirah', 180),
  ('Bidbid', 'بدبد', 'OM', 'Interior and Dhahirah', 190),
  ('Izki', 'إزكي', 'OM', 'Interior and Dhahirah', 200),
  ('Adam', 'أدم', 'OM', 'Interior and Dhahirah', 210),
  ('Ibri', 'عبري', 'OM', 'Interior and Dhahirah', 220),
  ('Buraimi', 'البريمي', 'OM', 'Interior and Dhahirah', 230),
  ('Sur', 'صور', 'OM', 'Sharqiyah', 240),
  ('Ibra', 'إبراء', 'OM', 'Sharqiyah', 250),
  ('Sinaw', 'سناو', 'OM', 'Sharqiyah', 260),
  ('Al Mudhaibi', 'المضيبي', 'OM', 'Sharqiyah', 270),
  ('Al Kamil Wal Wafi', 'الكامل والوافي', 'OM', 'Sharqiyah', 280),
  ('Haima', 'هيماء', 'OM', 'Wusta and Dhofar (Salalah corridor)', 290),
  ('Duqm', 'الدقم', 'OM', 'Wusta and Dhofar (Salalah corridor)', 300),
  ('Thumrait', 'ثمريت', 'OM', 'Wusta and Dhofar (Salalah corridor)', 310),
  ('Salalah', 'صلالة', 'OM', 'Wusta and Dhofar (Salalah corridor)', 320),
  ('Taqah', 'طاقة', 'OM', 'Wusta and Dhofar (Salalah corridor)', 330),
  ('Mirbat', 'مرباط', 'OM', 'Wusta and Dhofar (Salalah corridor)', 340),
  ('Khasab', 'خصب', 'OM', 'Musandam', 350),
  ('Dubai', 'دبي', 'AE', 'UAE', 360),
  ('Jebel Ali', 'جبل علي', 'AE', 'UAE', 370),
  ('Abu Dhabi', 'أبوظبي', 'AE', 'UAE', 380),
  ('Sharjah', 'الشارقة', 'AE', 'UAE', 390),
  ('Ajman', 'عجمان', 'AE', 'UAE', 400),
  ('Al Ain', 'العين', 'AE', 'UAE', 410),
  ('Ras Al Khaimah', 'رأس الخيمة', 'AE', 'UAE', 420),
  ('Fujairah', 'الفجيرة', 'AE', 'UAE', 430),
  ('Riyadh', 'الرياض', 'SA', 'Saudi Arabia', 440),
  ('Dammam', 'الدمام', 'SA', 'Saudi Arabia', 450),
  ('Jeddah', 'جدة', 'SA', 'Saudi Arabia', 460)
on conflict (name_en) do nothing;
