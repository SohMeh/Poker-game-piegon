import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installAudioUnlock } from './lib/sound';
import { initNetwork, initRouter } from './net/room';
// Bundled rounded UI font: every device without Apple's rounded system font gets the same
// glyph widths, so the table layout (which reserves space for pot chips, seat plates and
// labels) renders identically on Android, desktop and CI.
import '@fontsource-variable/nunito/wght.css';
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
