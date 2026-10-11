/**
 * Harness page for the preview tests: mounts the pipeline and the controller on a text and exposes
 * them on `window.__harness`. Playwright drives it with `page.evaluate`.
 */
import type { FlavorId } from '@/flavors';
import { PreviewController, type RenderInfo } from '@/preview/controller';
import { loadPipeline } from '@/preview/pipeline';
import type { Pipeline, RenderResult } from '@/preview/types';
import '@/styles/tokens.css';
import '@/preview/preview.css';

interface MountOptions {
  text?: string;
  url?: string;
  flavor?: FlavorId;
  /** Source of local images to the address that should be used for it. */
  images?: Record<string, string>;
  /** Do not render yet. */
  manual?: boolean;
  sliceMs?: number;
}

interface Timings {
  bytes: number;
  blocks: number;
  /** Start of the render to the first slice painted. */
  firstSliceMs: number;
  /** Start of the render to everything in the page and settled. */
  fullMs: number;
  /** Sync cost of the parse, render and first slice (reported by the controller). */
  firstRenderMs: number;
  /** One edit in the middle to the update painted. */
  updateMs: number;
  /** Sync cost of that update as reported by the controller. */
  updateRenderMs: number;
  replacedBlocks: number;
  keptBlocks: number;
}

const article = document.getElementById('preview') as HTMLElement;

let controller: PreviewController | undefined;
let pipeline: Pipeline | undefined;
let text = '';
const reports: RenderInfo[] = [];
let lastResult: RenderResult | undefined;

function paint(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  });
}

async function loadText(options: MountOptions): Promise<string> {
  if (options.text !== undefined) return options.text;
  if (options.url) return (await fetch(options.url)).text();
  return '';
}

async function mount(options: MountOptions = {}): Promise<void> {
  controller?.dispose();
  article.replaceChildren();
  reports.length = 0;
  text = await loadText(options);
  pipeline = await loadPipeline(options.flavor ?? 'gfm');
  const images = options.images ?? {};
  controller = new PreviewController({
    container: article,
    getSource: () => text,
    pipeline,
    sliceMs: options.sliceMs,
    resolveImage: async (source) => {
      const address = images[source];
      if (address === undefined) throw new Error(`no image: ${source}`);
      return address;
    },
    onRendered: (info) => {
      reports.push(info);
      if (info.result) lastResult = info.result;
    },
  });
  if (!options.manual) controller.renderNow();
}

function wrappers(): HTMLElement[] {
  return Array.from(article.children) as HTMLElement[];
}

async function perf(url: string): Promise<Timings> {
  await mount({ url, manual: true });
  const c = controller as PreviewController;
  const bytes = new TextEncoder().encode(text).length;

  const start = performance.now();
  c.renderNow();
  const firstRenderMs = reports[0]?.renderMs ?? 0;
  const firstPainted = (await paint()) - start;
  await c.whenSettled();
  const full = performance.now() - start;
  await paint();

  // One edit in the middle of the document: a word added to a paragraph.
  const lines = text.split('\n');
  let index = Math.floor(lines.length / 2);
  while (index < lines.length && !/^[A-Z]/.test(lines[index] ?? '')) index++;
  lines[index] = `${lines[index]} edited`;
  const before = wrappers();
  text = lines.join('\n');
  reports.length = 0;
  const editStart = performance.now();
  c.renderNow();
  const updateRenderMs = reports[0]?.renderMs ?? 0;
  const updatePainted = (await paint()) - editStart;
  await c.whenSettled();
  const after = wrappers();
  const kept = after.filter((el) => before.includes(el)).length;

  return {
    bytes,
    blocks: after.length,
    firstSliceMs: firstPainted,
    fullMs: full,
    firstRenderMs,
    updateMs: updatePainted,
    updateRenderMs,
    replacedBlocks: before.length - kept + Math.max(0, after.length - before.length),
    keptBlocks: kept,
  };
}

const harness = {
  mount,
  perf,
  article,
  get controller() {
    return controller as PreviewController;
  },
  get pipeline() {
    return pipeline as Pipeline;
  },
  get reports() {
    return reports;
  },
  get result() {
    return lastResult;
  },
  get text() {
    return text;
  },
  setText(next: string) {
    text = next;
    controller?.renderNow();
  },
  wrappers,
  settled: () => controller?.whenSettled() ?? Promise.resolve(),
};

declare global {
  interface Window {
    __harness: typeof harness;
    __XSS_SENTINEL__?: unknown;
  }
}

window.__harness = harness;
const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme') ?? '';
