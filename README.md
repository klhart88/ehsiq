# EHS-IQ (Elderly Homeowner Support)

Agent-only tool that matches older Indiana homeowners who can't afford a major repair to grants, free repair services and forgivable programs, then prints a call plan for the homeowner.

Live at `ehsiq.smartiqrealty.com`. Static site on GitHub Pages, no build step. Data in its own Supabase project.

**Independent of HomeAccessIQ.** Patterns and three helper modules were copied from a read-only copy of HomeAccessIQ. Nothing here shares a repository, database, key or deployment with it, and nothing in this project should ever be pointed at HomeAccessIQ's Supabase project.

## How it works

1. **Intake** (`intake.html`): you enter one homeowner's answers. Any answer can be left as unknown.
2. **Matching** (`js/engineCore.js`): each program's rules are checked. Results come back in four groups:
   - **Likely fit**: every rule passes and the program is open.
   - **Worth a call**: nothing rules it out, but something is unknown or needs confirming. The questions to ask are listed.
   - **Closed for now**: would fit, but isn't taking applications; shows the reopening note.
   - **Not a fit**: a recorded answer fails a rule; the reason is shown.
3. **Plan** (`plan.html`): a large-type page to print and hand over: who to call in order, what to say, what to ask, papers to gather, fallback contacts and a scam warning.
4. **Program status** (`programs.html`): your monthly check. Update funding status, notes and "ask when you call" questions, and mark programs verified.

## One-time setup

### 1. Supabase (new project, EHS-IQ only)

1. Create a new Supabase project named `ehsiq`.
2. SQL Editor: run `sql/01_schema.sql`, then `sql/02_seed.sql`.
3. Authentication > Users > Add user: your email and a strong password, with "Auto confirm user" ticked.
4. Authentication > Sign In / Providers: turn off "Allow new users to sign up".
5. Edit the email in `sql/04_add_agent.sql` and run it. Until this row exists, the app shows nothing.
6. Authentication > URL Configuration: set Site URL to `https://ehsiq.smartiqrealty.com` and add `https://ehsiq.smartiqrealty.com/reset-password.html` to the redirect URLs.
7. Project Settings > API: copy the Project URL and the anon public key into `js/config.js`. Never use the service_role key in this repository.

`sql/03_retention_purge.sql` is optional: it deletes client records a year after their last update, nightly.

### 2. GitHub Pages

1. Create a new, empty repository (for example `ehsiq`) and push these files to it.
2. Settings > Pages: deploy from the `main` branch, root folder.
3. The `CNAME` file already holds `ehsiq.smartiqrealty.com`. In Cloudflare DNS, add a CNAME record `ehsiq` pointing to `<your-github-username>.github.io` (DNS only, not proxied, until GitHub issues the certificate). Then tick "Enforce HTTPS" in Pages settings.

## Changing the program catalog

`data/catalog.json` is the single source of truth for programs, rules, contacts, requirements and income tables.

1. Edit `data/catalog.json`.
2. Run `python3 -I tools/build_seed.py` (needs `pip install sqlparse`). This regenerates `sql/02_seed.sql` and checks it parses.
3. Run `node tools/test_engine.mjs` to check the five sample homeowners still match as expected.
4. Run `sql/02_seed.sql` in Supabase. Re-running is safe: it updates programs in place. It resets status, contacts and rules to the catalog's values but keeps your notes on the Programs page.

Day-to-day status changes (open, closed, waitlist, notes, last verified) don't need a re-seed; use the Programs page.

### Rule types

Each rule has a `rule_type`, a `rule_config` and a plain-English `description`. The description prints on the plan as "Why it may fit".

| rule_type | Checks | Example config |
| --- | --- | --- |
| `geographic_scope` | State, county FIPS, ZIP, or a yes/no flag such as inside I-465 | `{"scope_level": "county", "allowed_values": ["18097"]}` |
| `homeowner_status` | Any homeowner answer: age, veteran, Medicaid, urgency | `{"mode": "any", "checks": [{"field": "age_oldest_owner", "op": "gte", "value": 62}, {"field": "has_disability", "op": "is_true"}]}` |
| `property_attribute` | Same as above, for the home: taxes, insurance, home type | `{"mode": "all", "checks": [{"field": "taxes_current", "op": "is_true"}]}` |
| `income_threshold` | Household income against an income table | `{"lookup_table": "fpl_200_2026", "comparator": "lte", "categorical_fields": ["receives_ssi"]}` |
| `repair_type` | At least one of the homeowner's repairs is covered | `{"allowed": ["heating", "water_heater"]}` |
| `external_verification` | Always adds an "ask when you call" note | `{"message": "Needs a VA physician's prescription."}` |

