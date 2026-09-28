# Strudel Session Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Chrome extension (Manifest V3) that backs up your strudel.cc sessions to **your own
Supabase project** as versioned history, merges them back on any machine, and shows
a paginated "latest sessions" browser inside the extension.

## What gets stored

**The URL, and nothing else.** Strudel keeps the editor buffer in the URL fragment and
rewrites it on every eval — from the deployed `repl2.js`:

```js
afterEval: E => { const { code } = E; ...
  window.location.hash = "#" + code2hash(code) ... }
```

So `location.href` is a complete, self-contained record of what is on screen. The extension
reads no strudel localStorage at all; it stores only its own bookkeeping keys
(`strudel-sync-ts-*`, `strudel-sync-last-error`, `strudel-sync-agent`).

| column        | source                                             |
|---------------|----------------------------------------------------|
| `session_name`| `title` from strudel's `getMetadata()`, else `__latest__` |
| `author`      | **always your Backup ID** (the row owner — every read path filters on it) |
| `data`        | always NULL                                        |
| `url`         | `location.href`                                    |
| `created_at` / `updated_at` | server write timestamps               |

Restore is URL-based too: **Restore in strudel** opens the stored link and strudel rehydrates
the code through its own `hash2code()`. Nothing is written to localStorage, so restoring onto
a machine that has never seen the pattern works.

The session browser decodes each fragment on demand to show a preview and offer **Copy code**,
so the display is code-complete even though the code is never stored twice.

### What URL-only cannot cover

Strudel's *saved* pattern collection (`userPatterns`) has no URL form — opening a saved
pattern leaves the URL at plain `strudel.cc` and keeps the id in per-tab `sessionStorage`. Only
what is in the editor at the moment of evaluation is captured. To seed a machine with older
saved patterns, import them in strudel itself (the Patterns tab accepts a JSON file), then
evaluate once so a URL exists.

## Versions and autosave

Every distinct URL is stored as its own row, so the table is a version history rather than a
latest-value snapshot. Writes are **insert-only** — nothing is updated in place, so a version
recorded an hour ago is byte-for-byte what you saved then.

The one exception is dedupe: a URL identical to the newest row for that session is skipped, so
polling, refocusing the tab and reloading strudel.cc don't manufacture duplicate versions.

**Autosave** (Settings, on by default) fires on `hashchange`, a 10 s poll, `focus`, and
`visibilitychange` — so every new URL strudel generates is saved without touching a button.
Turn it off and the only thing that writes is the popup's **Sync now**, which works either
way. The popup status line always shows `autosave: on` / `autosave: OFF` so the current mode
is never ambiguous, and a manual sync while autosave is off appends `· autosave off`.

## Session browser

Popup → **View latest sessions** groups rows by `session_name` and expands each into its
version list: newest first, labelled `latest` / `v2`, `v3`, … with the save time and a decoded
first line. Each version has **Restore** (open the link; strudel rehydrates the code) and
**Copy**. Pagination is by session, 10 per page, with a running count of both sessions and
versions. Rows are fetched up to a 1000-row cap and grouped in the page, which the footer flags
as `cap reached` if you ever hit it.

> A pattern's own `// @author …` comment no longer sets the row's `author` column — it stays
> inside the stored code instead. Using it there made those rows invisible to the fetch,
> restore and session-browser paths (all filter `author = your Backup ID`), so they were
> never deduped, never restored, and appeared as strangers in the browser.

## Scope

Fixed in `manifest.json`, not configurable:

```json
"host_permissions": ["https://strudel.cc/*", "https://*.supabase.co/*"],
"content_scripts": [{ "matches": ["https://strudel.cc/*"], ... }]
```

`strudel.cc` is the only host the content script is injected on, so there is no
runtime allow-list to keep in sync. The `*.supabase.co` grant is required for the API
and has to stay wildcarded because the project ref is user-specific. Diagnose prints
`in scope:` so a stray host is visible rather than silent.

To widen this later, edit `matches` and reload the extension — Chrome only injects into
hosts listed there, so nothing in Settings can add one at runtime.

## Troubleshooting "it isn't saving"

Work top-down; each step rules out a layer.

1. **Popup → Diagnose.** Prints the extension version vs the version running in the tab, whether
   the URL has a code fragment, its decoded size, the decoded `// "Title"`, and a `why:` line.
2. **Popup status line.** Shows the last sync plus `⚠ <error>` when the last push failed — the
   reason is stored in `strudel-sync-last-error` in strudel.cc's localStorage.
3. **Options → Test connection.** A live read that distinguishes 404 (table/SQL not set up) from
   401/403 (key or RLS policy).

The most common cause is simply that the URL has no code fragment yet: strudel only writes
`location.hash` on eval, so a freshly opened tab with nothing evaluated backs up nothing.
Press Ctrl+Enter in the editor, then sync.

### Title parsing

`session_name` comes from a port of strudel's own `getMetadata()`
(`website/src/metadata_parser.js`), verified to produce byte-identical output against the
real implementation across both title forms:

