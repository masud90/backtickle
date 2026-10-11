import '../styles/app.css';
import '@/styles/fonts';
import { mount } from 'svelte';
import { getPlatform } from '@/lib/platform';
import { whenSettled } from '@/perf/marks';
import Prefs from '@/prefs/Prefs.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount point');
}

try {
  const platform = await getPlatform();
  document.body.dataset.platform = platform.kind;
  mount(Prefs, { target, props: { platform } });
  // For the measurement harness: this window is drawn and at rest. Does nothing unless the app
  // runs with WRITEDOWN_PERF=1.
  void whenSettled().then(() => platform.perfMark('prefs-ready'));
} catch (error) {
  console.error(error);
  target.textContent = 'Preferences could not start. See the console for details.';
}
