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

  function describe(r) {
    if (!r) return;
    const mine = chrome.runtime.getManifest().version;
    if (r.agentVersion && r.agentVersion !== mine) {
      return `This tab is running v${r.agentVersion}, extension is v${mine} — reload the strudel.cc tab (Cmd+Shift+R).`;
    }
    if (!r.configured) return 'Not configured yet — open Settings.';
    const parts = [];
    if (r.lastError) parts.push(`⚠ ${r.lastError}`);
    parts.push(`autosave: ${r.autosave ? 'on' : 'OFF'}`);
    parts.push(`${r.sessions || 0} session(s) found`);
    parts.push(`last sync: ${r.lastSync || 'never'}`);
    if (!r.sessions && r.diagnostics && r.diagnostics.why) {
      parts.push(`— ${r.diagnostics.why}`);
    }
    return parts.join(' · ');
  }

  async function diagnostics() {
    const r = await ask('getStatus');
    if (!r || !r.diagnostics) {
      status.textContent = 'No diagnostics — is this a strudel.cc tab with the extension reloaded?';
      return;
    }
    const d = r.diagnostics;
    const mine = chrome.runtime.getManifest().version;
    status.textContent = [
      `extension: v${mine}`,
      `tab agent: v${r.agentVersion || '(none)'}${r.agentVersion && r.agentVersion !== mine ? '  ← STALE, reload the tab' : ''}`,
      `origin: ${d.origin}`,
      `in scope: ${d.inScope ? 'yes' : 'NO (manifest limits this to strudel.cc)'}`,
      `sessions: ${r.sessions || 0}`,
      `code fragment: ${d.hasCodeFragment ? d.codeBytes + 'b' : 'ABSENT'}`,
      `title: ${d.title || '(none)'}`,
      `why: ${d.why || 'ok'}`,
    ].join('\n');
  }

  (async () => {
    status.textContent = 'Loading…';
    const r = await ask('getStatus');
    status.textContent = describe(r) || 'Open strudel.cc first, then retry.';
  })();

  document.getElementById('diag').addEventListener('click', diagnostics);

  document.getElementById('sync').addEventListener('click', async () => {
    status.textContent = 'Syncing…';
    const r = await ask('syncNow');
    if (!r) return;
    status.textContent = r.ok
      ? `Synced ✓ (${r.inserts} new version${r.inserts === 1 ? '' : 's'}, ${r.skipped || 0} unchanged)` +
        (r.autosave ? '' : ' · autosave off')
      : `Error: ${r.error || 'unknown'}`;
  });

  document.getElementById('sessions').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('sessions.html') }));
  document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
