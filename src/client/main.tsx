import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAudioUnlock } from './lib/sound';
import { initNetwork, initRouter } from './net/room';
import './styles/base.css';
import './styles/screens.css';
import './styles/table.css';
import './styles/menu.css';

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const mock = params.get('mock');
  installAudioUnlock();
  if (mock) {
    // Visual QA fixtures; loaded on demand so they never ship in the main bundle.
    const { installMock } = await import('./mock/installMock');
    installMock(mock);
  } else {
    initNetwork();
    initRouter();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
