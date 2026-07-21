const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let currentFilePath = null;
let connected = false;

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  return (bytesPerSec / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatRatio(ratio) {
  if (ratio === 0) return '0.00';
  return ratio.toFixed(2);
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

  const statusClass = getStatusClass(torrent.status);
  const isError = torrent.error && torrent.error_string;

  card.innerHTML = `
    <div class="torrent-card-row">
      <span class="torrent-name">${escapeHtml(torrent.name)}</span>
      <span class="torrent-status ${statusClass}">${isError ? 'Error' : torrent.status}</span>
    </div>
    <div class="torrent-card-row">
      <div class="torrent-stats">
        <span class="torrent-stat"><span class="torrent-stat-value">↑ ${formatSpeed(torrent.rate_upload)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-value">↓ ${formatSpeed(torrent.rate_download)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">Ratio</span> <span class="torrent-stat-value">${formatRatio(torrent.upload_ratio)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">DL</span> <span class="torrent-stat-value">${formatBytes(torrent.downloaded_ever)}</span></span>
        <span class="torrent-stat"><span class="torrent-stat-label">Size</span> <span class="torrent-stat-value">${formatBytes(torrent.total_size)}</span></span>
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

  for (const t of torrents) {
    const id = String(t.id);
    const existing = list.querySelector(`[data-id="${id}"]`);
    if (existing) {
      existing.replaceWith(createTorrentCard(t));
    } else {
      list.appendChild(createTorrentCard(t));
    }
  }
}

function updateConnectionState(isConnected) {
  connected = isConnected;
  document.getElementById('connect-btn').disabled = isConnected;
  document.getElementById('disconnect-btn').disabled = !isConnected;
}

async function getSettings() {
  try {
    return await invoke('get_settings');
  } catch (error) {
    console.error('Failed to get settings:', error);
    return { theme: 'dark', rpc_host: 'localhost', rpc_port: 9091, rpc_auth: false, rpc_username: '', rpc_password: '' };
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

async function connect() {
  const settings = await getSettings();
  try {
    await invoke('rpc_connect', {
      host: settings.rpc_host,
      port: settings.rpc_port,
      auth: settings.rpc_auth,
      username: settings.rpc_username,
      password: settings.rpc_password,
    });
    updateConnectionState(true);
  } catch (error) {
    console.error('Connection failed:', error);
    alert('Connection failed: ' + error);
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

function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('hidden');
  getSettings().then(settings => {
    document.getElementById('rpc-host').value = settings.rpc_host;
    document.getElementById('rpc-port').value = settings.rpc_port;
    document.getElementById('rpc-auth').checked = settings.rpc_auth;
    document.getElementById('rpc-username').value = settings.rpc_username;
    document.getElementById('rpc-password').value = settings.rpc_password;
    toggleAuthFields();
  });
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function toggleAuthFields() {
  const checked = document.getElementById('rpc-auth').checked;
  document.getElementById('auth-fields').classList.toggle('hidden', !checked);
}

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();
  await applyTheme(settings.theme);

  document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('connect-btn')?.addEventListener('click', connect);
  document.getElementById('disconnect-btn')?.addEventListener('click', disconnect);

  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('settings-close-btn')?.addEventListener('click', closeSettings);
  document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById('rpc-auth')?.addEventListener('change', toggleAuthFields);

  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      theme: (await getSettings()).theme,
      rpc_host: document.getElementById('rpc-host').value,
      rpc_port: parseInt(document.getElementById('rpc-port').value) || 9091,
      rpc_auth: document.getElementById('rpc-auth').checked,
      rpc_username: document.getElementById('rpc-username').value,
      rpc_password: document.getElementById('rpc-password').value,
    };
    await setSettings(settings);
    closeSettings();
  });

  const cliFile = await invoke('get_cli_file');
  if (cliFile) {
    await openFileByPath(cliFile);
  }

  await listen('torrents-update', (event) => {
    renderTorrents(event.payload);
  });

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

  body.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    body.classList.remove('drag-over');
  });

  await listen('tauri://drag-drop', async (event) => {
    body.classList.remove('drag-over');
    dragCounter = 0;
    const payload = event.payload;
    if (payload && payload.paths && payload.paths.length > 0) {
      const filePath = payload.paths[0];
      await openFileByPath(filePath);
    }
  });

  await listen('file-opened', async (event) => {
    if (event.payload) {
      const filePath = typeof event.payload === 'string' ? event.payload : event.payload.path;
      if (filePath) {
        await openFileByPath(filePath);
      }
    }
  });
});
