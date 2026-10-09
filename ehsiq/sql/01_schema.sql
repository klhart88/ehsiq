-- ============================================================
-- EHS-IQ (Elderly Homeowner Support) -- Supabase schema
-- ============================================================
-- Run this ONCE in a NEW, EHS-IQ-only Supabase project
-- (SQL Editor > New query > paste > Run). Never run it in the
-- HomeAccessIQ project.
--
-- Adapted from HomeAccessIQ's schema (read-only reference),
-- with these deliberate differences:
--   * Agent-only app: every table is readable only by an active
--     agent (is_active_agent()), not by the public.
--   * homeowner_profiles holds one row PER CLIENT. HomeAccessIQ's
--     buyer_profiles upserts one row per signed-in user, which
--     would overwrite the previous client on every intake here.
--   * Any profile answer can be NULL, meaning "unknown". The
--     matching engine treats unknown as "Worth a call", never as
--     a fail.
--   * Programs keep a manual funding status (open / waitlist /
--     closed / unknown) plus open questions to ask when calling.
-- ============================================================

create extension if not exists pgcrypto;


-- ---------- Agent access ----------

create table agent_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  display_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create or replace function is_active_agent()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from agent_accounts
    where user_id = auth.uid() and is_active = true
  );
$$;


-- ---------- Shared trigger: keep updated_at current ----------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------- Income reference tables ----------

create table geo_lookup_tables (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null unique,
  description   text,
  value_type    text not null default 'income_limit',
  created_at    timestamptz not null default now()
);

create table geo_lookup_values (
  id                  uuid primary key default gen_random_uuid(),
  lookup_table_id     uuid not null references geo_lookup_tables(id) on delete cascade,
  state_code          char(2) not null default 'IN',
  county_fips         text,
  household_size      int,
  numeric_value       numeric not null,
  effective_date      date not null,
  source_url          text,
  last_verified_date  date not null default current_date
);

create index idx_geo_lookup_values_lookup
  on geo_lookup_values (lookup_table_id, state_code, county_fips);


-- ---------- Programs ----------

