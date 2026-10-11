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

function toggleAuthFields() {
  const checked = document.getElementById('rpc-auth').checked;
  document.getElementById('auth-fields').classList.toggle('hidden', !checked);
}

window.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  applyTranslations();

  try {
    const settings = await invoke('get_settings');
    document.getElementById('rpc-host').value = settings.rpc_host;
    document.getElementById('rpc-port').value = settings.rpc_port;
    document.getElementById('rpc-auth').checked = settings.rpc_auth;
    document.getElementById('rpc-username').value = settings.rpc_username;
    document.getElementById('rpc-password').value = settings.rpc_password;
    document.getElementById('rpc-https').checked = settings.rpc_https;
    document.getElementById('rpc-insecure').checked = settings.rpc_insecure;
    document.getElementById('rpc-auto-connect').checked = settings.auto_connect;
    toggleAuthFields();
  } catch (error) {
    console.error('Failed to load settings:', error);
  }

  document.getElementById('rpc-auth').addEventListener('change', toggleAuthFields);

  document.getElementById('connection-settings-close-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });
  document.getElementById('connection-settings-cancel-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });

  document.getElementById('connection-settings-form').addEventListener('submit', async (e) => {
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
    try {
      await invoke('set_settings', { newSettings: settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(`${t('error.save_settings')}: ` + error);
      return;
    }
    closeDialog();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
    }
  });
});
