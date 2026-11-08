-- ── Claude connector v2 (run in Supabase SQL editor) ─────────────
-- Recipe links on planned meals, nutrition per serving on recipes,
-- estimate/fibre details on meal logs, and cook_logs so a "we cooked it"
-- pantry deduction can be undone.

alter table meal_plans
  add column if not exists recipe_id uuid references recipes(id) on delete set null,
  add column if not exists cooked_at timestamptz;

alter table recipes
  add column if not exists nutrition jsonb; -- per serving: {calories, protein_g, carbs_g, fat_g, fibre_g}

alter table meal_logs
  add column if not exists fibre_g numeric,
  add column if not exists source text default 'manual' check (source in ('photo_estimate', 'recipe', 'manual')),
  add column if not exists items jsonb,
  add column if not exists meal_plan_id uuid references meal_plans(id) on delete set null;

create table if not exists cook_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete set null,
  recipe_name text not null,
  servings numeric,
  meal_plan_id uuid references meal_plans(id) on delete set null,
  meal_log_id uuid references meal_logs(id) on delete set null,
  deductions jsonb not null, -- [{id, name, unit, used, deleted, snapshot}]
  undone_at timestamptz,
  household_id uuid references households(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table cook_logs enable row level security;

drop policy if exists "Users manage own cook logs" on cook_logs;
create policy "Users manage own cook logs" on cook_logs for all using (
  created_by = auth.uid() or household_id in (
    select household_id from user_profiles where id = auth.uid() and household_id is not null
  )
);
