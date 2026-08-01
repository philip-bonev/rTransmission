const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;

let connected = false;
const selectedIds = new Set();

function formatPercent(percent) {
  return (percent * 100).toFixed(1) + '%';
}

function formatTimeLeft(seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds === 0) return 'Done';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds % 60}s`;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  return (bytesPerSec / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function getStatusClass(status) {
  switch (status) {
    case 'Downloading': return 'status-downloading';
    case 'Seeding': return 'status-seeding';
    case 'Stopped': return 'status-stopped';
    case 'Checking': return 'status-checking';
    case 'DownloadWait': case 'Waiting to download': return 'status-waiting';
    case 'SeedWait': case 'Waiting to seed': return 'status-waiting';
    case 'CheckWait': case 'Waiting to check': return 'status-waiting';
    case 'Stalled': return 'status-stalled';
    default: return 'status-stopped';
  }
}

function createTorrentCard(torrent) {
  const card = document.createElement('div');
  card.className = 'torrent-card';
  card.dataset.id = torrent.id;

  const isError = torrent.error && torrent.error_string;
  const statusClass = isError ? 'status-error' : getStatusClass(torrent.status);
  const timeLeft = torrent.status === 'Stopped' ? '—' : formatTimeLeft(torrent.time_left);

  card.innerHTML = `
    <div class="torrent-card-row">
      <span class="torrent-name">${escapeHtml(torrent.name)}</span>
      <span class="torrent-status ${statusClass}">${isError ? 'Error' : torrent.status}</span>
    </div>
    <div class="torrent-card-row">
      <div class="torrent-stats">
        <span class="torrent-stat"><span class="torrent-stat-value">${formatPercent(torrent.percent_done)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">Time left</span> <span class="torrent-stat-value">${timeLeft}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">↓</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_download)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">↑</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_upload)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">Se</span> <span class="torrent-stat-value">${torrent.seeders}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">Le</span> <span class="torrent-stat-value">${torrent.leechers}</span></span>
      </div>
    </div>
  `;

  if (isError) {
    card.title = torrent.error_string;
  }

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderTorrents(torrents) {
  const list = document.getElementById('torrent-list');
  const empty = document.getElementById('empty-state');

  if (!torrents || torrents.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    selectedIds.clear();
    updateActionButtons();
    return;
  }

  empty.style.display = 'none';

  const existingIds = new Set();
  for (const child of list.children) {
    existingIds.add(child.dataset.id);
  }

  const newIds = new Set(torrents.map(t => String(t.id)));

  for (const child of list.children) {
    if (!newIds.has(child.dataset.id)) {
      child.remove();
    }
  }

  for (const id of [...selectedIds]) {
    if (!newIds.has(id)) {
      selectedIds.delete(id);
    }
  }

  for (const t of torrents) {
    const id = String(t.id);
    const existing = list.querySelector(`[data-id="${id}"]`);
    if (existing) {
      existing.replaceWith(createTorrentCard(t));
    } else {
      list.appendChild(createTorrentCard(t));
    }
  }

  applySelection();
}

function updateConnectionState(isConnected) {
  connected = isConnected;
  const conn = document.getElementById('status-connection');
  if (conn) {
    conn.textContent = isConnected ? '● Connected' : '● Disconnected';
    conn.classList.toggle('status-connected', isConnected);
    conn.classList.toggle('status-disconnected', !isConnected);
  }
  const transfer = document.getElementById('status-transfer');
  if (transfer) {
    transfer.classList.toggle('hidden', !isConnected);
    if (!isConnected) transfer.textContent = '';
  }
  document.getElementById('connect-btn').disabled = isConnected;
  document.getElementById('disconnect-btn').disabled = !isConnected;
  for (const id of ['add-url-btn', 'add-file-btn', 'add-magnet-btn']) {
    document.getElementById(id).disabled = !isConnected;
  }
  updateActionButtons();
}

function updateTransferStats(stats) {
  const el = document.getElementById('status-transfer');
  if (!el || !stats) return;
  const down = stats.download_speed || 0;
  const up = stats.upload_speed || 0;
  el.textContent = `↓ ${formatSpeed(down)} ↑ ${formatSpeed(up)} · Total ${formatSpeed(down + up)}`;
}

function getSelectedIds() {
  return Array.from(selectedIds).map(Number);
}

function applySelection() {
  const list = document.getElementById('torrent-list');
  for (const child of list.children) {
    child.classList.toggle('selected', selectedIds.has(child.dataset.id));
  }
  updateActionButtons();
}

function updateActionButtons() {
  const hasSelection = connected && selectedIds.size > 0;
  for (const id of ['start-btn', 'pause-btn', 'delete-btn']) {
    document.getElementById(id).disabled = !hasSelection;
  }
}

async function getSettings() {
  try {
    return await invoke('get_settings');
  } catch (error) {
    console.error('Failed to get settings:', error);
    return { theme: 'dark', rpc_host: 'localhost', rpc_port: 9091, rpc_auth: false, rpc_username: '', rpc_password: '', rpc_https: false, rpc_insecure: false, auto_connect: true };
  }
}

async function setSettings(settings) {
  try {
    await invoke('set_settings', { newSettings: settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

async function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sun = document.querySelector('#theme-btn .icon-sun');
  const moon = document.querySelector('#theme-btn .icon-moon');
  if (sun && moon) {
    sun.style.display = theme === 'dark' ? '' : 'none';
    moon.style.display = theme === 'light' ? '' : 'none';
  }
}

async function toggleTheme() {
  const settings = await getSettings();
  const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
  settings.theme = newTheme;
  await applyTheme(newTheme);
  await setSettings(settings);
}

async function connect(silent = false) {
  const settings = await getSettings();
  try {
    await invoke('rpc_connect', {
      args: {
        host: settings.rpc_host,
        port: settings.rpc_port,
        auth: settings.rpc_auth,
        username: settings.rpc_username,
        password: settings.rpc_password,
        https: settings.rpc_https,
        insecure: settings.rpc_insecure,
      },
    });
    updateConnectionState(true);
  } catch (error) {
    console.error('Connection failed:', error);
    if (!silent) {
      alert('Connection failed: ' + error);
    }
  }
}

async function disconnect() {
  try {
    await invoke('rpc_disconnect');
    updateConnectionState(false);
    renderTorrents([]);
  } catch (error) {
    console.error('Disconnect failed:', error);
  }
}

async function addTorrent(input) {
  if (!connected) {
    alert('Connect to a Transmission daemon first');
    return;
  }
  try {
    await invoke('rpc_add_torrent', { input });
  } catch (error) {
    console.error('Failed to add torrent:', error);
    alert('Failed to add torrent: ' + error);
  }
}

function openAddDialog(title, label, placeholder) {
  document.getElementById('add-dialog-title').textContent = title;
  document.getElementById('add-input-label').textContent = label;
  const input = document.getElementById('add-input');
  input.placeholder = placeholder;
  input.value = '';
  document.getElementById('add-overlay').classList.remove('hidden');
  input.focus();
}

function closeAddDialog() {
  document.getElementById('add-overlay').classList.add('hidden');
}

function openDeleteDialog() {
  if (selectedIds.size === 0) return;
  const count = selectedIds.size;
  document.getElementById('delete-count').textContent =
    count === 1 ? 'Delete the selected torrent?' : `Delete the ${count} selected torrents?`;
  document.getElementById('delete-data-checkbox').checked = false;
  document.getElementById('delete-overlay').classList.remove('hidden');
}

function closeDeleteDialog() {
  document.getElementById('delete-overlay').classList.add('hidden');
}

async function runTorrentAction(command, args) {
  if (!connected || selectedIds.size === 0) return;
  try {
    await invoke(command, args);
  } catch (error) {
    console.error('Action failed:', error);
    alert('Action failed: ' + error);
  }
}

function openConnectionSettings() {
  const overlay = document.getElementById('connection-settings-overlay');
  overlay.classList.remove('hidden');
  getSettings().then(settings => {
    document.getElementById('rpc-host').value = settings.rpc_host;
    document.getElementById('rpc-port').value = settings.rpc_port;
    document.getElementById('rpc-auth').checked = settings.rpc_auth;
    document.getElementById('rpc-username').value = settings.rpc_username;
    document.getElementById('rpc-password').value = settings.rpc_password;
    document.getElementById('rpc-https').checked = settings.rpc_https;
    document.getElementById('rpc-insecure').checked = settings.rpc_insecure;
    document.getElementById('rpc-auto-connect').checked = settings.auto_connect;
    toggleAuthFields();
  });
}

function closeConnectionSettings() {
  document.getElementById('connection-settings-overlay').classList.add('hidden');
}

function toggleAuthFields() {
  const checked = document.getElementById('rpc-auth').checked;
  document.getElementById('auth-fields').classList.toggle('hidden', !checked);
}

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();
  await applyTheme(settings.theme);

  document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('connect-btn')?.addEventListener('click', () => connect());
  document.getElementById('disconnect-btn')?.addEventListener('click', disconnect);

  document.getElementById('add-url-btn')?.addEventListener('click', () => {
    openAddDialog('Add Torrent URL', 'URL', 'https://example.com/file.torrent');
  });
  document.getElementById('add-magnet-btn')?.addEventListener('click', () => {
    openAddDialog('Add Magnet Link', 'Magnet link', 'magnet:?xt=urn:btih:...');
  });
  document.getElementById('add-file-btn')?.addEventListener('click', async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Torrent files', extensions: ['torrent', 'magnet'] }],
      });
      if (path) {
        await addTorrent(path);
      }
    } catch (error) {
      console.error('Failed to pick file:', error);
    }
  });

  document.getElementById('start-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_torrent_action', { action: 'start', ids: getSelectedIds() });
  });
  document.getElementById('pause-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_torrent_action', { action: 'pause', ids: getSelectedIds() });
  });
  document.getElementById('delete-btn')?.addEventListener('click', openDeleteDialog);

  document.getElementById('torrent-list')?.addEventListener('click', (e) => {
    const card = e.target.closest('.torrent-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.ctrlKey || e.metaKey) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
    } else {
      selectedIds.clear();
      selectedIds.add(id);
    }
    applySelection();
  });

  document.getElementById('connection-settings-btn')?.addEventListener('click', openConnectionSettings);
  document.getElementById('connection-settings-close-btn')?.addEventListener('click', closeConnectionSettings);
  document.getElementById('connection-settings-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConnectionSettings();
  });
  document.getElementById('rpc-auth')?.addEventListener('change', toggleAuthFields);

  document.getElementById('connection-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      theme: (await getSettings()).theme,
      rpc_host: document.getElementById('rpc-host').value,
      rpc_port: parseInt(document.getElementById('rpc-port').value) || 9091,
      rpc_auth: document.getElementById('rpc-auth').checked,
      rpc_username: document.getElementById('rpc-username').value,
      rpc_password: document.getElementById('rpc-password').value,
      rpc_https: document.getElementById('rpc-https').checked,
      rpc_insecure: document.getElementById('rpc-insecure').checked,
      auto_connect: document.getElementById('rpc-auto-connect').checked,
    };
    await setSettings(settings);
    closeConnectionSettings();
  });

  document.getElementById('add-close-btn')?.addEventListener('click', closeAddDialog);
  document.getElementById('add-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddDialog();
  });
  document.getElementById('add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = document.getElementById('add-input').value.trim();
    if (!value) return;
    closeAddDialog();
    await addTorrent(value);
  });

  document.getElementById('delete-close-btn')?.addEventListener('click', closeDeleteDialog);
  document.getElementById('delete-cancel-btn')?.addEventListener('click', closeDeleteDialog);
  document.getElementById('delete-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDeleteDialog();
  });
  document.getElementById('delete-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const deleteData = document.getElementById('delete-data-checkbox').checked;
    closeDeleteDialog();
    await runTorrentAction('rpc_torrent_remove', { ids: getSelectedIds(), deleteData });
  });

  await listen('torrents-update', (event) => {
    renderTorrents(event.payload);
  });

  await listen('session-stats-update', (event) => {
    updateTransferStats(event.payload);
  });

  const cliFile = await invoke('get_cli_file');
  if (settings.auto_connect) {
    await connect(true);
  }
  if (cliFile) {
    await addTorrent(cliFile);
  }

  const body = document.body;
  let dragCounter = 0;

  body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    body.classList.add('drag-over');
  });

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    body.classList.add('drag-over');
  });

  body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      body.classList.remove('drag-over');
    }
  });

  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    body.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files.length === 0) {
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (text) {
        const trimmed = text.trim().split(/\r?\n/)[0].trim();
        if (trimmed.startsWith('magnet:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          await addTorrent(trimmed);
        }
      }
    }
  });

  await listen('tauri://drag-drop', async (event) => {
    body.classList.remove('drag-over');
    dragCounter = 0;
    const payload = event.payload;
    if (payload && payload.paths && payload.paths.length > 0) {
      const filePath = payload.paths[0];
      await addTorrent(filePath);
    }
  });

  await listen('file-opened', async (event) => {
    if (event.payload) {
      const filePath = typeof event.payload === 'string' ? event.payload : event.payload.path;
      if (filePath) {
        await addTorrent(filePath);
      }
    }
  });
});
