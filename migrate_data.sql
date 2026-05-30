-- ============================================================
-- KitAura data migration
-- Run in: Supabase Dashboard → SQL Editor
-- Wraps everything in a transaction — rolls back on any error
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_uid uuid;
BEGIN

  -- ── Resolve user UUID ───────────────────────────────────────────
  SELECT id
    INTO STRICT v_uid
    FROM auth.users
   WHERE email = 'shaunshankar1@gmail.com';

  RAISE NOTICE 'Seeding data for user id: %', v_uid;

  -- ── Inventory items ─────────────────────────────────────────────
  INSERT INTO public.inventory_items
    (name, category, location, quantity, unit, low_threshold,
     expiry_date, is_fresh_produce, notes, created_by, household_id)
  VALUES
    ('Mildura Drk Org&Mango',       'beverages',  'fridge',  3,     'L',  0,      '2026-06-23', false, NULL, v_uid, NULL),
    ('Lipton Iced Tea Peach',        'beverages',  'fridge',  0.5,   'L',  1,      '2026-06-23', false, NULL, v_uid, NULL),
    ('Coca Cola Zero Sugar',         'beverages',  'fridge',  2,     'L',  0,      '2026-06-23', false, NULL, v_uid, NULL),
    ('Pineapple Juice',              'beverages',  'fridge',  1,     'L',  0,      '2026-06-23', false, NULL, v_uid, NULL),
    ('Aioli',                        'condiments', 'fridge',  0.38,  'kg', 0,      '2026-06-23', false, NULL, v_uid, NULL),
    ('Milk',                         'dairy',      'fridge',  1,     'L',  0,      '2026-05-31', false, NULL, v_uid, NULL),
    ('Doritos',                      'snacks',     'pantry',  0.425, 'kg', 0,      '2026-08-22', false, NULL, v_uid, NULL),
    ('Tuna in Olive Oil',            'canned',     'pantry',  1.125, 'kg', 1.125,  '2027-05-24', false, NULL, v_uid, NULL),
    ('Rizzoli Tuna Chilli',          'canned',     'pantry',  0.2,   'kg', 0,      '2027-05-24', false, NULL, v_uid, NULL),
    ('Fantastic Crackers',           'snacks',     'pantry',  0.1,   'kg', 0,      '2026-08-22', false, NULL, v_uid, NULL),
    ('Cheese roll',                  'dairy',      'pantry',  0,     'kg', 1,      '2026-06-07', false, NULL, v_uid, NULL),
    ('Mushrooms',                    'other',      'fridge',  0.5,   'kg', 0,      '2026-05-31', true,  NULL, v_uid, NULL),
    ('Coconut Cream',                'canned',     'pantry',  2,     'ea', 0,      '2027-05-23', false, NULL, v_uid, NULL),
    ('Coconut Cream',                'dairy',      'pantry',  2,     'L',  0,      '2027-05-23', false, NULL, v_uid, NULL),
    ('Instant Yeast',                'other',      'pantry',  1,     'ea', 0,      '2026-11-19', false, NULL, v_uid, NULL),
    ('Red Bell Pepper',              'produce',    'pantry',  1,     'ea', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Cabbage',                      'produce',    'pantry',  1,     'ea', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Zucchini',                     'produce',    'pantry',  1,     'ea', 0,      '2026-05-28', true,  NULL, v_uid, NULL),
    ('Pumpkin',                      'produce',    'pantry',  1,     'ea', 0,      '2026-06-02', true,  NULL, v_uid, NULL),
    ('Ginger',                       'produce',    'pantry',  1,     'ea', 0,      '2026-06-06', true,  NULL, v_uid, NULL),
    ('Red Chili Pepper',             'produce',    'pantry',  1,     'ea', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Bitter Gourd',                 'produce',    'pantry',  1,     'ea', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Zucchini',                     'produce',    'fridge',  0,     'ea', 1,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Sand Whiting',                 'meat',       'fridge',  1.546, 'kg', 0,      '2026-06-26', false, NULL, v_uid, NULL),
    ('Battered Flathead Fillets',    'meat',       'freezer', 1,     'ea', 0,      '2026-06-22', false, NULL, v_uid, NULL),
    ('Smoked Cod',                   'other',      'fridge',  0.694, 'kg', 0,      '2026-05-31', false, NULL, v_uid, NULL),
    ('Potatoes',                     'produce',    'pantry',  1,     'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Eggplant',                     'produce',    'fridge',  1,     'ea', 0,      '2026-05-28', true,  NULL, v_uid, NULL),
    ('Green Bell Pepper',            'produce',    'fridge',  1,     'ea', 0,      '2026-05-28', true,  NULL, v_uid, NULL),
    ('Gourmet Tomato',               'produce',    'fridge',  0.98,  'kg', 0,      NULL,         true,  NULL, v_uid, NULL),
    ('Gourmet Tomatoes',             'produce',    'fridge',  1,     'ea', 0,      NULL,         true,  NULL, v_uid, NULL),
    ('Banana',                       'produce',    'pantry',  1,     'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Swiss Brown Mushrooms',        'produce',    'fridge',  1,     'kg', 0,      '2026-05-28', true,  NULL, v_uid, NULL),
    ('Green Thai Hot Chilli',        'produce',    'fridge',  0.12,  'kg', 0,      '2026-05-31', true,  NULL, v_uid, NULL),
    ('Broccoli',                     'produce',    'fridge',  0.3,   'kg', 0,      '2026-05-27', true,  NULL, v_uid, NULL),
    ('Okra',                         'produce',    'fridge',  0.285, 'kg', 0,      '2026-05-28', true,  NULL, v_uid, NULL),
    ('Corn',                         'produce',    'pantry',  1,     'ea', 0,      '2026-06-02', true,  NULL, v_uid, NULL),
    ('Snake Beans',                  'produce',    'fridge',  0.2,   'kg', 0,      '2026-05-29', true,  NULL, v_uid, NULL),
    ('Euro Spices Grinders',         'condiments', 'pantry',  3,     'ea', 0,      '2027-05-23', false, NULL, v_uid, NULL),
    ('Savoy Cabbage',                'produce',    'fridge',  0.5,   'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Celery',                       'produce',    'fridge',  0.5,   'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Carrots',                      'produce',    'fridge',  1,     'kg', 1,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Onion (small)',                 'produce',    'pantry',  0.25,  'kg', 0,      '2026-06-06', true,  NULL, v_uid, NULL),
    ('Lemon',                        'produce',    'fridge',  1,     'ea', 0,      '2026-06-06', true,  NULL, v_uid, NULL),
    ('Cucumber (Lebanese)',           'produce',    'fridge',  0.45,  'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Beans (hand pick)',             'produce',    'fridge',  0.84,  'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Wombok',                       'produce',    'fridge',  0.5,   'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Bok Choy',                     'produce',    'fridge',  0.5,   'kg', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Hass Avocados',                'produce',    'fridge',  3,     'ea', 0,      '2026-05-30', true,  NULL, v_uid, NULL),
    ('Smoked Cod',                   'other',      'fridge',  0.694, 'kg', 0,      '2026-05-31', false, NULL, v_uid, NULL);

  RAISE NOTICE 'Inserted 50 inventory items.';

  -- ── Shopping list items ─────────────────────────────────────────
  INSERT INTO public.shopping_list_items
    (name, category, quantity, unit, is_purchased, auto_added, created_by, household_id)
  VALUES
    ('Sesame oil',           NULL,         1,    NULL,  false, false, v_uid, NULL),
    ('Carrots',              'produce',    2,    'kg',  false, true,  v_uid, NULL),
    ('Coffee Moccona',       NULL,         1,    NULL,  false, false, v_uid, NULL),
    ('Lipton Iced Tea Peach','beverages',  2,    'L',   false, true,  v_uid, NULL),
    ('Marinated Chicken',    'meat',       2,    'kg',  false, true,  v_uid, NULL),
    ('Zucchini',             'produce',    2,    'ea',  false, true,  v_uid, NULL),
    ('Tuna in Olive Oil',    'canned',     2.25, 'kg',  false, true,  v_uid, NULL),
    ('Cheese roll',          'dairy',      2,    'kg',  false, true,  v_uid, NULL),
    ('Bread',                NULL,         1,    NULL,  false, false, v_uid, NULL),
    ('Shower Gel',           NULL,         1,    NULL,  false, false, v_uid, NULL),
    ('Hand Soap',            NULL,         1,    NULL,  false, false, v_uid, NULL),
    ('Milk',                 'dairy',      2,    'L',   false, true,  v_uid, NULL);

  RAISE NOTICE 'Inserted 12 shopping list items.';

  -- ── Grocery spend ───────────────────────────────────────────────
  INSERT INTO public.grocery_spend
    (date, store, total, item_count, notes, created_by, household_id)
  VALUES
    ('2026-05-24', 'SUPABARN',                 23.72,  5,  NULL, v_uid, NULL),
    ('2026-05-24', 'Unknown',                  64.60,  8,  NULL, v_uid, NULL),
    ('2026-05-23', 'Sea Harvest',              69.35,  2,  NULL, v_uid, NULL),
    ('2026-05-23', 'Sea Harvest',              11.79,  1,  NULL, v_uid, NULL),
    ('2026-05-23', 'Garden Fresh',             14.99,  3,  NULL, v_uid, NULL),
    ('2026-05-23', 'Unknown Store',           124.98,  8,  NULL, v_uid, NULL),
    ('2026-05-23', 'Farm Fresh Fruit Market',  11.51, 10,  NULL, v_uid, NULL);

  RAISE NOTICE 'Inserted 7 grocery spend records.';

  -- ── Settings migration (run once if not already applied) ────────
  -- Adds the display_name / nutrition goal / dietary prefs columns.
  -- Safe to run even if the columns already exist (IF NOT EXISTS).
  ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS display_name  text,
    ADD COLUMN IF NOT EXISTS calorie_goal  int  DEFAULT 2000,
    ADD COLUMN IF NOT EXISTS protein_goal  int  DEFAULT 150,
    ADD COLUMN IF NOT EXISTS carbs_goal    int  DEFAULT 250,
    ADD COLUMN IF NOT EXISTS fat_goal      int  DEFAULT 65,
    ADD COLUMN IF NOT EXISTS dietary_prefs text[] DEFAULT '{}';

  RAISE NOTICE 'Settings columns ensured on user_profiles.';

END $$;

COMMIT;