```js
// "Morrow"                     -> Morrow      (quoted, must be the first comment)
/* @title acid ... */           -> acid        (@title tag — what strudel writes today)
/* @title   get arpegged
   @by      JO  */              -> get arpegged  (whitespace collapsed)
```

Patterns with no title land in the reserved `__latest__` bucket. An earlier version only
handled the quoted form, so every `@title` pattern collapsed into `__latest__` and versions
of unrelated pieces shared one history. Diagnose prints the parsed `title:`.

### History note: why the localStorage reader was removed

v0.1–0.4.x read strudel's settings out of localStorage to back up the saved pattern
collection. Two things made that unreliable:

- **The layout changed.** The deployed app stopped keeping one `strudel-settings` JSON blob and
  started writing one key per setting (`strudel-settingsuserPatterns`,
  `strudel-settingslatestCode`, …). Readers pinned to the blob key found nothing and reported
  `0 sessions` while the patterns sat a few keys away.
- **The saved collection is not reachable by URL anyway**, and the editor buffer — the thing
  actually at risk — already is, because strudel rewrites the hash on every eval.

v0.5 drops the localStorage reader entirely in favour of the URL.

### "Extension context invalidated"

Reloading an unpacked extension kills the `chrome.*` handles held by content scripts already
injected into open tabs, so the old script starts throwing `Extension context invalidated` and
stops syncing. **Reload the strudel.cc tab** (Cmd+Shift+R) after every extension reload. The
content script stamps `strudel-sync-agent` in localStorage with the version running in the tab;
Diagnose prints `tab agent:` versus `extension:` and flags `STALE` when they differ, so you
don't have to read the console.

### Distinguishing a zero from a failure

`0 new versions, 1 unchanged` with a healthy connection means the URL hasn't changed since
the last save — a localStorage read problem, not a network one. Contrast with `⚠ POST … -> 401`,
which is auth/RLS. `strudel-sync-ts-<backup id>` appearing in localStorage is the marker that a
push ran to completion; if it's absent, the push never started. If autosave is off, nothing
writes at all until you press **Sync now** — check the `autosave:` line in the popup.

## Restore

Restore is URL-based. In the session browser, any version's **Restore** button opens that
stored link in a new tab, and strudel rehydrates the code from the URL fragment via its own
`hash2code()`. Nothing is written to localStorage, so restoring onto a machine that has never
seen the pattern works. The **Copy** button puts the decoded code on the clipboard for pasting
back into the editor.

## Run it locally

1. `chrome://extensions` → Developer mode → **Load unpacked** → select this folder.
2. Run the SQL from the settings page (or below) in your Supabase SQL editor.
3. Extension icon → **Settings** → Project URL, **publishable key**, Backup ID, Autosave →
   Save, then **Test connection** (should report the row count).
4. Open strudel.cc and press **Ctrl+Enter** to evaluate — that is what writes the URL
   fragment, and therefore what triggers the first autosave. Edit and re-evaluate to create
   a second version; both appear in the session browser.
5. Install on machine 2 with the same Backup ID → open **View latest sessions** and hit
   **Restore** on any version.

### Supabase SQL (run once)

Fresh setup — **drops and recreates everything, deleting all backed-up sessions.** One table,
six columns. Run it in the Supabase SQL editor, then reload the extension.

```sql
-- Strudel Session Sync - fresh setup.
-- Drops any previous table/view, then creates the single table this
-- extension needs. Each row is one saved version: the strudel share
-- URL, with the code inside the URL fragment.
-- Order matters: an older version's view depends on the table, so
-- the view has to go first or the table drop fails with 2BP01.

drop view if exists public.latest_strudel_sessions;
drop table if exists public.strudel_sessions;

create table public.strudel_sessions (
  id bigint generated always as identity primary key,
  session_name text not null,   -- strudel metadata title, else __latest__
  author text not null,         -- your Backup ID; every read filters on this
  url text not null,            -- the strudel link; code lives in the fragment
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index strudel_sessions_author_created
  on public.strudel_sessions (author, created_at desc);

alter table public.strudel_sessions enable row level security;

create policy "anon all on strudel_sessions"
  on public.strudel_sessions for all
  to anon using (true) with check (true);
```

> ⚠️ The publishable key (`sb_publishable_…`, or the legacy `eyJ…` anon key) is a public key
> that ships inside the extension. It authenticates as the `anon` role, so the
> `"anon all on strudel_sessions"` policy above is what actually gates access. RLS is scoped
> to this single table; don't reuse the project for other sensitive data, and never put the
> `sb_secret_…` (service role) key in the extension.
>
> Earlier versions used a `strudel_backup` table, a `latest_strudel_sessions` view, and
> `data`/`pattern_id` columns. The script above drops the view and the table. If you created
> the v0.1 `strudel_backup` table, remove it by hand:
> `drop table if exists public.strudel_backup;`

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
sessions.html/js version browser: sessions grouped by name, expandable version
                history with per-version restore and copy
options.html/js Settings: Supabase config (URL, publishable key, backup ID, table),
                a Test connection button, and the setup SQL
popup.html/js   status + Sync now + View sessions + Configure
icons/          generated icons (16/48/128)
gen_icons.py    regenerate icons (stdlib only, python3 gen_icons.py)
```