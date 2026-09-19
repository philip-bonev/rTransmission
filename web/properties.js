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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatPercent(fraction) {
  if (fraction == null) return '—';
  return (fraction * 100).toFixed(1) + '%';
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function formatEta(seconds) {
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

function renderDetails(torrent) {
  const dl = document.getElementById('properties-info');
  const rows = [
    [t('prop.date_added'), formatDate(torrent.added_date)],
    [t('prop.eta'), formatEta(torrent.time_left)],
    [t('prop.queue'), String(torrent.queue_position)],
    [t('prop.percent_done'), formatPercent(torrent.percent_done)],
    [t('prop.size'), formatBytes(torrent.total_size)],
    [t('prop.uploaded'), formatBytes(torrent.uploaded_ever)],
    [t('prop.downloaded'), formatBytes(torrent.downloaded_ever)],
    [t('prop.remaining'), formatBytes(torrent.left_until_done)],
    [t('prop.seeders'), String(torrent.seeders)],
    [t('prop.leechers'), String(torrent.leechers)],
    [t('prop.state'), t('status.' + torrent.status) || torrent.status || '—'],
    [t('prop.last_activity'), formatDate(torrent.last_activity)],
    [t('prop.error'), torrent.error && torrent.error_string ? torrent.error_string : t('prop.none')],
    [t('prop.name'), torrent.name],
    [t('prop.location'), torrent.download_dir],
  ];
  dl.innerHTML = rows
    .map(([label, value]) => {
      const errorRow = label === t('prop.error') && torrent.error ? ' error-row' : '';
      return (
        `<div class="info-row${errorRow}">` +
        `<span class="info-label">${escapeHtml(label)}</span>` +
        `<span class="info-value">${escapeHtml(value)}</span>` +
        `</div>`
      );
    })
    .join('');
}

let currentId = null;
let loadRevision = 0;

function buildTree(files) {
  const root = { name: '', children: [], size: 0, done: 0, isDir: true };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const parts = f.name.split('/').filter(Boolean);
    let node = root;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      const isLeaf = j === parts.length - 1;
      if (isLeaf) {
        const leaf = {
          name: part,
          children: [],
          size: f.length,
          done: f.bytes_completed,
          wanted: !!f.wanted,
          index: i,
          isDir: false,
        };
        node.children.push(leaf);
        node = leaf;
      } else {
        let child = node.children.find(c => c.isDir && c.name === part);
        if (!child) {
          child = { name: part, children: [], size: 0, done: 0, isDir: true };
          node.children.push(child);
        }
        node = child;
      }
    }
  }
  aggregateSizes(root);
  refreshFolderStates(root);
  return root;
}

function aggregateSizes(node) {
  if (!node.isDir) return;
  let size = 0;
  let done = 0;
  for (const c of node.children) {
    aggregateSizes(c);
    size += c.size;
    done += c.done;
  }
  node.size = size;
  node.done = done;
}

function refreshFolderStates(node) {
  if (!node.isDir) return;
  let any = false;
  let all = true;
  for (const c of node.children) {
    if (c.isDir) {
      refreshFolderStates(c);
      all = all && c.allWanted;
      any = any || c.anyWanted;
    } else {
      all = all && c.wanted;
      any = any || c.wanted;
    }
  }
  node.allWanted = all;
  node.anyWanted = any;
}

function collectLeafIndices(node, out) {
  for (const c of node.children) {
    if (c.isDir) {
      collectLeafIndices(c, out);
    } else {
      out.push(c.index);
    }
  }
  return out;
}

async function setFilesWanted(indices, wanted) {
  if (!indices.length) return true;
  const payload = wanted
    ? { id: currentId, wanted: indices, unwanted: [] }
    : { id: currentId, wanted: [], unwanted: indices };
  try {
    await invoke('rpc_set_files_wanted', payload);
    return true;
  } catch (error) {
    console.error('Failed to update file selection:', error);
    alert('Failed to update file selection: ' + error);
    return false;
  }
}

let fileSelectionUpdating = false;

async function updateFileSelection(indices, wanted, apply) {
  if (fileSelectionUpdating) return;
  fileSelectionUpdating = true;
  document.querySelectorAll('.tree-check').forEach(check => {
    check.disabled = true;
  });
  if (await setFilesWanted(indices, wanted)) {
    apply();
    refreshFolderStates(treeRoot);
  }
  fileSelectionUpdating = false;
  renderTree(treeRoot);
}

const collapsedDirs = new Set();

