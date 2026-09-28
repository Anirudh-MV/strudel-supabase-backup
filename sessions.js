(() => {
  'use strict';
  const PAGE = 10; // sessions per page
  const MAX_ROWS = 1000; // hard cap on rows fetched, grouped client-side into versions
  const DEFAULTS = { supabaseUrl: '', publishableKey: '', anonKey: '', userId: '', table: 'strudel_sessions' };
  const $ = (id) => document.getElementById(id);
  const msg = (text, err) => {
    $('msg').textContent = text;
    $('msg').className = err ? 'err' : 'muted';
  };
  let state = { page: 0, total: null, cfg: null, groups: [] };

  async function fetchRows() {
    const { supabaseUrl, table, userId } = state.cfg;
    const key = state.cfg.publishableKey || state.cfg.anonKey;
    const base = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}`;
    const path =
      `?select=id,session_name,author,url,created_at` +
      `&author=eq.${encodeURIComponent(userId)}` +
      `&order=created_at.desc&limit=${MAX_ROWS}`;
    const res = await fetch(base + path, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${detail ? ` ${detail.slice(0, 160)}` : ''}`);
    }
    return res.json();
  }

  // One entry per session_name, holding every version newest-first. Rows arrive ordered
  // created_at desc, so the first time we see a name is its newest version.
  function groupBySession(rows) {
    const byName = new Map();
    for (const r of rows) {
      const name = r.session_name || '(untitled)';
      if (!byName.has(name)) {
        byName.set(name, { name, author: r.author, versions: [] });
      }
      byName.get(name).versions.push(r);
    }
    return [...byName.values()].sort(
      (a, b) => Date.parse(b.versions[0].created_at) - Date.parse(a.versions[0].created_at),
    );
  }

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(t).toLocaleString();
  }

  // Only the URL is stored, so decode the fragment for display - the same transform as
  // strudel's hash2code().
  function codeFromUrl(url) {
    const h = String(url || '').split('#')[1];
    if (!h) return null;
    try {
      const binary = atob(decodeURIComponent(h));
      return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }

  function firstMeaningfulLine(code) {
    if (!code) return '(no code fragment)';
    return code.split('\n').find((l) => l.trim()) || '(blank)';
  }

  function openUrl(url) {
    // restore = reopen the link; strudel rehydrates the code from the fragment
    chrome.tabs.create({ url });
  }

  function versionRow(v, index) {
    const tr = document.createElement('tr');
    tr.className = 'version';
    const code = codeFromUrl(v.url) || '';
    const label = index === 0 ? 'latest' : `v${v.versionsFromTop}`;
    tr.innerHTML =
      `<td class="vlabel">${escapeHtml(label)}</td>` +
      `<td class="vtime">${escapeHtml(relTime(v.created_at))}<span class="muted"> ${escapeHtml(
        new Date(v.created_at).toLocaleString(),
      )}</span></td>` +
      `<td class="vsnip">${escapeHtml(firstMeaningfulLine(code).slice(0, 70))}</td>` +
      `<td class="vact">` +
      `<button class="restore">Restore</button>` +
      `<button class="copy">Copy</button>` +
      `</td>`;
    tr.querySelector('.restore').addEventListener('click', (e) => {
      e.stopPropagation();
      openUrl(v.url);
    });
    tr.querySelector('.copy').addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = code || '';
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Copied ✓';
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        e.target.textContent = 'Copied ✓';
      }
      setTimeout(() => (e.target.textContent = 'Copy'), 1500);
    });
    return tr;
  }

  function render(groups) {
    const tbody = $('rows');
    tbody.innerHTML = '';
    if (!groups.length) {
      tbody.innerHTML =
        '<tr><td class="muted">No sessions yet — evaluate something on strudel.cc (Ctrl+Enter) so the URL carries your pattern, then sync.</td></tr>';
      return;
    }
    const page = groups.slice(state.page * PAGE, state.page * PAGE + PAGE);
    for (const g of page) {
      const newest = g.versions[0];
      // number versions newest-first so each row can show v1, v2, ...
      g.versions.forEach((v, i) => (v.versionsFromTop = i + 1));

      const head = document.createElement('tr');
      head.className = 'row';
      const code = codeFromUrl(newest.url) || '';
      head.innerHTML =
        `<td><div class="name">${escapeHtml(g.name)}</div>` +
        `<div class="muted">${escapeHtml(g.author || '')} · ${escapeHtml(relTime(newest.created_at))}</div></td>` +
        `<td class="snippet">${escapeHtml(firstMeaningfulLine(code).slice(0, 80))}</td>` +
        `<td class="count">${g.versions.length} version${g.versions.length === 1 ? '' : 's'}</td>`;
      head.addEventListener('click', () => {
        detail.hidden = !detail.hidden;
      });

      const detail = document.createElement('tr');
      detail.hidden = true;
      detail.className = 'expanded';
      const cell = document.createElement('td');
      cell.colSpan = 4;
      const list = document.createElement('table');
      list.className = 'versions';
      list.innerHTML =
        '<thead><tr><th>version</th><th>saved</th><th>first line</th><th></th></tr></thead>';
      const tbodyVersions = document.createElement('tbody');
      for (const v of g.versions) tbodyVersions.appendChild(versionRow(v, 0));
      list.appendChild(tbodyVersions);
      cell.appendChild(list);

      const link = document.createElement('a');
      link.className = 'link';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.href = newest.url;
      link.textContent = newest.url.length > 90 ? `${newest.url.slice(0, 90)}…` : newest.url;
      cell.appendChild(link);
      detail.appendChild(cell);

      tbody.append(head, detail);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  async function load() {
    if (!state.cfg) return;
    try {
      const rows = await fetchRows();
      state.groups = groupBySession(rows);
      state.total = state.groups.length;
      render(state.groups);
      const pages = Math.max(1, Math.ceil(state.total / PAGE));
      $('pager').hidden = state.total === 0;
      $('page').textContent = `Page ${state.page + 1} of ${pages} (${state.total} session${
        state.total === 1 ? '' : 's'
      }, ${rows.length} versions${rows.length === MAX_ROWS ? ' — cap reached' : ''})`;
      $('prev').disabled = state.page === 0;
      $('next').disabled = state.page >= pages - 1;
      msg('');
    } catch (e) {
      msg(`Failed to load sessions: ${e.message} — check the publishable key and table name in settings.`, true);
      $('pager').hidden = true;
    }
  }

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    if (!cfg.supabaseUrl || !(cfg.publishableKey || cfg.anonKey) || !cfg.userId) {
      msg('Not configured. Open settings and enter your Supabase project.', true);
      $('pager').hidden = true;
      return;
    }
    state.cfg = cfg;
    load();
  });

  $('prev').addEventListener('click', () => {
    if (state.page > 0) { state.page--; load(); }
  });
  $('next').addEventListener('click', () => { state.page++; load(); });
  $('refresh').addEventListener('click', load);
})();
