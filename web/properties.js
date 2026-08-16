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
      const errorClass = label === 'Error' && t.error ? ' error-text' : '';
      return `<dt>${escapeHtml(label)}</dt><dd class="${errorClass.trim()}">${escapeHtml(value)}</dd>`;
    })
    .join('');
}

function buildTree(files) {
  const root = { name: '', children: [], size: 0, done: 0, isDir: true };
  for (const f of files) {
    const parts = f.name.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        const leaf = { name: part, children: [], size: f.length, done: f.bytes_completed, isDir: false };
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

function renderNode(parentUl, node, depth) {
  const li = document.createElement('li');
  li.className = node.isDir ? 'tree-dir' : '';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = depth * 18 + 8 + 'px';

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = node.isDir ? '▶' : '';

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
  row.appendChild(name);
  row.appendChild(size);
  row.appendChild(pct);
  li.appendChild(row);

  if (node.isDir) {
    const childrenUl = document.createElement('ul');
    childrenUl.className = 'tree-children';
    node.children.forEach(child => renderNode(childrenUl, child, depth + 1));
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = childrenUl.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
    });
    const wrap = document.createElement('div');
    wrap.appendChild(childrenUl);
    li.appendChild(wrap);
  }

  parentUl.appendChild(li);
}

function renderFiles(files) {
  const container = document.getElementById('properties-files');
  container.innerHTML = '';
  if (files.length === 0) {
    container.textContent = 'No file information available.';
    return;
  }
  const root = buildTree(files);
  const ul = document.createElement('ul');
  ul.className = 'tree';
  root.children.forEach(child => renderNode(ul, child, 0));
  container.appendChild(ul);
}

async function load() {
  applyTheme();
  const message = document.getElementById('properties-message');
  const content = document.getElementById('properties-content');
  try {
    const data = await invoke('get_properties_data');
    if (!data) {
      message.textContent = 'No torrent selected.';
      return;
    }
    renderDetails(data);
    renderFiles(data.files || []);
    message.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (error) {
    message.textContent = 'Failed to load torrent properties: ' + error;
  }
}

listen('properties-data', load).catch(() => {});
load();