A flag with `"soft": true` turns a mismatch into a question instead of a fail.

### Income tables loaded

| Table | Covers | Source |
| --- | --- | --- |
| `in_80ami_2026` | 80% of area median income, Marion, Hamilton and Hendricks (identical metro limits), effective June 1, 2026 | IHCDA RED Notice 26-17 (Marion also matches the City of Indianapolis repair page) |
| `in_50ami_2026`, `in_30ami_2026` | 50% and 30% of area median income, same three counties. Loaded ahead of need; no rule uses them yet | IHCDA RED Notice 26-17 |
| `fpl_150_2026`, `fpl_200_2026` | 150% and 200% of the 2026 poverty guidelines, statewide | Federal Register, January 2026 |
| `in_usda_very_low`, `in_usda_low` | Empty: USDA confirms income at intake | |

Other counties aren't loaded. Programs using that table show as "Worth a call" there, with income left for the program to confirm. HUD publishes new limits each spring (effective around June 1); update all three AMI tables (80%, 50%, 30%) and their `effective_date` from the same notice table when IHCDA issues it. To use a tier in a program, point its `income_threshold` rule at the table name.

## Homeowner form (fillable PDF)

`forms/EHS-IQ_Homeowner_Form.pdf` is a standalone fillable form for homeowners or family members: no links and no code. It opens in free Adobe Reader, Chrome and Edge, and prints for filling in by pen. The intake page has a **Blank form** button to download it and an **Import from PDF** button to read a completed copy back in.

- **Import:** the PDF is read in the browser and never uploaded. Answers fill the intake form on screen, and nothing is saved until you click Save.
- **Consent:** a ticked consent box on the form sets "How consent was given" to "Checked on the homeowner form (PDF)".
- **Any viewer:** Adobe Reader and Chrome format phone, date, ZIP and dollar boxes while typing. Mac Preview doesn't, and it also changes the choice buttons when it saves. The import reads the saved answers either way and tidies phone numbers, dates (10092026 becomes 10/09/2026) and amounts.
- **Address:** the form asks for street, city and ZIP separately. The import joins them, and the lookup always adds the city, IN and the ZIP when the street line lacks them, so a bare street name can't match another state.
- **Typed copies only:** handwritten or scanned copies can't be imported. A copy saved with "Print to PDF" has lost its answers, and the app says so.
- **How it links to the app:** each box is named after its intake field. `python3 -I tools/build_intake_pdf.py` rebuilds the PDF and stops if any name or choice no longer matches `intake.html`. Rebuild it whenever an intake question changes, and bump `FORM_ID` in both that script and `js/pdfImport.js` when field names change. The import warns about older copies.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `js/dashboard.js` | Client list, stale-program notice, delete |
| `intake.html`, `js/intake.js` | Intake form and results |
| `js/pdfImport.js` | Reads a completed homeowner form PDF in the browser (Import from PDF) |
| `forms/EHS-IQ_Homeowner_Form.pdf` | Fillable homeowner form (generated) |
| `plan.html`, `js/plan.js`, `css/plan.css` | Printed plan |
| `programs.html`, `js/programs.js` | Program status admin |
| `login.html`, `reset-password.html`, `js/authGuard.js` | Single-account sign-in |
| `js/engineCore.js` | Matching rules (no database calls; testable offline) |
| `js/matchingEngine.js` | Loads the catalog from Supabase and runs the matcher |
| `js/profiles.js` | Saves and loads client records |
| `js/geocode.js`, `js/census-block.js`, `js/cache.js` | Address lookup, copied from HomeAccessIQ |
| `sql/` | Schema, seed (generated), optional purge, agent setup |
| `data/catalog.json` | Program catalog source |
| `tools/` | Seed builder, homeowner form builder, offline engine test |

## Lessons carried over from HomeAccessIQ

- Script paths are absolute (`/js/...`), so they work from any page.
- The Supabase SDK `<script>` tag loads before any module that uses it, on every page.
- One sign-in system only.
- Generated SQL is parsed before it's handed over; no comment ever follows a comma.
- Check a table's name before querying it.
