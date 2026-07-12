const { invoke } = window.__TAURI__.core;

let currentFilePath = null;

const closeBtn = document.getElementById('close-btn');

function updateFileName(name) {
  fileName.textContent = name;
}

async function closeApp() {
  try {
    await invoke('exit_app');
  } catch (error) {
    console.error('Failed to close app:', error);
  }
}

closeBtn?.addEventListener('click', closeApp);

window.addEventListener('DOMContentLoaded', async () => {
  const cliFile = await invoke('get_cli_file');
  if (cliFile) {
    await openFileByPath(cliFile);
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
