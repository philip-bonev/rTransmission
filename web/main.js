/*
 * Copyright 2026 Philip Bonev
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://apache.org
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let connected = false;
const selectedIds = new Set();
let filterState = 'all';
let torrentsCache = [];
let sortState = 'queue';
let sortAscending = true;
let lastSelectedId = null;
const prevTorrentStates = new Map();
let notificationsEnabled = true;
let notificationDuration = 5;

function showNotification(title, body) {
  if (notificationsEnabled) {
    invoke('send_notification', { title, body, duration: notificationDuration }).catch(() => {});
  }
}

function checkTorrentNotifications(torrents) {
  for (const tor of torrents) {
    const prev = prevTorrentStates.get(String(tor.id));
    if (prev) {
      const wasDone = prev.percent_done >= 1.0;
      const isDone = tor.percent_done >= 1.0;
      const wasSeeding = prev.status === 'Seeding';
      const isStopped = tor.status === 'Stopped';
      if (!wasDone && isDone) {
        showNotification('rTransmission', t('notify.download_done', { name: tor.name }));
      } else if (wasSeeding && isDone && isStopped) {
        showNotification('rTransmission', t('notify.seeding_done', { name: tor.name }));
      }
    }
    prevTorrentStates.set(String(tor.id), { percent_done: tor.percent_done, status: tor.status });
  }
}

function formatPercent(percent) {
  return (percent * 100).toFixed(1) + '%';
}

function formatTimeLeft(seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds === 0) return t('time.done');
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

function translateStatus(status) {
  return t('status.' + status) || status;
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
      `<span class="torrent-stat"><span class="torrent-stat-label">${t('torrent.queue')}</span> <span class="torrent-stat-value">${torrent.queue_position}</span></span>`,
  ];
  if (!isStopped) {
    stats.push(
      `<span class="torrent-stat"><span class="torrent-stat-label">${t('torrent.time_left')}</span> <span class="torrent-stat-value">${timeLeft}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">↓</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_download)}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">↑</span> <span class="torrent-stat-value">${formatSpeed(torrent.rate_upload)}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">${t('torrent.seeders_short')}</span> <span class="torrent-stat-value">${torrent.seeders}</span></span>`,
      `<span class="torrent-stat"><span class="torrent-stat-label">${t('torrent.leechers_short')}</span> <span class="torrent-stat-value">${torrent.leechers}</span></span>`,
    );
  }

  card.innerHTML = `
    <div class="torrent-card-row">
      <span class="torrent-name">${escapeHtml(torrent.name)}</span>
      <span class="torrent-status ${statusClass}">${isError ? t('status.error') : translateStatus(torrent.status)}</span>
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
      ? t('empty.no_torrents')
      : t('empty.disconnected');
    empty.style.display = '';
    selectedIds.clear();
    updateActionButtons();
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.querySelector('p').textContent = t('empty.no_match');
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
        `${t('status.slow')}↓ ${formatSpeed(info.download_limit)} ↑ ${formatSpeed(info.upload_limit)}`;
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
    conn.textContent = isConnected ? `● ${t('status.connected')}` : `● ${t('status.disconnected')}`;
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
  el.textContent = `↓ ${formatSpeed(down)} ↑ ${formatSpeed(up)} · ${t('status.total')} ${formatSpeed(down + up)}`;
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
      alert(`${t('error.connection_failed')}: ` + error);
    }
  }
}

async function disconnect() {
  try {
    await invoke('rpc_disconnect');
    updateConnectionState(false);
    prevTorrentStates.clear();
    renderTorrents([]);
  } catch (error) {
    console.error('Disconnect failed:', error);
  }
}

async function openAddWindow(mode, prefill = '') {
  const dirs = [];
  const seen = new Set();
  for (const tor of torrentsCache) {
    if (tor.download_dir && !seen.has(tor.download_dir)) {
      seen.add(tor.download_dir);
      dirs.push(tor.download_dir);
    }
  }
  try {
    await invoke('open_add_window', { mode, prefill, dirs, connected });
  } catch (error) {
    console.error('Failed to open add window:', error);
    alert(String(error));
  }
}

async function handleIncomingTorrent(input) {
  const value = input?.trim();
  if (!value) return;
  const lower = value.toLowerCase();
  if (lower.startsWith('magnet:')) {
    await openAddWindow('magnet', value);
  } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
    await openAddWindow('url', value);
  } else {
    await openAddWindow('file', value);
  }
}

async function openDeleteWindow() {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  try {
    await invoke('open_delete_window', { ids });
  } catch (error) {
    console.error('Failed to open delete window:', error);
    alert(String(error));
  }
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
    alert(`${t('error.action_failed')}: ` + error);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await getSettings();
  currentTheme = settings.theme || 'auto';
  notificationsEnabled = settings.notifications_enabled !== false;
  notificationDuration = settings.notification_duration || 5;
  applyTheme(currentTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(currentTheme);
  });

  await listen('settings-changed', async () => {
    const s = await getSettings();
    currentTheme = s.theme || 'auto';
    notificationsEnabled = s.notifications_enabled !== false;
    notificationDuration = s.notification_duration || 5;
    applyTheme(currentTheme);
  });

    document.getElementById('connect-btn')?.addEventListener('click', () => {
      connect();
    });
  document.getElementById('disconnect-btn')?.addEventListener('click', disconnect);

  document.getElementById('add-url-btn')?.addEventListener('click', () => {
    openAddWindow('url');
  });
  document.getElementById('add-magnet-btn')?.addEventListener('click', () => {
    openAddWindow('magnet');
  });
  document.getElementById('add-file-btn')?.addEventListener('click', () => {
    openAddWindow('file');
  });

  await listen('menu-connection-settings', () => {
    invoke('open_connection_settings_window').catch((error) => {
      console.error('Failed to open connection settings:', error);
    });
  });
  await listen('menu-add-url', () => {
    openAddWindow('url');
  });
  await listen('menu-add-magnet', () => {
    openAddWindow('magnet');
  });
  await listen('menu-add-file', () => {
    openAddWindow('file');
  });
  await listen('menu-play', () => {
    runTorrentAction('rpc_torrent_action', { action: 'start', ids: getSelectedIds() });
  });
  await listen('menu-pause', () => {
    runTorrentAction('rpc_torrent_action', { action: 'pause', ids: getSelectedIds() });
  });
  await listen('menu-delete', openDeleteWindow);
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
    if (label) label.lastChild.textContent = sortAscending ? ' ' + t('sort.asc') : ' ' + t('sort.desc');
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
  document.getElementById('delete-btn')?.addEventListener('click', openDeleteWindow);

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
      alert(`${t('error.toggle_speed')}: ` + error);
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

  document.getElementById('torrent-list')?.addEventListener('dblclick', async (e) => {
    const card = e.target.closest('.torrent-card');
    if (!card) return;
    try {
      await invoke('open_properties_window', { id: Number(card.dataset.id) });
    } catch (error) {
      console.error('Failed to open properties:', error);
    }
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
        openDeleteWindow();
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
      if (label) label.lastChild.textContent = sortAscending ? ' ' + t('sort.asc') : ' ' + t('sort.desc');
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

  document.getElementById('connection-settings-btn')?.addEventListener('click', () => {
    invoke('open_connection_settings_window').catch((error) => {
      console.error('Failed to open connection settings:', error);
    });
  });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    invoke('open_settings_window').catch((error) => {
      console.error('Failed to open settings:', error);
    });
  });
  await listen('torrents-update', (event) => {
    checkTorrentNotifications(event.payload);
    renderTorrents(event.payload);
  });

  await listen('session-stats-update', (event) => {
    updateTransferStats(event.payload);
  });

  await listen('alt-speed-update', (event) => {
    updateAltSpeedState(event.payload);
  });

  const cliFile = await invoke('get_cli_file');
  applyTranslations();
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

  await listen('menu-about', () => {
    invoke('open_about_window').catch((error) => {
      console.error('Failed to open about window:', error);
    });
  });
});
