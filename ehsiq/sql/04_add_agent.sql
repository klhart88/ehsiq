-- ============================================================
-- EHS-IQ -- link your login to agent access
-- ============================================================
-- 1. In the EHS-IQ Supabase project: Authentication > Users >
--    Add user. Use your email and a strong password, and tick
--    "Auto confirm user".
-- 2. Authentication > Sign In / Providers: turn OFF
--    "Allow new users to sign up".
-- 3. Replace the email below with yours and run this file.
--    Without this row, the app shows nothing, by design.
-- ============================================================

insert into agent_accounts (user_id, display_name)
select id, 'Kelvin Hart'
from auth.users
where email = 'kelvin@smartiqrealty.com'
on conflict (user_id) do update set is_active = true;

-- Should return one row:
select a.display_name, u.email, a.is_active
from agent_accounts a join auth.users u on u.id = a.user_id;