create table programs (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  administering_entity  text not null,
  reach                 text not null
    check (reach in ('federal', 'state', 'county', 'city', 'nonprofit')),
  program_type          text not null
    check (program_type in ('grant', 'free_service', 'rebate', 'forgivable_loan',
                            'deferred_loan', 'low_interest_loan', 'referral')),
  description           text,
  benefit_summary       text,
  max_amount            numeric,
  strings_attached      text,
  how_to_apply          text,
  call_script           text,
  source_url            text not null,
  funding_status        text not null default 'unknown'
    check (funding_status in ('open', 'waitlist', 'closed', 'unknown')),
  status_note           text,
  reopens_note          text,
  is_emergency_route    boolean not null default false,
  open_questions        text[] not null default '{}',
  agent_notes           text,
  is_active             boolean not null default true,
  last_verified_date    date not null default current_date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_programs_updated_at
before update on programs
for each row execute function touch_updated_at();

create table program_contacts (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references programs(id) on delete cascade,
  label         text not null,
  phone         text,
  email         text,
  website       text,
  address       text,
  county_fips   text,
  notes         text,
  sort_order    int not null default 0
);

create index idx_program_contacts_program on program_contacts (program_id);

create type rule_type as enum (
  'income_threshold',
  'geographic_scope',
  'homeowner_status',
  'repair_type',
  'property_attribute',
  'external_verification'
);

create table program_eligibility_rules (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references programs(id) on delete cascade,
  rule_type         rule_type not null,
  rule_config       jsonb not null,
  description       text,
  exempts_rule_id   uuid references program_eligibility_rules(id),
  evaluation_order  int not null default 0,
  created_at        timestamptz not null default now()
);

create index idx_eligibility_rules_program on program_eligibility_rules (program_id);

create table program_requirements (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references programs(id) on delete cascade,
  requirement_type  text not null
    check (requirement_type in ('document', 'step', 'condition')),
  description       text not null,
  sort_order        int not null default 0
);

create index idx_program_requirements_program on program_requirements (program_id);


-- ---------- Homeowner profiles (one row per client) ----------

create table homeowner_profiles (
  id                          uuid primary key default gen_random_uuid(),
  created_by                  uuid not null default auth.uid() references auth.users(id),

  client_name                 text not null,
  client_phone                text,
  completed_for_client_by     text,
  consent_given               boolean not null default false,
  consent_date                date,
  consent_method              text,

  property_address            text,
  property_city               text,
  property_zip                text,
  state_code                  char(2),
  county_fips                 text,
  county_name                 text,
  census_tract                text,
  township                    text,
  in_city_indianapolis        boolean,
  inside_i465                 boolean,
  usda_rural_eligible         boolean,

  owner_on_deed               boolean,
  primary_residence           boolean,
  years_in_home               int,
  title_issue                 text,
  home_type                   text,

  age_oldest_owner            int,
  household_size              int,
  household_income            numeric,

  receives_ssi                boolean,
  receives_medicaid           boolean,
  receives_snap               boolean,
  receives_energy_assistance  boolean,
  receives_tanf               boolean,

  is_veteran                  boolean,
  va_service_connected        boolean,
  va_disability_rating        int,

  has_disability              boolean,
  uses_mobility_device        boolean,
  recent_falls                boolean,
  needs_daily_help            boolean,

  repair_categories           text[] not null default '{}',
  urgency                     text,
  cost_estimate_low           numeric,
  cost_estimate_high          numeric,

  savings_band                text,
  mortgage_current            boolean,
  taxes_current               boolean,
  insurance_current           boolean,
  can_afford_small_payment    boolean,
  prior_assistance            text,

  notes                       text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  data_retention_expires_at   timestamptz,
  deleted_at                  timestamptz
);

create index idx_homeowner_profiles_created on homeowner_profiles (created_at desc);

create trigger trg_homeowner_profiles_updated_at
before update on homeowner_profiles
for each row execute function touch_updated_at();

-- Retention: one year after the client's last update, matching
-- HomeAccessIQ's decision. The optional purge job that acts on
-- this lives in 03_retention_purge.sql.
create or replace function set_homeowner_profile_retention()
returns trigger
language plpgsql
as $$
begin
  new.data_retention_expires_at := now() + interval '1 year';
  return new;
end;
$$;

create trigger trg_homeowner_profile_retention
before insert or update on homeowner_profiles
for each row execute function set_homeowner_profile_retention();


-- ---------- Row-level security: active agent only ----------

alter table agent_accounts            enable row level security;
alter table geo_lookup_tables         enable row level security;
alter table geo_lookup_values         enable row level security;
alter table programs                  enable row level security;
alter table program_contacts          enable row level security;
alter table program_eligibility_rules enable row level security;
alter table program_requirements      enable row level security;
alter table homeowner_profiles        enable row level security;

create policy "Agents can read their own agent row"
  on agent_accounts for select
  using (user_id = auth.uid());

create policy "Agents can read lookup tables"
  on geo_lookup_tables for select using (is_active_agent());
create policy "Agents can read lookup values"
  on geo_lookup_values for select using (is_active_agent());

create policy "Agents can read programs"
  on programs for select using (is_active_agent());
create policy "Agents can update programs"
  on programs for update using (is_active_agent()) with check (is_active_agent());

create policy "Agents can read contacts"
  on program_contacts for select using (is_active_agent());
create policy "Agents can read rules"
  on program_eligibility_rules for select using (is_active_agent());
create policy "Agents can read requirements"
  on program_requirements for select using (is_active_agent());

create policy "Agents can read profiles"
  on homeowner_profiles for select using (is_active_agent());
create policy "Agents can add profiles"
  on homeowner_profiles for insert with check (is_active_agent());
create policy "Agents can update profiles"
  on homeowner_profiles for update using (is_active_agent()) with check (is_active_agent());
create policy "Agents can delete profiles"
  on homeowner_profiles for delete using (is_active_agent());
