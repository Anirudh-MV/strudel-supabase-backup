# Chrome Web Store listing

Copy-paste source for the listing at `chrome.google.com/webstore/devconsole`.
Field limits are from the store; the lengths below are already verified.

## Name

```
Strudel Session Sync
```

20 / 45 characters.

## Short description

```
Backs up your strudel.cc editor to your own Supabase project as versioned history, with one-click restore of any saved version.
```

127 / 132 characters. Same text as `manifest.json`'s `description`.

## Detailed description

```
Don't worry anymore about losing your strudel.cc sessions. Plug in your Supabase publishable key, create the necessary table on your supabase account and let the extension sync your sessions automatically, or trigger a manual sync.

Revisit your old sessions with the history view. 
```

~380 characters, well under the 16,000 limit. One trailing space was trimmed from
the end of the second paragraph.

## Category

Developer Tools

## Icon

`icons/icon128.png` — 128×128, opaque PNG.

## Screenshots

All at a size the store accepts, in `store/`:

| Order | File | Size |
|---|---|---|
| 1 | `store/01-settings-supabase-setup.png` | 1280×800 |
| 2 | `store/02-settings-form.png` | 1280×800 |
| 3 | `store/03-popup.png` | 640×400 |

None expose a project URL, key, or Backup ID — verified at native resolution
before publishing. The URL field shows its placeholder and the key is masked.

## Single purpose statement

Backs up the user's strudel.cc editor buffer to their own Supabase project as
versioned history, and restores any past version.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Saves the user's own Supabase URL, publishable key, Backup ID and autosave toggle. Never leaves the browser. |
| `https://strudel.cc/*` | The only site the extension acts on. |
| `https://*.supabase.co/*` | The user's own Supabase project. The subdomain is user-specific and unknown at build time, so it cannot be narrowed. |

`activeTab` was declared in early versions but is not used — the popup uses
`chrome.tabs.query`, `chrome.tabs.sendMessage` and `chrome.tabs.create`, none of
which require it, and `tab.url` is readable on strudel.cc via the host permission.
It was removed in 0.7.3, since the store rejects unnecessary permissions.

## Privacy practices

- **Do you collect or use user data?** No data is collected by the developer.
  No analytics, no telemetry, no third-party services.
- **What happens to user data?** Pattern data never reaches the developer. The
  extension sends it only to the **user's own Supabase project**, which they
  create and whose credentials they supply themselves through the Settings page.
- **Is data sold or shared with third parties?** No.
- **Does the extension collect data for purposes unrelated to its stated
  function?** No.

The publishable key is supplied by the user at install time, not bundled. The
project URL and key are stored in `chrome.storage.sync`, which is the user's own
browser profile — nothing is hardcoded in the extension.

## Before submitting

- Bump `version` in `manifest.json`; the store rejects a version it has already seen.
- No remotely hosted code, per MV3. All logic is local — don't add a CDN `<script>`
  or fetch executable code, or the listing is rejected.
- Re-check screenshots after any UI change.