function renderNode(parentUl, node, depth, path) {
  const li = document.createElement('li');
  li.className = node.isDir ? 'tree-dir' : '';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = depth * 18 + 8 + 'px';

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = node.isDir ? '▶' : '';
  const nodePath = path ? path + '/' + node.name : node.name;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'tree-check';

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = node.name;
  name.title = node.name;

  const size = document.createElement('span');
  size.className = 'tree-size';
  size.textContent = formatBytes(node.size);

  const pct = document.createElement('span');
  pct.className = 'tree-percent';
  const fraction = node.size > 0 ? node.done / node.size : 1;
  pct.textContent = formatPercent(fraction);

  row.appendChild(toggle);
  row.appendChild(check);
  row.appendChild(name);
  row.appendChild(size);
  row.appendChild(pct);
  li.appendChild(row);

  if (node.isDir) {
    check.checked = node.allWanted;
    if (node.anyWanted && !node.allWanted) {
      check.indeterminate = true;
    }
    const dirFullyDownloaded = node.size > 0 && node.done >= node.size;
    check.disabled = dirFullyDownloaded || fileSelectionUpdating;
    check.title = dirFullyDownloaded ? t('prop.downloaded_already') : '';
    check.addEventListener('change', () => {
      check.indeterminate = false;
      const indices = collectLeafIndices(node, []);
      updateFileSelection(indices, check.checked, () => setSubtree(node, check.checked));
    });
  } else {
    check.checked = node.wanted;
    const fullyDownloaded = node.size > 0 && node.done >= node.size;
    check.disabled = fullyDownloaded || fileSelectionUpdating;
    check.title = fullyDownloaded ? t('prop.downloaded_already') : '';
    check.addEventListener('change', () => {
      updateFileSelection([node.index], check.checked, () => {
        node.wanted = check.checked;
      });
    });
  }

  if (node.isDir) {
    const childrenUl = document.createElement('ul');
    childrenUl.className = 'tree-children';
    const isCollapsed = collapsedDirs.has(nodePath);
    if (isCollapsed) {
      childrenUl.classList.add('collapsed');
      toggle.textContent = '▶';
    } else {
      toggle.textContent = '▼';
    }
    node.children.forEach(child => renderNode(childrenUl, child, depth + 1, nodePath));
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowCollapsed = childrenUl.classList.toggle('collapsed');
      toggle.textContent = nowCollapsed ? '▶' : '▼';
      if (nowCollapsed) {
        collapsedDirs.add(nodePath);
      } else {
        collapsedDirs.delete(nodePath);
      }
    });
    const wrap = document.createElement('div');
    wrap.appendChild(childrenUl);
    li.appendChild(wrap);
  }

  parentUl.appendChild(li);
}

function setSubtree(node, wanted) {
  for (const c of node.children) {
    if (c.isDir) {
      setSubtree(c, wanted);
    } else {
      c.wanted = wanted;
    }
  }
}

let treeRoot = null;

function renderTree(root) {
  const container = document.getElementById('properties-files');
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'tree';
  root.children.forEach(child => renderNode(ul, child, 0, ''));
  container.appendChild(ul);
}

function renderFiles(files) {
  const container = document.getElementById('properties-files');
  container.innerHTML = '';
  if (files.length === 0) {
    container.textContent = t('prop.no_files');
    return;
  }
  treeRoot = buildTree(files);
  renderTree(treeRoot);
}

async function load() {
  const revision = ++loadRevision;
  await applyTheme();
  const message = document.getElementById('properties-message');
  const content = document.getElementById('properties-content');
  try {
    const id = await invoke('get_properties_torrent_id');
    if (id == null) {
      if (revision !== loadRevision) return;
      message.textContent = t('prop.no_torrent');
      return;
    }
    const data = await invoke('rpc_get_torrent_details', { id });
    if (revision !== loadRevision) return;
    currentId = data.id;
    torrentDownloadDir = data.download_dir || '';
    renderDetails(data);
    renderFiles(data.files || []);
    message.classList.add('hidden');
    content.classList.remove('hidden');
    applyTranslations();
  } catch (error) {
    if (revision !== loadRevision) return;
    message.textContent = t('prop.load_failed') + ': ' + error;
  }
}

function initTabs() {
  const tabs = document.querySelectorAll('.properties-tab');
  const panels = {
    details: document.getElementById('properties-top-panel'),
    files: document.getElementById('properties-bottom-panel'),
  };
  tabs.forEach(tab => {
    tab.addEventListener('mousedown', (e) => {
      e.preventDefault();
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      for (const [name, panel] of Object.entries(panels)) {
        panel.classList.toggle('hidden-tab', name !== tab.dataset.tab);
      }
    });
  });
}

initTabs();

let torrentDownloadDir = '';

let currentTreePath = null;

