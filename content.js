// Strudel Session Sync - content script (runs only on strudel.cc / warm.strudel.cc)
// Mirrors each saved session (localStorage 'strudel-settings' -> userPatterns) to the
// user's own Supabase project as VERSIONED rows keyed by session_name + author.
//
// Write rule: INSERT always (history), except when the latest row for that
// (session_name, author) was written less than 5 minutes ago -> then UPDATE it in place.
// Restore: on load, merge the newest server row per (session_name, author) into the page.
(function () {
  'use strict';

  const KEY = 'strudel-settings'; // verified: persistentMap('strudel-settings', ...) in settings.mjs
  const SYNC_TS_PREFIX = 'strudel-sync-ts-';
  const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const DEFAULTS = { supabaseUrl: '', anonKey: '', userId: '', table: 'strudel_sessions' };

  let lastSeen = localStorage.getItem(KEY) || '';
  const syncTsKey = (uid) => SYNC_TS_PREFIX + uid;
  const config = () => chrome.storage.sync.get(DEFAULTS);

  // ---------- metadata extraction (same semantics as strudel's metadata_parser.js) ----------
  // // "My Session Name"        -> title (first comment line, quoted)
  // // @author Somebody         -> author tag
  function extractMetadata(code) {
    const meta = { title: null, author: null };
    if (!code) return meta;
    const commentRe = /\/\*([\s\S]*?)\*\/|\/\/(.*)$/gm;
    const comments = [...code.matchAll(commentRe)].map((c) => (c[1] || c[2] || '').trim());
    if (comments.length) {
      const [prefix, title] = comments[0].split('"');
      if (prefix.trim() === '' && title !== undefined) meta.title = title.trim();
      for (const comment of comments) {
        for (const tagMatch of comment.split('@').slice(1)) {
          const [tag, value] = tagMatch.split(/ (.*)/s);
          const v = (value || '').replaceAll(/\s+/g, ' ').trim();
          if (tag.trim() === 'author' && v) meta.author = v;
        }
      }
    }
    return meta;
  }

  // ---------- turn the settings blob into per-session rows ----------
  function extractSessions(settingsJson, userId) {
    const out = [];
    let settings;
    try { settings = JSON.parse(settingsJson); } catch { return out; }
    let patterns = {};
    try { patterns = JSON.parse(settings.userPatterns || '{}'); } catch { patterns = {}; }
    for (const [id, p] of Object.entries(patterns)) {
      const code = (p && p.code) || '';
      if (!code.trim()) continue; // skip brand-new empty sessions
      const meta = extractMetadata(code);
      out.push({
        session_name: meta.title || id,   // title comment, else the pattern id
        author: meta.author || userId,    // @author comment, else the configured backup id
        pattern_id: id,
        data: code,
      });
    }
    const latest = settings.latestCode || '';
    if (latest.trim()) {
      // current editor content (unsaved work) - reserved name, author = backup id
      out.push({ session_name: '__latest__', author: userId, pattern_id: null, data: latest });
    }
    return out;
  }

  // ---------- supabase REST ----------
  const base = (cfg) => `${cfg.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${cfg.table}`;

  async function api(cfg, method, path, body) {
    const headers = {
      'Content-Type': 'application/json',
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    };
    if (method === 'POST' || method === 'PATCH') headers.Prefer = 'return=minimal';
    const res = await fetch(base(cfg) + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return method === 'GET' ? res.json() : null;
  }

  // latest row per (session_name, author) for this author, via the SQL view
  async function fetchLatest(cfg) {
    const rows = await api(
      cfg,
      'GET',
      `?author=eq.${encodeURIComponent(cfg.userId)}&select=session_name,author,pattern_id,id,created_at&order=created_at.desc`,
    );
    const map = new Map();
    for (const r of rows) map.set(`${r.session_name}\u0000${r.author}`, r);
    return map;
  }

  async function pushSessions(cfg, sessions) {
    const latest = await fetchLatest(cfg);
    const now = Date.now();
    let inserts = 0;
    let patches = 0;
    for (const s of sessions) {
      const prev = latest.get(`${s.session_name}\u0000${s.author}`);
      const ts = new Date(now).toISOString();
      if (prev && now - Date.parse(prev.created_at) < REFRESH_WINDOW_MS) {
        await api(cfg, 'PATCH', `?id=eq.${prev.id}`, { data: s.data, updated_at: ts });
        patches++;
      } else {
        await api(cfg, 'POST', '', {
          session_name: s.session_name,
          author: s.author,
          pattern_id: s.pattern_id ?? null,
          data: s.data,
          created_at: ts,
          updated_at: ts,
        });
        inserts++;
      }
      latest.set(`${s.session_name}\u0000${s.author}`, { ...prev, id: s.id, created_at: ts }); // keep window logic consistent within this run
    }
    localStorage.setItem(syncTsKey(cfg.userId), String(now));
    return { inserts, patches };
  }

  async function restore(cfg) {
    const rows = await api(
      cfg,
      'GET',
      `?author=eq.${encodeURIComponent(cfg.userId)}&select=session_name,author,pattern_id,data,updated_at&order=updated_at.desc`,
    );
    if (!rows.length) return false;
    const raw = localStorage.getItem(KEY);
    let settings = {};
    try { settings = JSON.parse(raw || '{}'); } catch { settings = {}; }
    let patterns = {};
    try { patterns = JSON.parse(settings.userPatterns || '{}'); } catch { patterns = {}; }

    let touched = false;
    let maxTs = 0;
    for (const r of rows) {
      const t = Date.parse(r.updated_at) || 0;
      if (t > maxTs) maxTs = t;
      if (r.pattern_id) {
        const local = patterns[r.pattern_id];
        const localCreated = local ? Number(local.created_at) || 0 : 0;
        if (!local || t > localCreated) {
          patterns[r.pattern_id] = { id: r.pattern_id, code: r.data, created_at: t, collection: 'user' };
          touched = true;
        }
      } else if (r.session_name === '__latest__' && r.data !== (settings.latestCode || '')) {
        settings.latestCode = r.data;
        touched = true;
      }
    }
    if (touched) {
      const next = JSON.stringify({ ...settings, userPatterns: JSON.stringify(patterns) });
      if (next !== raw) {
        localStorage.setItem(KEY, next);
        localStorage.setItem(syncTsKey(cfg.userId), String(maxTs));
        console.log('[StrudelSync] restored sessions from server, reloading');
        location.reload();
        return true;
      }
    }
    if (maxTs) localStorage.setItem(syncTsKey(cfg.userId), String(maxTs));
    return touched;
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  async function start() {
    const cfg = await config();
    if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.userId) return;

    restore(cfg).catch((e) => console.warn('[StrudelSync] restore failed', e));

    const doPush = debounce(async () => {
      const now = localStorage.getItem(KEY) || '';
      if (now !== lastSeen) {
        lastSeen = now;
        const sessions = extractSessions(now, cfg.userId);
        if (sessions.length) pushSessions(cfg, sessions).catch((e) => console.warn('[StrudelSync] push failed', e));
      }
    }, 2000);

    // same-tab localStorage writes don't fire 'storage' events -> poll
    setInterval(doPush, 10000);
    document.addEventListener('visibilitychange', doPush);
    window.addEventListener('focus', doPush);

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'syncNow') {
        (async () => {
          const c = await config();
          if (!c.supabaseUrl || !c.anonKey || !c.userId) {
            sendResponse({ ok: false, error: 'not configured - open extension options' });
            return;
          }
          const sessions = extractSessions(localStorage.getItem(KEY) || '', c.userId);
          let r = { ok: true, inserts: 0, patches: 0 };
          if (sessions.length) r = { ok: true, ...(await pushSessions(c, sessions)) };
          await restore(c).catch(() => {});
          sendResponse(r);
        })();
        return true;
      }
      if (msg && msg.type === 'getStatus') {
        (async () => {
          const c = await config();
          const last = localStorage.getItem(syncTsKey(c.userId));
          sendResponse({
            configured: !!(c.supabaseUrl && c.anonKey && c.userId),
            lastSync: last ? new Date(Number(last)).toLocaleString() : null,
          });
        })();
        return true;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();