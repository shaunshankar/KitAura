-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- user_profiles
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text default 'user' check (role in ('admin', 'user')),
  plan text default 'free' check (plan in ('free', 'home', 'premium')),
  household_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- households
create table if not exists households (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  invite_code text unique not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- household_members
create table if not exists household_members (
  id uuid primary key default uuid_generate_v4(),
  household_id uuid references households(id) on delete cascade,
  user_email text,
  user_name text,
  role text default 'member' check (role in ('owner', 'member')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- inventory_items
create table if not exists inventory_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text default 'other' check (category in ('produce','dairy','meat','grains','canned','frozen','beverages','snacks','condiments','bakery','other')),
  location text default 'pantry' check (location in ('pantry','fridge','freezer')),
  quantity numeric default 1,
  unit text default 'unit',
  low_threshold numeric default 1,
  expiry_date date,
  is_fresh_produce boolean default false,
  notes text,
  household_id uuid references households(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- shopping_list_items
create table if not exists shopping_list_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  quantity numeric default 1,
  unit text default 'unit',
  is_purchased boolean default false,
  auto_added boolean default false,
  recipe_tag text,
  category text default 'other',
  description text,
  household_id uuid references households(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- meal_plans
create table if not exists meal_plans (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  meal_type text check (meal_type in ('breakfast','lunch','dinner','snack')),
  recipe_name text not null,
  notes text,
  servings numeric default 1,
  household_id uuid references households(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- meal_logs
create table if not exists meal_logs (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  meal_type text check (meal_type in ('breakfast','lunch','dinner','snack')),
  food_name text not null,
  calories numeric default 0,
  protein_g numeric default 0,
  carbs_g numeric default 0,
  fat_g numeric default 0,
  servings numeric default 1,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- grocery_spend
create table if not exists grocery_spend (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  total numeric not null,
  store text,
  item_count integer,
  notes text,
  household_id uuid references households(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- feedback
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  rating integer check (rating between 1 and 5),
  user_name text,
  user_email text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- RLS Policies
alter table user_profiles enable row level security;
alter table households enable row level security;
alter table household_members enable row level security;
alter table inventory_items enable row level security;
alter table shopping_list_items enable row level security;
alter table meal_plans enable row level security;
alter table meal_logs enable row level security;
alter table grocery_spend enable row level security;
alter table feedback enable row level security;

-- user_profiles: own record only
create policy "Users manage own profile" on user_profiles for all using (auth.uid() = id);

-- households: creator or member
create policy "Household members can read" on households for select using (
  created_by = auth.uid() or id in (
    select household_id from user_profiles where id = auth.uid()
  )
);
create policy "Users can create households" on households for insert with check (created_by = auth.uid());
create policy "Owners can update household" on households for update using (created_by = auth.uid());

-- household_members: same household
create policy "Household members can read members" on household_members for select using (
  household_id in (select household_id from user_profiles where id = auth.uid())
);
create policy "Users can join households" on household_members for insert with check (created_by = auth.uid());
create policy "Members can leave" on household_members for delete using (created_by = auth.uid());

-- inventory_items: own or same household
create policy "Users manage own inventory" on inventory_items for all using (
  created_by = auth.uid() or household_id in (
    select household_id from user_profiles where id = auth.uid() and household_id is not null
  )
);

-- shopping_list_items: own or same household
create policy "Users manage own shopping list" on shopping_list_items for all using (
  created_by = auth.uid() or household_id in (
    select household_id from user_profiles where id = auth.uid() and household_id is not null
  )
);

-- meal_plans: own or same household
create policy "Users manage own meal plans" on meal_plans for all using (
  created_by = auth.uid() or household_id in (
    select household_id from user_profiles where id = auth.uid() and household_id is not null
  )
);

-- meal_logs: own records only
create policy "Users manage own meal logs" on meal_logs for all using (created_by = auth.uid());

-- grocery_spend: own or same household
create policy "Users manage own grocery spend" on grocery_spend for all using (
  created_by = auth.uid() or household_id in (
    select household_id from user_profiles where id = auth.uid() and household_id is not null
  )
);

-- feedback: own records
create policy "Users manage own feedback" on feedback for all using (created_by = auth.uid());

create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now(),
  name text not null,
  description text,
  source_url text,
  source_query text,
  servings int,
  prep_time_min int,
  cook_time_min int,
  ingredients jsonb not null,  -- [{name, quantity, unit, notes}]
  instructions jsonb not null, -- [string]
  tags text[]
);

-- RLS: same pattern as inventory_items (household-scoped or owner)
alter table recipes enable row level security;

create policy "recipes_household_or_owner_select" on recipes for select using (
  household_id in (select household_id from user_profiles where id = auth.uid())
  or created_by = auth.uid()
);
create policy "recipes_owner_insert" on recipes for insert with check (created_by = auth.uid());
create policy "recipes_owner_update" on recipes for update using (created_by = auth.uid());
create policy "recipes_owner_delete" on recipes for delete using (created_by = auth.uid());

-- ── Settings migration (run in Supabase SQL editor) ───────────────
-- alter table user_profiles
--   add column if not exists display_name text,
--   add column if not exists calorie_goal  int default 2000,
--   add column if not exists protein_goal  int default 150,
--   add column if not exists carbs_goal    int default 250,
--   add column if not exists fat_goal      int default 65,
--   add column if not exists dietary_prefs text[] default '{}';
