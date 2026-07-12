const { invoke } = window.__TAURI__.core;

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('close-btn')?.addEventListener('click', async () => {
    try {
      await invoke('exit_app');
    } catch (error) {
      console.error('Failed to close app:', error);
    }
  });
  const cliFile = await invoke('get_cli_file');
  if (cliFile) {
    await openFileByPath(cliFile);
  } else {
    showPlaceholder();
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

  body.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    body.classList.remove('drag-over');
  });

  const { listen } = window.__TAURI__.event;
  await listen('tauri://drag-drop', async (event) => {
    body.classList.remove('drag-over');
    dragCounter = 0;
    const payload = event.payload;
    if (payload && payload.paths && payload.paths.length > 0) {
      const filePath = payload.paths[0];
      await openFileByPath(filePath);
    }
  });

  await listen('file-opened', async (event) => {
    if (event.payload) {
      const filePath = typeof event.payload === 'string' ? event.payload : event.payload.path;
      if (filePath) {
        await openFileByPath(filePath);
      }
    }
  });
});
