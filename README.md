# Strudel Session Sync

Chrome extension (Manifest V3) that backs up your strudel.cc sessions to **your own
Supabase project** as versioned history, merges them back on any machine, and shows
a paginated "latest sessions" browser inside the extension.

## What gets stored (per session, separate attributes)

Each saved pattern in strudel's localStorage (`strudel-settings` → `userPatterns`) becomes
a row with:

| column        | source                                             |
|---------------|----------------------------------------------------|
| `session_name`| `// "Title"` comment at the top of the code, else the pattern id |
| `author`      | `// @author Name` comment, else your Backup ID     |
| `pattern_id`  | the strudel pattern id (used to restore in place)  |
| `data`        | the full pattern code                              |
| `created_at` / `updated_at` | server write timestamps               |

Extraction mirrors strudel's own `metadata_parser.js`. Editing your current code is also
backed up as a row named `__latest__` (author = your Backup ID), so unsaved work survives.

## Write rule: insert history, 5-minute refresh window

- **INSERT** a new row per session on every sync (you keep full history/versions).
- **EXCEPT**: if the latest row for that `(session_name, author)` was written **less than
  5 minutes ago** (its `created_at`), that row is **UPDATED** in place instead of inserting
  a duplicate — so the 2 s debounce / 10 s polling of one editing session don't spam rows.
- After 5 minutes of silence, the next save starts a fresh history row.

## Restore

On page load the content script fetches the latest row per `(session_name, author)` for your
Backup ID and merges: patterns the browser doesn't have are added, patterns whose server
`updated_at` is newer than their local `created_at` are overwritten, then the page reloads
once. Last-write-wins per session.

## Session browser

Extension popup → **View latest sessions** opens a page listing the latest row per session
name (via a SQL view), sorted by `updated_at` desc, **10 rows per page** with prev/next
pagination and a total count. Click a row to expand the full code; "Copy code" to paste it
back into strudel.

## Run it locally

1. `chrome://extensions` → Developer mode → **Load unpacked** → select this folder.
2. Run the SQL from the options page (or below) in your Supabase SQL editor.
3. Extension icon → **Configure Supabase…** → Project URL, anon key, Backup ID → Save.
4. Open strudel.cc, save a pattern, check the row appears in `strudel_sessions` (try again
   within 5 min → same row updated; after 5 min → new row = history).
5. Install on machine 2 with the same Backup ID → sessions restore on load; popup →
   **View latest sessions** shows them paginated.

### Supabase SQL (run once)

```sql
create table if not exists public.strudel_sessions (
  id bigint generated always as identity primary key,
  session_name text not null,
  author text not null,
  pattern_id text,
  data text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strudel_sessions_lookup
  on public.strudel_sessions (session_name, author, created_at desc);

alter table public.strudel_sessions enable row level security;

create policy "anon all on strudel_sessions"
  on public.strudel_sessions for all
  to anon using (true) with check (true);

create or replace view public.latest_strudel_sessions as
select distinct on (session_name, author) *
from public.strudel_sessions
order by session_name, author, created_at desc;
```

> ⚠️ Anon key is a public key that ships inside the extension. RLS is scoped to this single
> table; don't reuse the project for other sensitive data.
>
> v0.1 used a single-row `strudel_backup` table — obsolete; drop it if you never created it.

## Publishing to the Chrome Web Store

1. `python3 -m zipfile -c ../strudel-session-sync.zip .` from this folder (or zip CLI).
2. Register a developer account (one-time US$5) at the Chrome Web Store dev console.
3. Upload, fill the listing (name, description, screenshots, privacy: "no data collected" —
   data flows only from the user's browser to the user's own Supabase project), add a
   privacy-policy URL (GitHub Pages / Google Doc).
4. Submit; first review usually takes a few days.

Notes: no analytics, no remote code; per-user keys in `chrome.storage.sync`. Politeness:
the Strudel community prefers projects not reuse the plain "strudel" name — consider
"Session Sync for Strudel.cc" as the store name.

## Files

```
manifest.json   MV3 manifest (content script, options, popup, sessions, icons)
content.js      sync engine: metadata extraction, insert-with-history (5-min window), restore
sessions.html/js paginated latest-sessions browser (10 rows/page)
options.html/js Supabase config (URL, anon key, backup ID, table) + setup SQL
popup.html/js   status + Sync now + View sessions + Configure
icons/          generated icons (16/48/128)
gen_icons.py    regenerate icons (stdlib only, python3 gen_icons.py)
```