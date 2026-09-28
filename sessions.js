(() => {
  'use strict';
  const PAGE = 10;
  const DEFAULTS = { supabaseUrl: '', anonKey: '', userId: '', table: 'strudel_sessions' };
  const $ = (id) => document.getElementById(id);
  const msg = (text, err) => {
    $('msg').textContent = text;
    $('msg').className = err ? 'err' : 'muted';
  };
  let state = { page: 0, total: null, cfg: null };

  async function fetchPage(page) {
    const { supabaseUrl, anonKey, table } = state.cfg;
    const base = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}`;
    const path =
      `?select=session_name,author,pattern_id,data,updated_at` +
      `&order=updated_at.desc&limit=${PAGE}&offset=${page * PAGE}`;
    const res = await fetch(base + path, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: 'count=exact',
        Range: `${page * PAGE}-${page * PAGE + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    let total = null;
    const cr = res.headers.get('content-range'); // e.g. "0-9/42"
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) total = Number(m[1]);
    }
    return { rows, total };
  }

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(t).toLocaleString();
  }

  function render(rows) {
    const tbody = $('rows');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = '<tr><td class="muted">No sessions yet — save something on strudel.cc and sync.</td></tr>';
      return;
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = 'row';
      const firstLine = (r.data || '').split('\n').find((l) => l.trim()) || '';
      tr.innerHTML =
        `<td><div class="name">${escapeHtml(r.session_name)}</div>` +
        `<div class="muted">${escapeHtml(r.author || '')} · ${relTime(r.updated_at)}</div></td>` +
        `<td class="snippet">${escapeHtml(firstLine.slice(0, 80))}</td>`;
      const detail = document.createElement('tr');
      detail.hidden = true;
      detail.className = 'expanded';
      detail.innerHTML =
        `<td colspan="2"><pre></pre>` +
        `<button class="copy">Copy code</button></td>`;
      const pre = detail.querySelector('pre');
      pre.textContent = r.data || '';
      detail.querySelector('.copy').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(r.data || '');
          e.target.textContent = 'Copied ✓';
          setTimeout(() => (e.target.textContent = 'Copy code'), 1500);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = r.data || '';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
      });
      tr.addEventListener('click', () => {
        detail.hidden = !detail.hidden;
      });
      tbody.append(tr, detail);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load() {
    if (!state.cfg) return;
    try {
      const { rows, total } = await fetchPage(state.page);
      state.total = total;
      render(rows);
      const pages = total == null ? null : Math.max(1, Math.ceil(total / PAGE));
      $('pager').hidden = false;
      $('page').textContent =
        total == null ? `Page ${state.page + 1}` : `Page ${state.page + 1} of ${pages} (${total} sessions)`;
      $('prev').disabled = state.page === 0;
      $('next').disabled = rows.length < PAGE || (pages != null && state.page >= pages - 1);
      msg('');
    } catch (e) {
      msg(`Failed to load sessions: ${e.message} — check options.`, true);
    }
  }

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.userId) {
      msg('Not configured. Open extension options and enter your Supabase project.', true);
      $('pager').hidden = true;
      return;
    }
    state.cfg = cfg;
    load();
  });

  $('prev').addEventListener('click', () => { if (state.page > 0) { state.page--; load(); } });
  $('next').addEventListener('click', () => { state.page++; load(); });
  $('refresh').addEventListener('click', load);
})();