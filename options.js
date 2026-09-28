(() => {
  'use strict';
  const DEFAULTS = { supabaseUrl: '', publishableKey: '', anonKey: '', userId: '', table: 'strudel_sessions', autosave: true };
  const $ = (id) => document.getElementById(id);

  // accept sb_publishable_… (current) and the legacy eyJ… anon JWT
  const looksLikePublicKey = (k) => /^sb_publishable_/.test(k) || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(k);

  const status = (text, cls) => {
    const el = $('status');
    el.className = cls || '';
    el.textContent = text;
  };

  const readForm = () => ({
    supabaseUrl: $('url').value.trim().replace(/\/+$/, ''),
    publishableKey: $('key').value.trim(),
    userId: $('uid').value.trim(),
    table: $('table').value.trim() || 'strudel_sessions',
    autosave: $('autosave').checked,
  });

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    $('url').value = cfg.supabaseUrl;
    $('key').value = cfg.publishableKey || cfg.anonKey; // migrate legacy anon key
    $('uid').value = cfg.userId;
    $('table').value = cfg.table;
    $('autosave').checked = cfg.autosave !== false; // default on
  });

  function validate(cfg) {
    if (!cfg.supabaseUrl || !cfg.publishableKey || !cfg.userId) {
      return 'Project URL, publishable key and backup ID are all required.';
    }
    if (!/^https?:\/\/[^/]+\.supabase\.(co|in)/.test(cfg.supabaseUrl)) {
      return 'Project URL should look like https://YOURPROJECT.supabase.co';
    }
    if (/^sb_secret_/.test(cfg.publishableKey)) {
      return 'That is the secret (service role) key — it grants full database access. Use the publishable key instead.';
    }
    if (!looksLikePublicKey(cfg.publishableKey)) {
      return 'Key should start with sb_publishable_… (or be the legacy eyJ… anon key).';
    }
    return null;
  }

  $('save').addEventListener('click', async () => {
    const cfg = readForm();
    const invalid = validate(cfg);
    if (invalid) return status(invalid, 'err');
    // write only the new field; leave any legacy anonKey for other installs to migrate
    await chrome.storage.sync.set(cfg);
    status(
      `Saved. Autosave is ${cfg.autosave ? 'on' : 'off'}. ` +
        'Open strudel.cc in a tab (reload it if it was already open) to start syncing.',
      'ok',
    );
  });

  $('test').addEventListener('click', async () => {
    const cfg = readForm();
    const invalid = validate(cfg);
    if (invalid) return status(invalid, 'err');
    status('Testing…');
    const key = cfg.publishableKey;
    const base = `${cfg.supabaseUrl}/rest/v1/${cfg.table}`;
    try {
      // select=id only, so the check works whether or not the url column exists yet
      const res = await fetch(`${base}?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
      });
      if (res.status === 404) {
        return status(
          `Table "${cfg.table}" not found (404). Run the setup SQL from this page in your Supabase SQL editor.`,
          'err',
        );
      }
      if (res.status === 401 || res.status === 403) {
        return status(
          `HTTP ${res.status} — key rejected or blocked by RLS. Check the publishable key and that the "anon all on ${cfg.table}" policy exists.`,
          'err',
        );
      }
      if (!res.ok) return status(`HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 200)}`, 'err');
      const range = res.headers.get('content-range') || '';
      const total = range.includes('/') ? range.split('/')[1] : '?';
      status(`Connected ✓ — ${total === '?' ? 'readable' : `${total} row(s) in ${cfg.table}`}. Reads work, so the key and RLS are fine.`, 'ok');
    } catch (e) {
      status(`Request failed: ${e.message} — check the project URL and your network.`, 'err');
    }
  });
})();
