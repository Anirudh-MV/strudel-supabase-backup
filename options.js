(() => {
  'use strict';
  const DEFAULTS = { supabaseUrl: '', anonKey: '', userId: '', table: 'strudel_sessions' };
  const $ = (id) => document.getElementById(id);

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    $('url').value = cfg.supabaseUrl;
    $('key').value = cfg.anonKey;
    $('uid').value = cfg.userId;
    $('table').value = cfg.table;
  });

  $('save').addEventListener('click', async () => {
    const cfg = {
      supabaseUrl: $('url').value.trim().replace(/\/+$/, ''),
      anonKey: $('key').value.trim(),
      userId: $('uid').value.trim(),
      table: $('table').value.trim() || 'strudel_sessions',
    };
    const status = $('status');
    if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.userId) {
      status.className = 'err';
      status.textContent = 'Project URL, anon key and backup ID are all required.';
      return;
    }
    await chrome.storage.sync.set(cfg);
    status.className = 'ok';
    status.textContent = 'Saved. Open strudel.cc in a tab to start syncing.';
  });
})();