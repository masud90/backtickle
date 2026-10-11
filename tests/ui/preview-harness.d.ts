/** The shape of `window.__harness` that tests/harness/preview.ts exposes, as the UI specs see it. */
export {};

declare global {
  interface PreviewTimings {
    bytes: number;
    blocks: number;
    firstSliceMs: number;
    fullMs: number;
    firstRenderMs: number;
    updateMs: number;
    updateRenderMs: number;
    replacedBlocks: number;
    keptBlocks: number;
  }

  interface PreviewHarness {
    mount(options?: {
      text?: string;
      url?: string;
      flavor?: string;
      images?: Record<string, string>;
      manual?: boolean;
      sliceMs?: number;
    }): Promise<void>;
    perf(url: string): Promise<PreviewTimings>;
    controller: {
      highlightLine(line: number | null): void;
      revealHeading(id: string): void;
      completeNow(): void;
    };
    result?: {
      features: { math: boolean; languages: string[] };
      headings: Array<{ level: number; text: string; id: string; line: number }>;
    };
    text: string;
    setText(next: string): void;
    wrappers(): HTMLElement[];
    settled(): Promise<void>;
  }

  interface Window {
    __harness: PreviewHarness;
    __XSS_SENTINEL__?: unknown;
  }
}
