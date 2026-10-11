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

let deleteIds = [];

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

function applyIds(ids) {
  deleteIds = Array.isArray(ids) ? ids : [];
  const count = deleteIds.length;
  document.getElementById('delete-count').textContent =
    count === 1 ? t('delete.confirm_one') : t('delete.confirm_many', { count });
  document.getElementById('delete-data-checkbox').checked = false;
}

window.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  applyTranslations();

  document.getElementById('delete-close-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });
  document.getElementById('delete-cancel-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });

  document.getElementById('delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const deleteData = document.getElementById('delete-data-checkbox').checked;
    const ids = deleteIds.slice();
    if (ids.length === 0) {
      closeDialog();
      return;
    }
    try {
      await invoke('rpc_torrent_remove', { ids, deleteData });
    } catch (error) {
      console.error('Action failed:', error);
      alert(`${t('error.action_failed')}: ` + error);
    }
    closeDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  });

  try {
    const ids = await invoke('get_delete_ids');
    applyIds(ids);
  } catch (error) {
    console.error('Failed to load delete ids:', error);
  }

  listen('delete-data', (event) => {
    applyIds(event.payload);
  }).catch(() => {});
});
