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

const remoteInputIds = [
  'session-dl-queue-size', 'session-seed-ratio-limit', 'session-idle-seeding-limit',
  'session-speed-dl', 'session-speed-ul', 'session-alt-dl', 'session-alt-ul',
];

let connected = false;

async function applyTheme(theme) {
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

async function loadTheme() {
  let theme = 'auto';
  try {
    const settings = await invoke('get_settings');
    theme = settings.theme || 'auto';
  } catch {}
  await applyTheme(theme);
}

async function closeDialog() {
  try {
    await invoke('close_dialog_window');
  } catch (error) {
    console.error('Failed to close window:', error);
  }
}

async function load() {
  await loadTheme();
  try {
    const settings = await invoke('get_settings');
    document.getElementById('default-download-dir').value = settings.default_download_dir || '';
    document.getElementById('theme-select').value = settings.theme || 'auto';
    document.getElementById('notifications-enabled').checked = settings.notifications_enabled !== false;
    document.getElementById('notification-duration').value = settings.notification_duration || 5;
    document.getElementById('minimize-to-tray').checked = settings.minimize_to_tray !== false;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  try {
    connected = await invoke('is_connected');
  } catch {
    connected = false;
  }
  remoteInputIds.forEach(id => {
    document.getElementById(id).disabled = !connected;
  });
  if (connected) {
    try {
      const ss = await invoke('rpc_get_session_settings');
      document.getElementById('session-dl-queue-size').value = ss.download_queue_size;
      document.getElementById('session-seed-ratio-limit').value = ss.seed_ratio_limit;
      document.getElementById('session-idle-seeding-limit').value = ss.idle_seeding_limit;
      document.getElementById('session-speed-dl').value = ss.speed_limit_down;
      document.getElementById('session-speed-ul').value = ss.speed_limit_up;
      document.getElementById('session-alt-dl').value = ss.alt_speed_down;
      document.getElementById('session-alt-ul').value = ss.alt_speed_up;
    } catch (e) {
      console.error('Failed to load session settings:', e);
    }
  } else {
    remoteInputIds.forEach(id => {
      document.getElementById(id).value = '';
    });
  }
  applyTranslations();
}

window.addEventListener('DOMContentLoaded', async () => {
  await load();

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
  });

  document.getElementById('test-notification-btn').addEventListener('click', async () => {
    let duration = 5;
    try {
      const settings = await invoke('get_settings');
      duration = settings.notification_duration || 5;
    } catch {}
    invoke('send_notification', { title: 'rTransmission', body: t('notify.test'), duration });
  });

  document.getElementById('settings-close-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });
  document.getElementById('settings-cancel-btn').addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeDialog();
  });

  document.getElementById('settings-save-btn').addEventListener('click', async () => {
    let current;
    try {
      current = await invoke('get_settings');
    } catch (error) {
      console.error('Failed to load settings:', error);
      return;
    }
    current.default_download_dir =
      document.getElementById('default-download-dir').value.trim() || null;
    current.theme = document.getElementById('theme-select').value;
    current.notifications_enabled = document.getElementById('notifications-enabled').checked;
    current.notification_duration = parseInt(document.getElementById('notification-duration').value) || 5;
    current.minimize_to_tray = document.getElementById('minimize-to-tray').checked;
    try {
      await invoke('set_settings', { newSettings: current });
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(`${t('error.save_settings')}: ` + error);
      return;
    }
    if (connected) {
      try {
        const speedDl = parseInt(document.getElementById('session-speed-dl').value) || 0;
        const speedUl = parseInt(document.getElementById('session-speed-ul').value) || 0;
        await invoke('rpc_set_session_settings', {
          settings: {
            download_queue_size: parseInt(document.getElementById('session-dl-queue-size').value) || 5,
            download_queue_enabled: true,
            seed_ratio_limit: parseFloat(document.getElementById('session-seed-ratio-limit').value) || 2.0,
            seed_ratio_limited: true,
            idle_seeding_limit: parseInt(document.getElementById('session-idle-seeding-limit').value) || 30,
            idle_seeding_limit_enabled: true,
            speed_limit_down: speedDl,
            speed_limit_down_enabled: speedDl > 0,
            speed_limit_up: speedUl,
            speed_limit_up_enabled: speedUl > 0,
            alt_speed_down: parseInt(document.getElementById('session-alt-dl').value) || 50,
            alt_speed_up: parseInt(document.getElementById('session-alt-ul').value) || 50,
          },
        });
      } catch (e) {
        console.error('Failed to save session settings:', e);
        alert(`${t('error.save_settings')}: ` + e);
      }
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
