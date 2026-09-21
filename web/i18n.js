const en = {
  // Window titles
  'app_title': 'rTransmission Client',
  'properties_title': 'Torrent Properties',

  // Toolbar tooltips
  'toolbar.connect': 'Connect',
  'toolbar.disconnect': 'Disconnect',
  'toolbar.add_url': 'Add torrent by URL',
  'toolbar.add_file': 'Add torrent file',
  'toolbar.add_magnet': 'Add magnet link',
  'toolbar.start': 'Start selected torrents',
  'toolbar.pause': 'Pause selected torrents',
  'toolbar.delete': 'Delete selected torrents',
  'toolbar.verify': 'Verify selected torrents',
  'toolbar.properties': 'Show selected torrent properties',
  'toolbar.queue_top': 'Move selected torrents to top of queue',
  'toolbar.queue_up': 'Move selected torrents up in queue',
  'toolbar.queue_down': 'Move selected torrents down in queue',
  'toolbar.queue_bottom': 'Move selected torrents to bottom of queue',
  'toolbar.filter': 'Filter torrents by state',
  'toolbar.sort': 'Sort torrents',
  'toolbar.sort_dir': 'Toggle ascending/descending',
  'toolbar.alt_speed': 'Toggle slow/fast speed limits',
  'toolbar.settings': 'Settings',
  'toolbar.connection': 'Connection Settings',

  // Filter select
  'filter.all': 'All states',
  'filter.downloading': 'Downloading',
  'filter.paused': 'Paused',
  'filter.seeding': 'Seeding',
  'filter.verifying': 'Verifying',
  'filter.finished': 'Finished',

  // Sort select
  'sort.queue': 'Queue',
  'sort.date': 'Date',
  'sort.size': 'Size',
  'sort.name': 'Name',
  'sort.seeders': 'Seeders',
  'sort.leechers': 'Leechers',

  // Sort direction
  'sort.asc': ' Asc',
  'sort.desc': ' Desc',

  // Empty state
  'empty.disconnected': 'Connect to a Transmission daemon to get started',
  'empty.queue': 'Torrent queue is empty.',
  'empty.no_torrents': 'Torrent queue is empty.',
  'empty.no_match': 'No torrents match the selected filter',

  // Status bar
  'status.connected': '● Connected',
  'status.disconnected': '● Disconnected',
  'status.slow': '· Slow mode: ',

  // Torrent card
  'card.queue': 'Queue',
  'card.time_left': 'Time left',
  'card.seeders': 'Se',
  'card.leechers': 'Le',
  'card.done': 'Done',
  'card.error': 'Error',

  // Torrent status translations
  'status.Downloading': 'Downloading',
  'status.Seeding': 'Seeding',
  'status.Stopped': 'Stopped',
  'status.Checking': 'Checking',
  'status.Waiting to download': 'Waiting to download',
  'status.Waiting to seed': 'Waiting to seed',
  'status.Waiting to check': 'Waiting to check',
  'status.total': 'Total',

  // Torrent card (alternate keys used by main.js)
  'time.done': 'Done',
  'torrent.queue': 'Queue',
  'torrent.time_left': 'Time left',
  'torrent.seeders_short': 'Se',
  'torrent.leechers_short': 'Le',
  'status.error': 'Error',

  // Connection Settings dialog
  'conn.title': 'Connection Settings',
  'conn.host': 'Host',
  'conn.port': 'Port',
  'conn.auth': 'Authentication required',
  'conn.username': 'Username',
  'conn.password': 'Password',
  'conn.https': 'Use HTTPS (TLS)',
  'conn.insecure': 'Ignore invalid certificates',
  'conn.auto_connect': 'Connect automatically on startup',

  // Add Torrent dialog
  'add.title': 'Add Torrent',
  'add.title_url': 'Add Torrent URL',
  'add.title_magnet': 'Add Magnet Link',
  'add.title_file': 'Add Torrent File',
  'add.label_url': 'URL',
  'add.label_magnet': 'Magnet link',
  'add.label_file': 'Torrent file',
  'add.location': 'Download location (optional)',
  'add.pause': 'Pause after metadata is downloaded',
  'add.browse': 'Browse',
  'add.checking_free': 'Checking free space\u2026',
  'add.checking_free_space': 'Checking free space\u2026',
  'add.free_space': 'Free space: ',
  'add.empty_input': 'Enter a URL, magnet link, or torrent file path',

  // Delete dialog
  'delete.title': 'Delete Torrent',
  'delete.confirm_one': 'Delete the selected torrent?',
  'delete.confirm_many': 'Delete the {count} selected torrents?',
  'delete.data': 'Also delete downloaded data',

  // Settings dialog
  'settings.title': 'Settings',
  'settings.download_dir': 'Default download location',
  'settings.theme': 'Theme',
  'settings.theme_auto': 'Auto (follow system)',
  'settings.theme_light': 'Light',
  'settings.theme_dark': 'Dark',
  'settings.notifications': 'Show notifications when torrents finish',
  'settings.notification_duration': 'Notification duration (seconds, 0 = system default)',
  'settings.test_notification': 'Test notification',
  'settings.minimize_to_tray': 'Minimize to system tray when closing',
  'settings.queue': 'Queue',
  'settings.dl_queue': 'Download queue size',
  'settings.seed_ratio': 'Stop seeding at ratio',
  'settings.idle_seed': 'Stop seeding if idle for (min)',
  'settings.speed_limits': 'Speed Limits',
  'settings.dl_speed': 'Download speed limit (KB/s, 0 = unlimited)',
  'settings.ul_speed': 'Upload speed limit (KB/s, 0 = unlimited)',
  'settings.alt_speeds': 'Alternate Speed Limits',
  'settings.alt_dl': 'Download (KB/s)',
  'settings.alt_ul': 'Upload (KB/s)',

  // Context menu
  'ctx.play': 'Play',
  'ctx.pause': 'Pause',
  'ctx.delete': 'Delete',
  'ctx.verify': 'Verify',
  'ctx.filter': 'Filter',
  'ctx.sort': 'Sort',
  'ctx.all': 'All',
  'ctx.ascending': 'Ascending',
  'ctx.descending': 'Descending',

  // Properties window
  'props.loading': 'Loading\u2026',
  'props.tab_details': 'Details',
  'props.tab_files': 'Files',
  'props.panel_details': 'Torrent details',
  'props.panel_files': 'Files',
  'props.no_selection': 'No torrent selected.',
  'props.load_error': 'Failed to load torrent properties: ',
  'props.no_files': 'No file information available.',
  'props.downloaded': 'Already downloaded',

  // Properties window (HTML keys)
  'properties.loading': 'Loading\u2026',
  'properties.tab_details': 'Details',
  'properties.tab_files': 'Files',
  'properties.details_header': 'Torrent details',
  'properties.files_header': 'Files',

  // Properties detail labels
  'props.date_added': 'Date Added',
  'props.eta': 'ETA',
  'props.queue_pos': 'Queue position',
  'props.percent_done': 'Percent done',
  'props.size': 'Size',
  'props.uploaded': 'Uploaded',
  'props.downloaded_label': 'Downloaded',
  'props.remaining': 'Remaining',
  'props.seeders': 'Seeders',
  'props.leechers': 'Leechers',
  'props.state': 'State',
  'props.last_activity': 'Last activity',
  'props.error': 'Error',
  'props.name': 'Name',
  'props.location': 'Location',
  'props.no_error': 'None',

  // Properties detail labels (alternate keys used by properties.js)
  'prop.date_added': 'Date Added',
  'prop.eta': 'ETA',
  'prop.queue': 'Queue position',
  'prop.percent_done': 'Percent done',
  'prop.size': 'Size',
  'prop.uploaded': 'Uploaded',
  'prop.downloaded': 'Downloaded',
  'prop.remaining': 'Remaining',
  'prop.seeders': 'Seeders',
  'prop.leechers': 'Leechers',
  'prop.state': 'State',
  'prop.last_activity': 'Last activity',
  'prop.error': 'Error',
  'prop.name': 'Name',
  'prop.location': 'Location',
  'prop.none': 'None',
  'prop.downloaded_already': 'Already downloaded',
  'prop.no_files': 'No file information available.',
  'prop.no_torrent': 'No torrent selected.',
  'prop.load_failed': 'Failed to load torrent properties',

  // Common buttons
  'btn.cancel': 'Cancel',
  'btn.save': 'Save',
  'btn.add': 'Add',
  'btn.delete': 'Delete',

  // Errors
  'error.connect_first': 'Connect to a Transmission daemon first',
  'error.invalid_input': 'Invalid torrent input',
  'error.add_failed': 'Failed to add torrent',
  'error.enter_url': 'Enter a URL, magnet link, or torrent file path',
  'error.file_not_exist': 'File does not exist: ',
  'error.connect_failed': 'Connection failed: ',
  'error.connection_failed': 'Connection failed',
  'error.action_failed': 'Action failed: ',
  'error.alt_speed_failed': 'Failed to toggle speed mode: ',
  'error.toggle_speed': 'Failed to toggle speed mode',
  'error.settings_save_failed': 'Failed to save remote settings: ',
  'error.save_settings': 'Failed to save remote settings',
  'error.file_select_failed': 'Failed to update file selection: ',

  // File picker
  'file_picker.torrent': 'Torrent files',

  // Common buttons
  'btn.ok': 'OK',

  // File operations
  'file_op.rename': 'Rename',
  'file_op.copy_path': 'Copy Path',
  'file_op.move': 'Move to…',
  'file_op.delete': 'Delete',
  'file_op.error': 'Operation failed',
  'file_op.rename_msg': 'Enter new name:',
  'file_op.renaming': 'Renaming\u2026',
  'file_op.delete_msg': 'Delete "{name}"?',
  'file_op.deleting': 'Deleting\u2026',
  'file_op.move_msg': 'Enter destination path:',
  'file_op.moving': 'Moving\u2026',
  'file_op.copy_failed': 'Failed to copy path to clipboard',

  // About dialog
  'about.title': 'About rTransmission Client',
  'about.build_date': 'Build date',

  // Notifications
  'notify.download_done': '"{name}" finished downloading',
  'notify.seeding_done': '"{name}" finished seeding',
  'notify.test': 'This is a test notification',
};

