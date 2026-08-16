const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

function applyTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
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

function renderDetails(t) {
  const dl = document.getElementById('properties-info');
  const rows = [
    ['Date Added', formatDate(t.added_date)],
    ['ETA', formatEta(t.time_left)],
    ['Queue position', String(t.queue_position)],
    ['Percent done', formatPercent(t.percent_done)],
    ['Size', formatBytes(t.total_size)],
    ['Uploaded', formatBytes(t.uploaded_ever)],
    ['Downloaded', formatBytes(t.downloaded_ever)],
    ['Remaining', formatBytes(t.left_until_done)],
    ['Seeders', String(t.seeders)],
    ['Leechers', String(t.leechers)],
    ['State', t.status || '—'],
    ['Last activity', formatDate(t.last_activity)],
    ['Error', t.error && t.error_string ? t.error_string : 'None'],
    ['Name', t.name],
    ['Location', t.download_dir],
  ];
  dl.innerHTML = rows
    .map(([label, value]) => {
      const errorRow = label === 'Error' && t.error ? ' error-row' : '';
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
    check.disabled = fileSelectionUpdating;
    check.addEventListener('change', () => {
      check.indeterminate = false;
      const indices = collectLeafIndices(node, []);
      updateFileSelection(indices, check.checked, () => setSubtree(node, check.checked));
    });
  } else {
    check.checked = node.wanted;
    const fullyDownloaded = node.size > 0 && node.done >= node.size;
    check.disabled = fullyDownloaded || fileSelectionUpdating;
    check.title = fullyDownloaded ? 'Already downloaded' : '';
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
    container.textContent = 'No file information available.';
    return;
  }
  treeRoot = buildTree(files);
  renderTree(treeRoot);
}

async function load() {
  const revision = ++loadRevision;
  applyTheme();
  const message = document.getElementById('properties-message');
  const content = document.getElementById('properties-content');
  try {
    const id = await invoke('get_properties_torrent_id');
    if (id == null) {
      if (revision !== loadRevision) return;
      message.textContent = 'No torrent selected.';
      return;
    }
    const data = await invoke('rpc_get_torrent_details', { id });
    if (revision !== loadRevision) return;
    currentId = data.id;
    renderDetails(data);
    renderFiles(data.files || []);
    message.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (error) {
    if (revision !== loadRevision) return;
    message.textContent = 'Failed to load torrent properties: ' + error;
  }
}

listen('properties-data', load).catch(() => {});
load();
