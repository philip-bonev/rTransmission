const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;

let connected = false;
const selectedIds = new Set();
let filterState = 'all';
let torrentsCache = [];
let sortState = 'queue';
let sortAscending = true;
let lastSelectedId = null;

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

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
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
  const isStopped = torrent.status === 'Stopped';
  const timeLeft = isStopped ? '—' : formatTimeLeft(torrent.time_left);

  const stats = [
    `<span class="torrent-stat"><span class="torrent-stat-value">${formatPercent(torrent.percent_done)}</span></span>`,
    `<span class="torrent-stat"><span class="torrent-stat-label">Queue</span> <span class="torrent-stat-value">${torrent.queue_position}</span></span>`,
  ];
  if (!isStopped) {
    stats.push(
      `<span class="torrent-stat"><span class="torrent-stat-label">Time left</span> <span class="torrent-stat-value">${timeLeft}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">↓</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_download)}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">↑</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_upload)}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">Se</span> <span class="torrent-stat-value">${torrent.seeders}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">Le</span> <span class="torrent-stat-value">${torrent.leechers}</span></span>`,
    );
  }

  card.innerHTML = `
    <div class="torrent-card-row">
      <span class="torrent-name">${escapeHtml(torrent.name)}</span>
      <span class="torrent-status ${statusClass}">${isError ? 'Error' : torrent.status}</span>
    </div>
    <div class="torrent-card-row">
      <div class="torrent-stats">
        ${stats.join('')}
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

function matchesFilter(torrent) {
  switch (filterState) {
    case 'downloading':
      return torrent.status === 'Downloading';
    case 'paused':
      return torrent.status === 'Stopped';
    case 'seeding':
      return torrent.status === 'Seeding';
    case 'verifying':
      return torrent.status === 'Checking' || torrent.status === 'Waiting to check';
    case 'finished':
      return torrent.percent_done >= 1.0 && torrent.status === 'Stopped';
    default:
      return true;
  }
}

function compareTorrents(a, b) {
  let cmp = 0;
  switch (sortState) {
    case 'date':
      cmp = a.added_date - b.added_date;
      break;
    case 'size':
      cmp = a.total_size - b.total_size;
      break;
    case 'name':
      cmp = a.name.localeCompare(b.name);
      break;
    case 'seeders':
      cmp = a.seeders - b.seeders;
      break;
    case 'leechers':
      cmp = a.leechers - b.leechers;
      break;
    default:
      cmp = a.queue_position - b.queue_position;
  }
  return sortAscending ? cmp : -cmp;
}

function renderTorrents(torrents) {
  torrentsCache = torrents || [];
  const list = document.getElementById('torrent-list');
  const empty = document.getElementById('empty-state');

  const filtered = torrentsCache.filter(matchesFilter).sort(compareTorrents);

  if (torrentsCache.length === 0) {
    list.innerHTML = '';
    empty.querySelector('p').textContent = connected
      ? 'Torrent queue is empty.'
      : 'Connect to a Transmission daemon to get started';
    empty.style.display = '';
    selectedIds.clear();
    updateActionButtons();
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.querySelector('p').textContent = 'No torrents match the selected filter';
    empty.style.display = '';
    selectedIds.clear();
    updateActionButtons();
    return;
  }

  empty.style.display = 'none';

  const newIds = new Set(filtered.map(t => String(t.id)));
  for (const id of [...selectedIds]) {
    if (!newIds.has(id)) {
      selectedIds.delete(id);
    }
  }

  list.innerHTML = '';
  for (const t of filtered) {
    list.appendChild(createTorrentCard(t));
  }

  applySelection();
}

function updateAltSpeedState(info) {
  const enabled = !!(info && (typeof info === 'boolean' ? info : info.enabled));
  const btn = document.getElementById('alt-speed-btn');
  if (btn) {
    btn.classList.toggle('active', enabled);
  }
  const alt = document.getElementById('status-alt-speed');
  if (alt) {
    if (info && typeof info === 'object' && enabled) {
      alt.textContent =
        `· Slow mode: ↓ ${formatSpeed(info.download_limit)} ↑ ${formatSpeed(info.upload_limit)}`;
      alt.classList.remove('hidden');
    } else {
      alt.textContent = '';
      alt.classList.add('hidden');
    }
  }
}

function updateConnectionState(isConnected) {
  connected = isConnected;
  updateAltSpeedState(false);
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
  for (const id of ['start-btn', 'pause-btn', 'verify-btn', 'properties-btn', 'delete-btn']) {
    document.getElementById(id).disabled = !hasSelection;
  }
  for (const id of ['queue-top-btn', 'queue-up-btn', 'queue-down-btn', 'queue-bottom-btn']) {
    document.getElementById(id).disabled = !hasSelection;
  }
}

async function getSettings() {
  try {
    return await invoke('get_settings');
  } catch (error) {
    console.error('Failed to get settings:', error);
    return { rpc_host: 'localhost', rpc_port: 9091, rpc_auth: false, rpc_username: '', rpc_password: '', rpc_https: false, rpc_insecure: false, auto_connect: true, theme: 'auto' };
  }
}

async function setSettings(settings) {
  try {
    await invoke('set_settings', { newSettings: settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

let currentTheme = 'auto';

function applyTheme(theme) {
  let dark;
  if (theme === 'dark') {
    dark = true;
  } else if (theme === 'light') {
    dark = false;
  } else {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
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

function showAddError(message) {
  const el = document.getElementById('add-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearAddError() {
  const el = document.getElementById('add-error');
  el.textContent = '';
  el.classList.add('hidden');
}

function reportAddError(message) {
  const overlayOpen = !document.getElementById('add-overlay').classList.contains('hidden');
  if (overlayOpen) {
    showAddError(message);
  } else {
    alert(message);
  }
}

async function addTorrent(input, downloadDir = null, pauseAfterMetadata = false) {
  if (!connected) {
    reportAddError('Connect to a Transmission daemon first');
    return false;
  }
  try {
    await invoke('validate_torrent_input', { input });
  } catch (error) {
    reportAddError(String(error || 'Invalid torrent input'));
    return false;
  }
  try {
    await invoke('rpc_add_torrent', { input, downloadDir, pauseAfterMetadata });
    return true;
  } catch (error) {
    reportAddError(String(error || 'Failed to add torrent'));
    return false;
  }
}

async function handleIncomingTorrent(input) {
  const value = input?.trim();
  if (!value) return;
  const lower = value.toLowerCase();
  if (lower.startsWith('magnet:')) {
    openAddDialog('Add Magnet Link', 'Magnet link', 'magnet:?xt=urn:btih:...', false, value);
  } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
    openAddDialog('Add Torrent URL', 'URL', 'https://example.com/file.torrent', false, value);
  } else {
    openAddDialog('Add Torrent File', 'Torrent file', '/path/to/file.torrent', true, value);
  }
}

async function addTorrentFile() {
  openAddFileDialog();
}

function openAddFileDialog() {
  openAddDialog('Add Torrent File', 'Torrent file', '/path/to/file.torrent', true);
}

function getLastDownloadDirs() {
  try {
    const raw = localStorage.getItem('lastDownloadDirs');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getDownloadDirOptions() {
  const seen = new Map();
  for (const dir of getLastDownloadDirs()) {
    if (dir) seen.set(dir, true);
  }
  for (const t of torrentsCache) {
    if (t.download_dir) seen.set(t.download_dir, true);
  }
  return Array.from(seen.keys());
}

let locationActiveIndex = -1;

function renderLocationOptions() {
  const container = document.getElementById('location-options');
  const input = document.getElementById('add-download-dir');
  const query = input.value.trim().toLowerCase();
  const dirs = getDownloadDirOptions().filter((d) => !query || d.toLowerCase().includes(query));
  container.innerHTML = '';
  dirs.forEach((dir) => {
    const opt = document.createElement('div');
    opt.className = 'location-option';
    opt.textContent = dir;
    opt.title = dir;
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = dir;
      closeLocationOptions();
      updateFreeSpace();
    });
    container.appendChild(opt);
  });
  locationActiveIndex = -1;
  return dirs;
}

function openLocationOptions() {
  const container = document.getElementById('location-options');
  if (renderLocationOptions().length > 0) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

function closeLocationOptions() {
  document.getElementById('location-options').classList.add('hidden');
  locationActiveIndex = -1;
}

function moveLocationSelection(delta) {
  const options = document.querySelectorAll('#location-options .location-option');
  if (options.length === 0) return;
  locationActiveIndex = (locationActiveIndex + delta + options.length) % options.length;
  options.forEach((opt, i) => opt.classList.toggle('active', i === locationActiveIndex));
  options[locationActiveIndex].scrollIntoView({ block: 'nearest' });
}

function populateDownloadDirOptions() {
  renderLocationOptions();
}

function saveLastDownloadDir(dir) {
  const list = getLastDownloadDirs().filter(d => d !== dir);
  list.unshift(dir);
  localStorage.setItem('lastDownloadDirs', JSON.stringify(list.slice(0, 10)));
}

function updateFreeSpace() {
  const el = document.getElementById('add-free-space');
  const path = document.getElementById('add-download-dir').value.trim();
  if (!path || !connected) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = 'Checking free space…';
  invoke('rpc_get_free_space', { path })
    .then(bytes => {
      el.textContent = `Free space: ${formatBytes(bytes)}`;
      el.classList.remove('hidden');
    })
    .catch(() => {
      el.textContent = '';
      el.classList.add('hidden');
    });
}

async function openAddDialog(title, label, placeholder, browse = false, prefill = '') {
  document.getElementById('add-dialog-title').textContent = title;
  document.getElementById('add-input-label').textContent = label;
  const input = document.getElementById('add-input');
  input.placeholder = placeholder;
  input.value = prefill;
  document.getElementById('add-browse-btn').classList.toggle('hidden', !browse);
  const settings = await getSettings();
  document.getElementById('add-download-dir').value = settings.default_download_dir || '';
  populateDownloadDirOptions();
  clearAddError();
  updateFreeSpace();
  document.getElementById('add-overlay').classList.remove('hidden');
  input.focus();
}

function closeAddDialog() {
  closeLocationOptions();
  document.getElementById('add-overlay').classList.add('hidden');
}

function openSettingsDialog() {
  getSettings().then(settings => {
    document.getElementById('default-download-dir').value = settings.default_download_dir || '';
    document.getElementById('theme-select').value = settings.theme || 'auto';
    document.getElementById('settings-overlay').classList.remove('hidden');
  });
}

function closeSettingsDialog() {
  document.getElementById('settings-overlay').classList.add('hidden');
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

function updateContextMenuChecks() {
  document.querySelectorAll('#ctx-filter-submenu .context-item').forEach(el => {
    el.textContent = (el.dataset.filter === filterState ? '✓ ' : '') + el.dataset.label;
  });
  document.querySelectorAll('#ctx-sort-submenu .context-item').forEach(el => {
    const base = el.dataset.label;
    if (el.dataset.sort) {
      el.textContent = (el.dataset.sort === sortState ? '✓ ' : '') + base;
    } else if (el.dataset.sortDir) {
      const active = el.dataset.sortDir === (sortAscending ? 'asc' : 'desc');
      el.textContent = (active ? '✓ ' : '') + base;
    }
  });
}

function openContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  updateContextMenuChecks();
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const px = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const py = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
}

function closeContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
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
  currentTheme = settings.theme || 'auto';
  applyTheme(currentTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(currentTheme);
  });

  document.getElementById('connect-btn')?.addEventListener('click', () => connect());
  document.getElementById('disconnect-btn')?.addEventListener('click', disconnect);

  document.getElementById('add-url-btn')?.addEventListener('click', () => {
    openAddDialog('Add Torrent URL', 'URL', 'https://example.com/file.torrent');
  });
  document.getElementById('add-magnet-btn')?.addEventListener('click', () => {
    openAddDialog('Add Magnet Link', 'Magnet link', 'magnet:?xt=urn:btih:...');
  });
  document.getElementById('add-file-btn')?.addEventListener('click', addTorrentFile);

  await listen('menu-connection-settings', openConnectionSettings);
  await listen('menu-add-url', () => {
    openAddDialog('Add Torrent URL', 'URL', 'https://example.com/file.torrent');
  });
  await listen('menu-add-magnet', () => {
    openAddDialog('Add Magnet Link', 'Magnet link', 'magnet:?xt=urn:btih:...');
  });
  await listen('menu-add-file', addTorrentFile);
  await listen('menu-play', () => {
    runTorrentAction('rpc_torrent_action', { action: 'start', ids: getSelectedIds() });
  });
  await listen('menu-pause', () => {
    runTorrentAction('rpc_torrent_action', { action: 'pause', ids: getSelectedIds() });
  });
  await listen('menu-delete', openDeleteDialog);
  await listen('menu-verify', () => {
    runTorrentAction('rpc_torrent_action', { action: 'verify', ids: getSelectedIds() });
  });
  await listen('menu-sort', (event) => {
    sortState = event.payload;
    document.getElementById('sort-select').value = sortState;
    renderTorrents(torrentsCache);
  });
  await listen('menu-sort-dir', (event) => {
    sortAscending = event.payload === 'asc';
    const checkbox = document.getElementById('sort-asc');
    checkbox.checked = sortAscending;
    const label = document.querySelector('#sort-asc-label');
    if (label) label.lastChild.textContent = sortAscending ? ' Asc' : ' Desc';
    renderTorrents(torrentsCache);
  });
  await listen('menu-filter', (event) => {
    filterState = event.payload;
    document.getElementById('filter-select').value = filterState;
    renderTorrents(torrentsCache);
  });

  document.getElementById('start-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_torrent_action', { action: 'start', ids: getSelectedIds() });
  });
  document.getElementById('pause-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_torrent_action', { action: 'pause', ids: getSelectedIds() });
  });
  document.getElementById('delete-btn')?.addEventListener('click', openDeleteDialog);

  document.getElementById('verify-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_torrent_action', { action: 'verify', ids: getSelectedIds() });
  });

  document.getElementById('properties-btn')?.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    try {
      await invoke('open_properties_window', { id: ids[0] });
    } catch (error) {
      console.error('Failed to open properties:', error);
    }
  });

  document.getElementById('queue-top-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_queue_move', { action: 'top', ids: getSelectedIds() });
  });
  document.getElementById('queue-up-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_queue_move', { action: 'up', ids: getSelectedIds() });
  });
  document.getElementById('queue-down-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_queue_move', { action: 'down', ids: getSelectedIds() });
  });
  document.getElementById('queue-bottom-btn')?.addEventListener('click', () => {
    runTorrentAction('rpc_queue_move', { action: 'bottom', ids: getSelectedIds() });
  });

  document.getElementById('alt-speed-btn')?.addEventListener('click', async () => {
    try {
      const enabled = await invoke('rpc_toggle_alt_speed');
      updateAltSpeedState(enabled);
    } catch (error) {
      console.error('Failed to toggle speed mode:', error);
      alert('Failed to toggle speed mode: ' + error);
    }
  });

  document.getElementById('filter-select')?.addEventListener('change', (e) => {
    filterState = e.target.value;
    renderTorrents(torrentsCache);
    invoke('update_menu_markers', {
      sort: sortState,
      sortDir: sortAscending ? 'asc' : 'desc',
      filter: filterState,
    });
  });

  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    sortState = e.target.value;
    renderTorrents(torrentsCache);
    invoke('update_menu_markers', {
      sort: sortState,
      sortDir: sortAscending ? 'asc' : 'desc',
      filter: filterState,
    });
  });

  document.getElementById('sort-asc')?.addEventListener('change', (e) => {
    sortAscending = e.target.checked;
    const label = document.querySelector('#sort-asc-label');
    if (label) label.lastChild.textContent = sortAscending ? ' Asc' : ' Desc';
    renderTorrents(torrentsCache);
    invoke('update_menu_markers', {
      sort: sortState,
      sortDir: sortAscending ? 'asc' : 'desc',
      filter: filterState,
    });
  });

  function selectTorrentCard(e) {
    const card = e.target.closest('.torrent-card');
    if (!card) return;
    const id = card.dataset.id;
    const visible = Array.from(document.getElementById('torrent-list').children).map(c => c.dataset.id);
    const index = visible.indexOf(id);

    if (e.shiftKey) {
      const anchor = lastSelectedId ? visible.indexOf(lastSelectedId) : -1;
      const from = anchor >= 0 ? anchor : index;
      const lo = Math.min(from, index);
      const hi = Math.max(from, index);
      selectedIds.clear();
      for (let i = lo; i <= hi; i++) {
        selectedIds.add(visible[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
    } else {
      selectedIds.clear();
      selectedIds.add(id);
    }
    lastSelectedId = id;
    applySelection();
  }

  document.getElementById('torrent-list')?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    selectTorrentCard(e);
  });

  document.getElementById('torrent-list')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = e.target.closest('.torrent-card');
    if (card) {
      const id = card.dataset.id;
      if (!selectedIds.has(id)) {
        selectedIds.clear();
        selectedIds.add(id);
        applySelection();
      }
      lastSelectedId = id;
    }
    openContextMenu(e.clientX, e.clientY);
  });

  document.getElementById('context-menu')?.addEventListener('click', (e) => {
    const item = e.target.closest('.context-item');
    if (!item) return;
    closeContextMenu();
    const marker = { sort: sortState, sortDir: sortAscending ? 'asc' : 'desc', filter: filterState };
    if (item.dataset.action) {
      const action = item.dataset.action;
      if (action === 'delete') {
        openDeleteDialog();
      } else {
        const rpcAction = action === 'play' ? 'start' : action;
        runTorrentAction('rpc_torrent_action', { action: rpcAction, ids: getSelectedIds() });
      }
    } else if (item.dataset.filter) {
      filterState = item.dataset.filter;
      document.getElementById('filter-select').value = filterState;
      renderTorrents(torrentsCache);
      invoke('update_menu_markers', marker);
    } else if (item.dataset.sort) {
      sortState = item.dataset.sort;
      document.getElementById('sort-select').value = sortState;
      renderTorrents(torrentsCache);
      invoke('update_menu_markers', marker);
    } else if (item.dataset.sortDir) {
      sortAscending = item.dataset.sortDir === 'asc';
      document.getElementById('sort-asc').checked = sortAscending;
      const label = document.querySelector('#sort-asc-label');
      if (label) label.lastChild.textContent = sortAscending ? ' Asc' : ' Desc';
      renderTorrents(torrentsCache);
      invoke('update_menu_markers', marker);
    }
  });

  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('#torrent-list') && !e.target.closest('#context-menu')) {
      closeContextMenu();
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#context-menu')) closeContextMenu();
  });
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeContextMenu();
    closeAddDialog();
    closeSettingsDialog();
    closeConnectionSettings();
    closeDeleteDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || (e.key !== 'a' && e.key !== 'A')) return;
    const target = e.target;
    const isTyping = target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable);
    if (isTyping) return;
    e.preventDefault();
    selectedIds.clear();
    for (const t of torrentsCache.filter(matchesFilter)) {
      selectedIds.add(String(t.id));
    }
    applySelection();
  });

  document.getElementById('connection-settings-btn')?.addEventListener('click', openConnectionSettings);
  document.getElementById('connection-settings-close-btn')?.addEventListener('click', closeConnectionSettings);
  document.getElementById('connection-settings-cancel-btn')?.addEventListener('click', closeConnectionSettings);
  document.getElementById('connection-settings-overlay')?.addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeConnectionSettings();
  });
  document.getElementById('rpc-auth')?.addEventListener('change', toggleAuthFields);

  document.getElementById('settings-btn')?.addEventListener('click', openSettingsDialog);
  document.getElementById('settings-close-btn')?.addEventListener('click', closeSettingsDialog);
  document.getElementById('settings-cancel-btn')?.addEventListener('click', closeSettingsDialog);
  document.getElementById('settings-overlay')?.addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeSettingsDialog();
  });
  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = await getSettings();
    current.default_download_dir =
      document.getElementById('default-download-dir').value.trim() || null;
    current.theme = document.getElementById('theme-select').value;
    await setSettings(current);
    currentTheme = current.theme;
    applyTheme(currentTheme);
    closeSettingsDialog();
  });

  document.getElementById('connection-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
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

  document.getElementById('add-browse-btn')?.addEventListener('click', async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Torrent files', extensions: ['torrent', 'magnet'] }],
      });
      if (path) {
        document.getElementById('add-input').value = path;
        clearAddError();
      }
    } catch (error) {
      console.error('Failed to pick file:', error);
    }
  });

  document.getElementById('add-input')?.addEventListener('input', clearAddError);

  let freeSpaceTimer = null;
  const downloadDirInput = document.getElementById('add-download-dir');
  downloadDirInput?.addEventListener('focus', openLocationOptions);
  downloadDirInput?.addEventListener('input', () => {
    openLocationOptions();
    clearTimeout(freeSpaceTimer);
    freeSpaceTimer = setTimeout(updateFreeSpace, 400);
  });
  downloadDirInput?.addEventListener('blur', closeLocationOptions);
  downloadDirInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveLocationSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveLocationSelection(-1);
    } else if (e.key === 'Enter' && locationActiveIndex >= 0) {
      e.preventDefault();
      const active = document.querySelectorAll('#location-options .location-option')[locationActiveIndex];
      if (active) {
        downloadDirInput.value = active.textContent;
        closeLocationOptions();
        updateFreeSpace();
      }
    } else if (e.key === 'Escape') {
      closeLocationOptions();
    }
  });

  document.getElementById('add-close-btn')?.addEventListener('click', closeAddDialog);
  document.getElementById('add-cancel-btn')?.addEventListener('click', closeAddDialog);
  document.getElementById('add-overlay')?.addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeAddDialog();
  });
  document.getElementById('add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = document.getElementById('add-input').value.trim();
    if (!value) {
      showAddError('Enter a URL, magnet link, or torrent file path');
      return;
    }
    clearAddError();
    const downloadDir = document.getElementById('add-download-dir').value.trim() || null;
    if (downloadDir) saveLastDownloadDir(downloadDir);
    const pauseAfterMetadata = document.getElementById('add-pause-after-metadata').checked;
    const ok = await addTorrent(value, downloadDir, pauseAfterMetadata);
    if (ok) closeAddDialog();
  });

  document.getElementById('delete-close-btn')?.addEventListener('click', closeDeleteDialog);
  document.getElementById('delete-cancel-btn')?.addEventListener('click', closeDeleteDialog);
  document.getElementById('delete-overlay')?.addEventListener('mousedown', (e) => {
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

  await listen('alt-speed-update', (event) => {
    updateAltSpeedState(event.payload);
  });

  const cliFile = await invoke('get_cli_file');
  invoke('update_menu_markers', {
    sort: sortState,
    sortDir: sortAscending ? 'asc' : 'desc',
    filter: filterState,
  });
  if (settings.auto_connect) {
    await connect(true);
  }
  if (cliFile) {
    await handleIncomingTorrent(cliFile);
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
          await handleIncomingTorrent(trimmed);
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
      await handleIncomingTorrent(filePath);
    }
  });

  await listen('file-opened', async (event) => {
    if (event.payload) {
      const filePath = typeof event.payload === 'string' ? event.payload : event.payload.path;
      if (filePath) {
        await handleIncomingTorrent(filePath);
      }
    }
  });
});