function showFileConfirm(title, message, defaultValue) {
  const overlay = document.getElementById('file-confirm-overlay');
  const titleEl = document.getElementById('file-confirm-title');
  const msgEl = document.getElementById('file-confirm-message');
  const inputEl = document.getElementById('file-confirm-input');
  const okBtn = document.getElementById('file-confirm-ok');
  const cancelBtn = document.getElementById('file-confirm-cancel');

  titleEl.textContent = title;
  msgEl.textContent = message;

  if (defaultValue !== undefined) {
    inputEl.classList.remove('hidden');
    inputEl.value = defaultValue;
  } else {
    inputEl.classList.add('hidden');
  }

  overlay.classList.remove('hidden');

  return new Promise((resolve) => {
    let settled = false;

    function cleanup() {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('mousedown', onOk);
      cancelBtn.removeEventListener('mousedown', onCancel);
      overlay.removeEventListener('mousedown', onBackdrop);
    }

    function onOk(e) {
      e.preventDefault();
      e.stopPropagation();
      if (settled) return;
      settled = true;
      const val = defaultValue !== undefined ? inputEl.value.trim() : null;
      cleanup();
      resolve({ ok: true, value: val });
    }

    function onCancel(e) {
      e.preventDefault();
      e.stopPropagation();
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false });
    }

    function onBackdrop(e) {
      if (e.target === overlay) {
        onCancel(e);
      }
    }

    okBtn.addEventListener('mousedown', onOk);
    cancelBtn.addEventListener('mousedown', onCancel);
    overlay.addEventListener('mousedown', onBackdrop);

    if (defaultValue !== undefined) {
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 0);
    }
  });
}

function showFileStatus(message) {
  const msgEl = document.getElementById('file-confirm-message');
  msgEl.textContent = message;
  document.getElementById('file-confirm-input').classList.add('hidden');
  document.getElementById('file-confirm-ok').classList.add('hidden');
  document.getElementById('file-confirm-cancel').classList.add('hidden');
}

function hideFileStatus() {
  document.getElementById('file-confirm-ok').classList.remove('hidden');
  document.getElementById('file-confirm-cancel').classList.remove('hidden');
}

async function runFileOp(fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    await showFileConfirm(t('file_op.error'), String(error));
    return false;
  }
}

function getDownloadDir() {
  return torrentDownloadDir || '';
}

async function fileOpRename(fullPath, oldName) {
  const res = await showFileConfirm(t('file_op.rename'), t('file_op.rename_msg'), oldName);
  if (!res.ok) return;
  const newName = res.value;
  if (!newName || newName === oldName) return;

  const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  const newPath = parentDir + '/' + newName;
  showFileStatus(t('file_op.renaming'));
  await runFileOp(() => invoke('file_rename', { oldPath: fullPath, newPath }));
  hideFileStatus();
  await load();
}

async function fileOpDelete(fullPath, name) {
  const res = await showFileConfirm(t('file_op.delete'), t('file_op.delete_msg', { name }));
  if (!res.ok) return;
  showFileStatus(t('file_op.deleting'));
  await runFileOp(() => invoke('file_delete', { path: fullPath }));
  hideFileStatus();
  await load();
}

async function fileOpMove(fullPath) {
  const res = await showFileConfirm(t('file_op.move'), t('file_op.move_msg'), fullPath);
  if (!res.ok) return;
  const dest = res.value;
  if (!dest || dest === fullPath) return;
  showFileStatus(t('file_op.moving'));
  await runFileOp(() => invoke('file_move', { source: fullPath, destination: dest }));
  hideFileStatus();
  await load();
}

async function fileOpCopyPath(fullPath) {
  try {
    await navigator.clipboard.writeText(fullPath);
  } catch {
    await showFileConfirm(t('file_op.copy_path'), t('file_op.copy_failed'));
  }
}

function showFileContextMenu(e, nodePath, isDir) {
  e.preventDefault();
  e.stopPropagation();
  currentTreePath = nodePath;
  const menu = document.getElementById('file-context-menu');
  menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect();
  const px = Math.max(4, Math.min(e.clientX, window.innerWidth - rect.width - 4));
  const py = Math.max(4, Math.min(e.clientY, window.innerHeight - rect.height - 4));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
}

function closeFileContextMenu() {
  document.getElementById('file-context-menu').classList.add('hidden');
  currentTreePath = null;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('properties-files')?.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const li = row.closest('li');
    const isDir = li && li.classList.contains('tree-dir');
    const nameEl = row.querySelector('.tree-name');
    if (!nameEl) return;
    const name = nameEl.textContent;

    let nodePath = name;
    let parent = row.parentElement;
    while (parent && parent.closest('.tree-children')) {
      const parentDir = parent.closest('li');
      if (parentDir) {
        const parentNameEl = parentDir.querySelector('.tree-name');
        if (parentNameEl) nodePath = parentNameEl.textContent + '/' + nodePath;
      }
      parent = parent.parentElement;
    }

    showFileContextMenu(e, nodePath, isDir);
  });

  document.getElementById('file-context-menu')?.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.file-context-item');
    if (!item) return;
    e.preventDefault();
    const action = item.dataset.action;
    const path = currentTreePath;
    closeFileContextMenu();
    if (!path) return;

    const fullPath = getDownloadDir() + '/' + path;
    const parts = path.split('/');
    const name = parts[parts.length - 1];

    switch (action) {
      case 'rename':
        fileOpRename(fullPath, name);
        break;
      case 'copy':
        fileOpCopyPath(fullPath);
        break;
      case 'move':
        fileOpMove(fullPath);
        break;
      case 'delete':
        fileOpDelete(fullPath, name);
        break;
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#file-context-menu')) closeFileContextMenu();
  });

  window.addEventListener('blur', closeFileContextMenu);
});

listen('properties-data', load).catch(() => {});
load();
