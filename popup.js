(() => {
  'use strict';
  const status = document.getElementById('status');

  async function tab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t;
  }

  async function ask(type) {
    const t = await tab();
    if (!t || !/strudel\.cc/.test(t.url || '')) {
      status.textContent = 'Open strudel.cc first, then retry.';
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(t.id, { type });
    } catch {
      status.textContent = 'Extension not active on this tab yet — reload the strudel.cc tab.';
      return null;
    }
  }

  (async () => {
    const r = await ask('getStatus');
    if (r) {
      status.textContent = r.configured
        ? `Configured. Last sync: ${r.lastSync || 'never (syncs on next change)'}`
        : 'Not configured yet — click “Configure Supabase…”.';
    }
  })();

  document.getElementById('sync').addEventListener('click', async () => {
    status.textContent = 'Syncing…';
    const r = await ask('syncNow');
    if (r) status.textContent = r.ok ? `Synced ✓ (${r.inserts} new, ${r.patches} refreshed)` : `Error: ${r.error || 'unknown'}`;
  });

  document.getElementById('sessions').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('sessions.html') }));
  document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();