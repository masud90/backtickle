import './styles/app.css';
import '@/styles/fonts';
import { mount } from 'svelte';
import { markDocumentOs } from '@/lib/os';
import { getPlatform } from '@/lib/platform';
import App from '@/shell/App.svelte';

// Before anything is drawn, so the style sheets can adapt to macOS, Windows or Linux at once.
markDocumentOs();

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount point');
}

try {
  const platform = await getPlatform();
  // First thing, before any other work: the start of the frontend for the measurement harness.
  platform.perfMark('frontend-init');
  // A hidden page (minimized or covered window, locked screen) holds back the first preview render
  // and slows timers, so a measurement taken like that is not valid. Tell the harness.
  if (document.visibilityState === 'hidden') platform.perfMark('page-hidden');
  document.body.dataset.platform = platform.kind;
  const launch = await platform.launchOptions();
  mount(App, { target, props: { platform, launch } });
} catch (error) {
  console.error(error);
  target.textContent = 'Writedown could not start. See the console for details.';
}