const bg = {
  'app_title': 'rTransmission Клиент',
  'properties_title': 'Настройки на торента',

  'toolbar.connect': 'Свързване',
  'toolbar.disconnect': 'Прекъсване',
  'toolbar.add_url': 'Добави торент по URL',
  'toolbar.add_file': 'Добави торент файл',
  'toolbar.add_magnet': 'Добави магнит линк',
  'toolbar.start': 'Стартирай избраните торенти',
  'toolbar.pause': 'Паузирай избраните торенти',
  'toolbar.delete': 'Изтрий избраните торенти',
  'toolbar.verify': 'Провери избраните торенти',
  'toolbar.properties': 'Покажи настройки на избрания торент',
  'toolbar.queue_top': 'Премести избраните на върха на опашката',
  'toolbar.queue_up': 'Премести избраните нагоре в опашката',
  'toolbar.queue_down': 'Премести избраните надолу в опашката',
  'toolbar.queue_bottom': 'Премести избраните на дъното на опашката',
  'toolbar.filter': 'Филтър по състояние',
  'toolbar.sort': 'Сортиране',
  'toolbar.sort_dir': 'Низходящ/Възходящ ред',
  'toolbar.alt_speed': 'Превключване на бавен/бърз режим',
  'toolbar.settings': 'Настройки',
  'toolbar.connection': 'Настройки на връзката',

  'filter.all': 'Всички състояния',
  'filter.downloading': 'Сваляне',
  'filter.paused': 'Паузирано',
  'filter.seeding': 'Споделяне',
  'filter.verifying': 'Проверка',
  'filter.finished': 'Завършено',

  'sort.queue': 'Опашка',
  'sort.date': 'Дата',
  'sort.size': 'Размер',
  'sort.name': 'Име',
  'sort.seeders': 'Сийдъри',
  'sort.leechers': 'Лийчъри',

  'sort.asc': ' Възходящ',
  'sort.desc': ' Низходящ',

  'empty.disconnected': 'Свържете се с Transmission daemon за да започнете',
  'empty.queue': 'Опашката е празна.',
  'empty.no_torrents': 'Опашката е празна.',
  'empty.no_match': 'Няма торенти, отговарящи на филтъра',

  'status.connected': '● Свързан',
  'status.disconnected': '● Несвързан',
  'status.slow': '· Бавен режим: ',

  'card.queue': 'Опашка',
  'card.time_left': 'Остава',
  'card.seeders': 'Сй',
  'card.leechers': 'Лй',
  'card.done': 'Готово',
  'card.error': 'Грешка',

  'status.Downloading': 'Сваляне',
  'status.Seeding': 'Споделяне',
  'status.Stopped': 'Спряно',
  'status.Checking': 'Проверка',
  'status.Waiting to download': 'Изчакване за сваляне',
  'status.Waiting to seed': 'Изчакване за споделяне',
  'status.Waiting to check': 'Изчакване за проверка',
  'status.total': 'Общо',

  'time.done': 'Готово',
  'torrent.queue': 'Опашка',
  'torrent.time_left': 'Остава',
  'torrent.seeders_short': 'Сй',
  'torrent.leechers_short': 'Лй',
  'status.error': 'Грешка',

  'conn.title': 'Настройки на връзката',
  'conn.host': 'Хост',
  'conn.port': 'Порт',
  'conn.auth': 'Изисква се удостоверяване',
  'conn.username': 'Потребителско име',
  'conn.password': 'Парола',
  'conn.https': 'Използвай HTTPS (TLS)',
  'conn.insecure': 'Игнорирай невалидни сертификати',
  'conn.auto_connect': 'Автоматично свързване при стартиране',

  'add.title': 'Добави торент',
  'add.title_url': 'Добави торент по URL',
  'add.title_magnet': 'Добави магнит линк',
  'add.title_file': 'Добави торент файл',
  'add.label_url': 'URL',
  'add.label_magnet': 'Магнит линк',
  'add.label_file': 'Торент файл',
  'add.location': 'Място за сваляне (незадължително)',
  'add.pause': 'Паузирай след сваляне на метаданните',
  'add.browse': 'Избор',
  'add.checking_free': 'Проверка на свободно място\u2026',
  'add.checking_free_space': 'Проверка на свободно място\u2026',
  'add.free_space': 'Свободно място: ',
  'add.empty_input': 'Въведете URL, магнит линк или път до торент файл',

  'delete.title': 'Изтриване на торент',
  'delete.confirm_one': 'Изтрийте избрания торент?',
  'delete.confirm_many': 'Изтрийте {count} избрани торента?',
  'delete.data': 'Изтрий и свалените данни',

  'settings.title': 'Настройки',
  'settings.download_dir': 'Папка по подразбиране за сваляне',
  'settings.theme': 'Тема',
  'settings.theme_auto': 'Автоматично (следвай системата)',
  'settings.theme_light': 'Светла',
  'settings.theme_dark': 'Тъмна',
  'settings.notifications': 'Показвай нотификации при завършване на торенти',
  'settings.notification_duration': 'Времетраене на нотификациите (секунди, 0 = по подразбиране)',
  'settings.test_notification': 'Тестова нотификация',
  'settings.minimize_to_tray': 'Минимизирай в system tray при затваряне',
  'settings.queue': 'Опашка',
  'settings.dl_queue': 'Размер на опашката за сваляне',
  'settings.seed_ratio': 'Спри споделянето при коефициент',
  'settings.idle_seed': 'Спри споделянето при бездействие (мин)',
  'settings.speed_limits': 'Лимити на скоростта',
  'settings.dl_speed': 'Лимит на сваляне (KB/s, 0 = без лимит)',
  'settings.ul_speed': 'Лимит на качване (KB/s, 0 = без лимит)',
  'settings.alt_speeds': 'Алтернативни лимити',
  'settings.alt_dl': 'Сваляне (KB/s)',
  'settings.alt_ul': 'Качване (KB/s)',

  'ctx.play': 'Старт',
  'ctx.pause': 'Пауза',
  'ctx.delete': 'Изтриване',
  'ctx.verify': 'Проверка',
  'ctx.filter': 'Филтър',
  'ctx.sort': 'Сортиране',
  'ctx.all': 'Всички',
  'ctx.ascending': 'Възходящ',
  'ctx.descending': 'Низходящ',

  'props.loading': 'Зареждане\u2026',
  'props.tab_details': 'Подробности',
  'props.tab_files': 'Файлове',
  'props.panel_details': 'Подробности за торента',
  'props.panel_files': 'Файлове',
  'props.no_selection': 'Няма избран торент.',
  'props.load_error': 'Грешка при зареждане: ',
  'props.no_files': 'Няма информация за файлове.',
  'props.downloaded': 'Вече е свалено',

  'properties.loading': 'Зареждане\u2026',
  'properties.tab_details': 'Подробности',
  'properties.tab_files': 'Файлове',
  'properties.details_header': 'Подробности за торента',
  'properties.files_header': 'Файлове',

  'props.date_added': 'Дата на добавяне',
  'props.eta': 'Остава',
  'props.queue_pos': 'Позиция в опашката',
  'props.percent_done': 'Процент готовност',
  'props.size': 'Размер',
  'props.uploaded': 'Качено',
  'props.downloaded_label': 'Свалено',
  'props.remaining': 'Оставащо',
  'props.seeders': 'Сийдъри',
  'props.leechers': 'Лийчъри',
  'props.state': 'Състояние',
  'props.last_activity': 'Последна активност',
  'props.error': 'Грешка',
  'props.name': 'Име',
  'props.location': 'Място',
  'props.no_error': 'Няма',

  'prop.date_added': 'Дата на добавяне',
  'prop.eta': 'Остава',
  'prop.queue': 'Позиция в опашката',
  'prop.percent_done': 'Процент готовност',
  'prop.size': 'Размер',
  'prop.uploaded': 'Качено',
  'prop.downloaded': 'Свалено',
  'prop.remaining': 'Оставащо',
  'prop.seeders': 'Сийдъри',
  'prop.leechers': 'Лийчъри',
  'prop.state': 'Състояние',
  'prop.last_activity': 'Последна активност',
  'prop.error': 'Грешка',
  'prop.name': 'Име',
  'prop.location': 'Място',
  'prop.none': 'Няма',
  'prop.downloaded_already': 'Вече е свалено',
  'prop.no_files': 'Няма информация за файлове.',
  'prop.no_torrent': 'Няма избран торент.',
  'prop.load_failed': 'Грешка при зареждане',

  'btn.cancel': 'Отказ',
  'btn.save': 'Запис',
  'btn.add': 'Добави',
  'btn.delete': 'Изтриване',

  'error.connect_first': 'Първо се свържете с Transmission daemon',
  'error.invalid_input': 'Невалиден торент вход',
  'error.add_failed': 'Грешка при добавяне на торент',
  'error.enter_url': 'Въведете URL, магнит линк или път до торент файл',
  'error.file_not_exist': 'Файлът не съществува: ',
  'error.connect_failed': 'Грешка при свързване: ',
  'error.connection_failed': 'Грешка при свързване',
  'error.action_failed': 'Грешка при действие: ',
  'error.alt_speed_failed': 'Грешка при превключване на скоростта: ',
  'error.toggle_speed': 'Грешка при превключване на скоростта',
  'error.settings_save_failed': 'Грешка при запис на настройките: ',
  'error.save_settings': 'Грешка при запис на настройките',
  'error.file_select_failed': 'Грешка при избор на файл: ',

  'file_picker.torrent': 'Торент файлове',

  'btn.ok': 'OK',

  'file_op.rename': 'Преименувай',
  'file_op.copy_path': 'Копирай път',
  'file_op.move': 'Премести към\u2026',
  'file_op.delete': 'Изтрий',
  'file_op.error': 'Грешка при операция',
  'file_op.rename_msg': 'Въведете ново име:',
  'file_op.renaming': 'Преименуване\u2026',
  'file_op.delete_msg': 'Изтрийте "{name}"?',
  'file_op.deleting': 'Изтриване\u2026',
  'file_op.move_msg': 'Въведете път за местене:',
  'file_op.moving': 'Местене\u2026',
  'file_op.copy_failed': 'Грешка при копиране на път',

  'about.title': 'Относно rTransmission Client',
  'about.build_date': 'Дата на компилация',

  // Notifications
  'notify.download_done': '"{name}" завърши свалянето',
  'notify.seeding_done': '"{name}" завърши споделянето',
  'notify.test': 'Това е тестова нотификация',
};

const langs = { en, bg };

let currentLang = 'en';
try {
  const nav = navigator.language || '';
  currentLang = nav.startsWith('bg') ? 'bg' : 'en';
} catch {}

function t(key, vars) {
  let str = (langs[currentLang] && langs[currentLang][key]) || en[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    }
  }
  return str;
}

function applyTranslations(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
}
