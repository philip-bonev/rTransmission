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
let remoteSettings = null;

function setRemoteError(message) {
  const el = document.getElementById('session-error');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function setRemoteDisabled(disabled) {
  remoteInputIds.forEach(id => {
    document.getElementById(id).disabled = disabled;
  });
}

function readNumber(id, { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null } = {}) {
  const raw = document.getElementById(id).value.trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

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
    document.getElementById('notification-duration').value =
      settings.notification_duration ?? 5;
    document.getElementById('minimize-to-tray').checked = settings.minimize_to_tray !== false;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  try {
    connected = await invoke('is_connected');
  } catch {
    connected = false;
  }
  if (connected) {
    try {
      remoteSettings = await invoke('rpc_get_session_settings');
      document.getElementById('session-dl-queue-size').value = remoteSettings.download_queue_size;
      document.getElementById('session-seed-ratio-limit').value = remoteSettings.seed_ratio_limit;
      document.getElementById('session-idle-seeding-limit').value = remoteSettings.idle_seeding_limit;
      document.getElementById('session-speed-dl').value = remoteSettings.speed_limit_down;
      document.getElementById('session-speed-ul').value = remoteSettings.speed_limit_up;
      document.getElementById('session-alt-dl').value = remoteSettings.alt_speed_down;
      document.getElementById('session-alt-ul').value = remoteSettings.alt_speed_up;
      setRemoteDisabled(false);
      setRemoteError('');
    } catch (e) {
      console.error('Failed to load session settings:', e);
      remoteSettings = null;
      remoteInputIds.forEach(id => {
        document.getElementById(id).value = '';
      });
      setRemoteDisabled(true);
      setRemoteError(`${t('settings.remote_load_failed')} (${String(e)})`);
    }
  } else {
    remoteSettings = null;
    remoteInputIds.forEach(id => {
      document.getElementById(id).value = '';
    });
    setRemoteDisabled(true);
    setRemoteError('');
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
      duration = settings.notification_duration ?? 5;
    } catch {}
    invoke('send_notification', { title: 'rTransmission', body: t('notify.test'), duration });
  });

  bindPress(document.getElementById('settings-close-btn'), closeDialog);
  bindPress(document.getElementById('settings-cancel-btn'), closeDialog);

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
    const duration = readNumber('notification-duration', { integer: true, min: 0, max: 60, fallback: 5 });
    if (duration === null) {
      alert(t('settings.invalid_value'));
      return;
    }
    current.notification_duration = duration;
    current.minimize_to_tray = document.getElementById('minimize-to-tray').checked;

    const queueSize = connected
      ? readNumber('session-dl-queue-size', { integer: true, min: 1, max: 100 })
      : 0;
    const seedRatio = connected
      ? readNumber('session-seed-ratio-limit', { min: 0, max: 10000 })
      : 0;
    const idleLimit = connected
      ? readNumber('session-idle-seeding-limit', { integer: true, min: 1, max: 40320 })
      : 0;
    const speedDl = connected ? readNumber('session-speed-dl', { integer: true }) : 0;
    const speedUl = connected ? readNumber('session-speed-ul', { integer: true }) : 0;
    const altDl = connected ? readNumber('session-alt-dl', { integer: true }) : 0;
    const altUl = connected ? readNumber('session-alt-ul', { integer: true }) : 0;
    if (connected && [queueSize, seedRatio, idleLimit, speedDl, speedUl, altDl, altUl].includes(null)) {
      alert(t('settings.invalid_value'));
      return;
    }

    try {
      await invoke('set_settings', { newSettings: current });
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(`${t('error.save_settings')}: ` + error);
      return;
    }
    if (connected) {
      if (!remoteSettings) {
        alert(t('settings.remote_not_saved'));
        return;
      }
      const next = {
        download_queue_size: queueSize,
        download_queue_enabled: remoteSettings.download_queue_enabled,
        seed_ratio_limit: seedRatio,
        seed_ratio_limited: remoteSettings.seed_ratio_limited,
        idle_seeding_limit: idleLimit,
        idle_seeding_limit_enabled: remoteSettings.idle_seeding_limit_enabled,
        speed_limit_down: speedDl,
        speed_limit_down_enabled: speedDl === remoteSettings.speed_limit_down
          ? remoteSettings.speed_limit_down_enabled
          : speedDl > 0,
        speed_limit_up: speedUl,
        speed_limit_up_enabled: speedUl === remoteSettings.speed_limit_up
          ? remoteSettings.speed_limit_up_enabled
          : speedUl > 0,
        alt_speed_down: altDl,
        alt_speed_up: altUl,
      };
      try {
        await invoke('rpc_set_session_settings', { settings: next });
        remoteSettings = next;
      } catch (e) {
        console.error('Failed to save session settings:', e);
        setRemoteError(String(e));
        alert(`${t('error.save_settings')}: ` + e);
        return;
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
