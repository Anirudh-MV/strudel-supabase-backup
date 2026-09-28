// Strudel Session Sync - content script (strudel.cc only, per manifest.json)
//
// URL-only backup. Strudel keeps the editor buffer in the URL fragment and rewrites
// it on every eval (deployed repl2.js):
//     afterEval: E => { ... window.location.hash = "#" + code2hash(code) ... }
// so location.href is a complete, self-contained record of what is on screen. This
// script never reads localStorage for strudel's own settings - it only stores its own
// bookkeeping keys there (sync timestamp, last error, agent version).
//
// Write rule: every distinct URL becomes its own row, so the table is a version
// history. A URL identical to the newest row for that session is skipped, which keeps
// polling, refocus and reloads from creating duplicates. Writes are insert-only -
// nothing is ever updated in place, so an old version stays exactly as it was saved.
// Autosave (Settings -> Autosave, on by default) fires on hashchange, poll, focus and
// visibilitychange; with it off, only the popup's Sync now button writes.
// Restore is URL-based: the session browser opens the link and strudel rehydrates the
// code through its own hash2code(). No localStorage is written or injected.
(function () {
  'use strict';

  const SYNC_TS_PREFIX = 'strudel-sync-ts-';
  const ERR_KEY = 'strudel-sync-last-error';
  const AGENT_KEY = 'strudel-sync-agent';
  const RESERVED = '__latest__';
  const DEFAULTS = { supabaseUrl: '', publishableKey: '', anonKey: '', userId: '', table: 'strudel_sessions', autosave: true };

  // Scope is fixed in manifest.json: content_scripts.matches is https://strudel.cc/*
  // and host_permissions grants strudel.cc plus *.supabase.co for the API. Chrome only
  // injects here, so there is nothing to configure at runtime.
  const HOST = 'strudel.cc';

  let lastSeen = null; // null => force the next tick to push
  const syncTsKey = (uid) => SYNC_TS_PREFIX + uid;
  const config = () => chrome.storage.sync.get(DEFAULTS);

  // Supabase issues `sb_publishable_...` keys; older projects hand out the legacy
  // `eyJ...` anon JWT. Both work as apikey + Bearer.
  const apiKeyOf = (cfg) => (cfg.publishableKey || cfg.anonKey || '').trim();
  const isConfigured = (cfg) => !!(cfg.supabaseUrl && apiKeyOf(cfg) && cfg.userId);

  const stampAgent = () => {
    try {
      localStorage.setItem(AGENT_KEY, chrome.runtime.getManifest().version);
    } catch { /* context invalidated */ }
  };

  const setLastError = (msg) => {
    try {
      if (msg) localStorage.setItem(ERR_KEY, msg);
      else localStorage.removeItem(ERR_KEY);
    } catch { /* diagnostics only */ }
  };

  // ---------- URL <-> code ----------
  // Mirrors strudel's code2hash/hash2code in packages/core/util.mjs:
  //   encodeURIComponent(base64(utf8(code)))
  function hash2code(hash) {
    const binary = atob(decodeURIComponent(hash));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // the editor buffer carried by a strudel URL, or null if the URL has no code fragment
  function codeFromUrl(url) {
    const h = String(url || '').split('#')[1];
    if (!h) return null;
    try {
      const code = hash2code(h);
      return code || null;
    } catch {
      return null; // a plain anchor link, not an encoded pattern
    }
  }

  // Port of strudel's getMetadata() (website/src/metadata_parser.js). Handles BOTH title
  // forms, because patterns in the wild use either:
  //   // "Morrow"                -> quoted title, must be the first comment
  //   /* @title acid ... */      -> @title tag, which is what strudel writes today
  // A title-only parser silently returned null for every @title pattern, collapsing them
  // all into the single __latest__ bucket.
  const ALLOW_MANY = ['by', 'url', 'genre', 'license', 'tag'];

  function getMetadata(rawCode) {
    const code = rawCode == null ? '' : rawCode;
    const commentRe = /\/\*([\s\S]*?)\*\/|\/\/(.*)$/gm;
    const comments = [...code.matchAll(commentRe)].map((c) => (c[1] || c[2] || '').trim());
    const tags = {};

    const first = (comments[0] || '').split('"');
    if (first[0].trim() === '' && first[1] !== undefined) {
      tags.title = first[1];
    }

    for (const comment of comments) {
      for (const match of comment.split('@').slice(1)) {
        const parts = match.split(/ (.*)/s);
        const tag = parts[0].trim();
        let value = (parts[1] || '').replace(/ +/g, ' ').trim();
        if (!tag) continue;
        if (ALLOW_MANY.includes(tag)) {
          const list = value
            .split(/[,\n]/)
            .map((t) => t.trim())
            .filter(Boolean);
          tags[tag] = tag in tags ? tags[tag].concat(list) : list;
        } else {
          value = value.replace(/\s+/g, ' ');
          tags[tag] = tag in tags ? `${tags[tag]} ${value}` : value;
        }
      }
    }
    return tags;
  }

  function extractTitle(code) {
    if (!code) return null;
    const title = getMetadata(code).title;
    return title && title.trim() ? title.trim() : null;
  }

  // The one row this tab contributes. Data is deliberately NULL: the URL is the record.
  function extractSession(url, userId) {
    const code = codeFromUrl(url);
    if (!code || !code.trim()) return null; // nothing evaluated yet
    return {
      session_name: extractTitle(code) || RESERVED,
      author: userId,
      url,
    };
  }

  // ---------- supabase REST ----------
  const base = (cfg) => `${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${cfg.table}`;

  async function api(cfg, method, path, body, prefer) {
    const key = apiKeyOf(cfg);
    const headers = { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(base(cfg) + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${method} ${path} -> ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }
    return prefer === 'return=representation' || method === 'GET' ? res.json() : null;
  }

  async function fetchLatest(cfg) {
    const rows = await api(
      cfg,
      'GET',
      `?author=eq.${encodeURIComponent(cfg.userId)}` +
        `&select=session_name,author,id,created_at,url&order=created_at.desc&limit=500`,
    );
    const map = new Map();
    for (const r of rows) {
      const key = `${r.session_name}\u0000${r.author}`;
      if (!map.has(key)) map.set(key, r); // ordered desc -> first hit is newest
    }
    return map;
  }

  // Every distinct URL becomes its own row, so the table is a version history rather
  // than a latest-value snapshot. Identical consecutive URLs are skipped, which keeps
  // polling, refocus and page reloads from creating duplicate versions.
  async function pushSession(cfg, session) {
    const latest = await fetchLatest(cfg);
    const key = `${session.session_name}\u0000${session.author}`;
    const prev = latest.get(key);
    const now = Date.now();
    const ts = new Date(now).toISOString();

    if (prev && prev.url === session.url) return { inserts: 0, patches: 0, skipped: 1 };

    const inserted = await api(
      cfg,
      'POST',
      '',
      {
        session_name: session.session_name,
        author: session.author,
        url: session.url,
        created_at: ts,
        updated_at: ts,
      },
      'return=representation&columns=id,created_at',
    );
    localStorage.setItem(syncTsKey(cfg.userId), String(now));
    return {
      inserts: 1,
      patches: 0,
      skipped: 0,
      id: (Array.isArray(inserted) ? inserted[0] : {}).id,
    };
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // `force` is for the explicit Sync now button, which works even with autosave off.
  async function doPushNow(cfg, force) {
    if (!isConfigured(cfg)) return { inserts: 0, patches: 0, skipped: 0 };
    const url = location.href;
    if (url === lastSeen && !force) return null;
    lastSeen = url;
    const session = extractSession(url, cfg.userId);
    if (!session) return { inserts: 0, patches: 0, skipped: 0, empty: true };
    return pushSession(cfg, session);
  }

  async function start() {
    stampAgent();
    const cfg = await config();
    if (!isConfigured(cfg)) return; // options page explains the rest

    const doPush = debounce(async () => {
      try {
        const c = await config();
        if (!isConfigured(c)) return;
        if (!c.autosave) return; // autosave off: only the explicit Sync now button writes
        const r = await doPushNow(c, false);
        if (r) {
          setLastError('');
          console.log('[StrudelSync] autosave', r);
        }
      } catch (e) {
        console.warn('[StrudelSync] push failed', e);
        setLastError(`push: ${e.message}`);
      }
    }, 2000);

    // strudel assigns location.hash on every eval, which fires hashchange; the poll
    // also covers programmatic navigations and tab restores
    window.addEventListener('hashchange', doPush);
    document.addEventListener('visibilitychange', doPush);
    window.addEventListener('focus', doPush);
    setInterval(doPush, 10000);
    doPush(); // capture the buffer already on screen when the tab opened

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'syncNow') {
        (async () => {
          try {
            const c = await config();
            if (!isConfigured(c)) {
              setLastError('not configured');
              sendResponse({ ok: false, error: 'not configured - open extension options' });
              return;
            }
            lastSeen = null; // explicit request: push even if the URL looks unchanged
            const r = (await doPushNow(c, true)) || { inserts: 0, patches: 0, skipped: 0 };
            setLastError('');
            sendResponse({ ok: true, autosave: !!c.autosave, ...r });
          } catch (e) {
            setLastError(`sync: ${e.message}`);
            sendResponse({ ok: false, error: e.message });
          }
        })();
        return true;
      }

      if (msg && msg.type === 'openSession') {
        // Restore = open the stored link. Strudel rehydrates the code from the fragment.
        (async () => {
          const c = await config();
          if (!c.supabaseUrl || !apiKeyOf(c)) {
            sendResponse({ ok: false, error: 'not configured' });
            return;
          }
          try {
            const rows = await api(
              c,
              'GET',
              `?id=eq.${Number(msg.id)}&select=id,url&limit=1`,
            );
            if (!rows.length || !rows[0].url) {
              sendResponse({ ok: false, error: 'that row has no stored URL' });
              return;
            }
            await chrome.tabs.create({ url: rows[0].url });
            sendResponse({ ok: true, url: rows[0].url });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
        })();
        return true;
      }

      if (msg && msg.type === 'getStatus') {
        (async () => {
          const c = await config();
          const last = localStorage.getItem(syncTsKey(c.userId));
          const url = location.href;
          const code = codeFromUrl(url);
          sendResponse({
            configured: isConfigured(c),
            autosave: !!c.autosave,
            lastSync: last ? new Date(Number(last)).toLocaleString() : null,
            lastError: localStorage.getItem(ERR_KEY) || null,
            sessions: code && code.trim() ? 1 : 0,
            agentVersion: localStorage.getItem(AGENT_KEY),
            diagnostics: {
              origin: location.origin,
              host: location.hostname,
              inScope: location.hostname === HOST || location.hostname.endsWith(`.${HOST}`),
              url: url.slice(0, 100),
              hasCodeFragment: !!code,
              codeBytes: code ? code.length : 0,
              title: code ? extractTitle(code) : null,
              why: !code
                ? 'no code fragment in the URL yet - press Ctrl+Enter in strudel to evaluate, then the URL carries your pattern'
                : null,
            },
          });
        })();
        return true;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
