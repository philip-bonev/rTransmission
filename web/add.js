/*
 * Copyright 2026 Philip Bonev
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;

let connected = false;
let currentMode = 'url';
let locationActiveIndex = -1;
let freeSpaceTimer = null;

async function applyTheme() {
  let theme = 'auto';
  try {
    const settings = await invoke('get_settings');
    theme = settings.theme || 'auto';
  } catch {}
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

async function closeDialog() {
  try {
    await invoke('close_dialog_window');
  } catch (error) {
    console.error('Failed to close window:', error);
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
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

function modeStrings(mode) {
  switch (mode) {
    case 'magnet':
      return {
        title: t('add.title_magnet'),
        label: t('add.label_magnet'),
        placeholder: 'magnet:?xt=urn:btih:...',
        browse: false,
      };
    case 'file':
      return {
        title: t('add.title_file'),
        label: t('add.label_file'),
        placeholder: '/path/to/file.torrent',
        browse: true,
      };
    default:
      return {
        title: t('add.title_url'),
        label: t('add.label_url'),
        placeholder: 'https://example.com/file.torrent',
        browse: false,
      };
  }
}

async function applyPayload(payload) {
  if (!payload) return;
  currentMode = payload.mode || 'url';
  connected = !!payload.connected;
  const s = modeStrings(currentMode);
  document.getElementById('add-dialog-title').textContent = s.title;
  document.getElementById('add-input-label').textContent = s.label;
  const input = document.getElementById('add-input');
  input.placeholder = s.placeholder;
  input.value = payload.prefill || '';
  document.getElementById('add-browse-btn').classList.toggle('hidden', !s.browse);
  try {
    const { getCurrentWindow } = window.__TAURI__.window;
    await getCurrentWindow().setTitle(s.title);
  } catch {}
  let defaultDir = '';
  try {
    const settings = await invoke('get_settings');
    defaultDir = settings.default_download_dir || '';
  } catch {}
  document.getElementById('add-download-dir').value = defaultDir;
  dirOptions = Array.isArray(payload.dirs) ? payload.dirs : [];
  renderLocationOptions();
  clearAddError();
  updateFreeSpace();
  input.focus();
}

let dirOptions = [];

function getLastDownloadDirs() {
  try {
    const raw = localStorage.getItem('lastDownloadDirs');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLastDownloadDir(dir) {
  const list = getLastDownloadDirs().filter(d => d !== dir);
  list.unshift(dir);
  localStorage.setItem('lastDownloadDirs', JSON.stringify(list.slice(0, 10)));
}

function getDownloadDirOptions() {
  const seen = new Map();
  for (const dir of getLastDownloadDirs()) {
    if (dir) seen.set(dir, true);
  }
  for (const dir of dirOptions) {
    if (dir) seen.set(dir, true);
  }
  return Array.from(seen.keys());
}

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

function updateFreeSpace() {
  const el = document.getElementById('add-free-space');
  const path = document.getElementById('add-download-dir').value.trim();
  if (!path || !connected) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = t('add.checking_free_space');
  invoke('rpc_get_free_space', { path })
    .then(bytes => {
      el.textContent = `${t('add.free_space')}: ${formatBytes(bytes)}`;
      el.classList.remove('hidden');
    })
    .catch(() => {
      el.textContent = '';
      el.classList.add('hidden');
    });
}

async function addTorrent(input, downloadDir = null, pauseAfterMetadata = false) {
  if (!connected) {
    showAddError(t('error.connect_first'));
    return false;
  }
  try {
    await invoke('validate_torrent_input', { input });
  } catch (error) {
    showAddError(String(error || t('error.invalid_input')));
    return false;
  }
  try {
    await invoke('rpc_add_torrent', { input, downloadDir, pauseAfterMetadata });
    return true;
  } catch (error) {
    showAddError(String(error || t('error.add_failed')));
    return false;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  applyTranslations();

  document.getElementById('add-close-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });
  document.getElementById('add-cancel-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });

  document.getElementById('add-browse-btn').addEventListener('click', async () => {
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

  document.getElementById('add-input').addEventListener('input', clearAddError);

  const downloadDirInput = document.getElementById('add-download-dir');
  downloadDirInput.addEventListener('focus', openLocationOptions);
  downloadDirInput.addEventListener('input', () => {
    openLocationOptions();
    clearTimeout(freeSpaceTimer);
    freeSpaceTimer = setTimeout(updateFreeSpace, 400);
  });
  downloadDirInput.addEventListener('blur', closeLocationOptions);
  downloadDirInput.addEventListener('keydown', (e) => {
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
      e.stopPropagation();
      closeLocationOptions();
    }
  });

  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = document.getElementById('add-input').value.trim();
    if (!value) {
      showAddError(t('add.empty_input'));
      return;
    }
    clearAddError();
    const downloadDir = document.getElementById('add-download-dir').value.trim() || null;
    if (downloadDir) saveLastDownloadDir(downloadDir);
    const pauseAfterMetadata = document.getElementById('add-pause-after-metadata').checked;
    const ok = await addTorrent(value, downloadDir, pauseAfterMetadata);
    if (ok) closeDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  });

  try {
    const payload = await invoke('get_add_payload');
    await applyPayload(payload);
  } catch (error) {
    console.error('Failed to load add payload:', error);
  }

  listen('add-data', (event) => {
    applyPayload(event.payload);
  }).catch(() => {});
});
