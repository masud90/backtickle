// @vitest-environment jsdom
/**
 * Inputs that are only learned after other inputs arrive (a nested include, an include cycle,
 * the bibliography named in `_quarto.yml`) are fetched and rendered without an edit.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedText } from "@/lib/platform";
import type { Pipeline } from "@/preview/types";
import { ContextFetcher } from "@/shell/context";

const FIXTURES = resolve(__dirname, "../fixtures/flavors");
const DIR = resolve(FIXTURES, "quarto");

/** Paths as the backend sends them to the page: `/` separated on Windows too. */
const pagePath = (path: string) => path.replace(/\\/g, "/");

function reader() {
  return {
    readLinkedText: vi.fn(
      async (from: string, href: string): Promise<LinkedText> => {
        const path = pagePath(resolve(dirname(from), href));
        return { path, text: readFileSync(path, "utf8") };
      },
    ),
    vaultIndex: vi.fn(async () => null),
    quartoProject: vi.fn(async (from: string): Promise<LinkedText | null> => {
      const path = pagePath(resolve(dirname(from), "_quarto.yml"));
      try {
        return { path, text: readFileSync(path, "utf8") };
      } catch {
        return null;
      }
    }),
  };
}

/** Plays the shell: render, and render again each time something arrives. */
async function settle(pipeline: Pipeline, file: string) {
  const path = pagePath(resolve(DIR, file));
  const source = readFileSync(path, "utf8");
  const files = reader();
  let renders = 0;
  let html = "";
  let fetcher: ContextFetcher;
  const draw = () => {
    renders++;
    const context = fetcher.contextFor(1, pipeline, () => source, path);
    html = pipeline
      .render(source, context)
      .blocks.map((block) => block.html)
      .join("\n");
  };
  fetcher = new ContextFetcher(files, () => draw());
  draw();
  let reads = -1;
  while (reads !== files.readLinkedText.mock.calls.length) {
    reads = files.readLinkedText.mock.calls.length;
    await new Promise((done) => setTimeout(done, 50));
  }
  return { html, renders, files };
}

describe("inputs found after other inputs arrive", () => {
  let pipeline: Pipeline;
  beforeEach(async () => {
    vi.resetModules();
    const { createQuartoPipeline } = await import("@/preview/packs/quarto");
    pipeline = createQuartoPipeline();
  });

  it("renders a nested include (part A includes part B) without an edit", async () => {
    const { html } = await settle(pipeline, "shortcodes.qmd");
    expect(html).toContain("This is content from part A.");
    expect(html).toContain("This is content from part B.");
  });

  it("settles on an include cycle", async () => {
    const { html, files, renders } = await settle(pipeline, "cycle.qmd");
    expect(html).toContain("Content of cycle X.");
    // Each file is read once; nothing loops.
    expect(files.readLinkedText).toHaveBeenCalledTimes(2);
    expect(renders).toBeLessThan(12);
  });

  it("fetches the bibliography named in _quarto.yml without an edit", async () => {
    const { html, files } = await settle(pipeline, "project/chapter.qmd");
    expect(files.readLinkedText.mock.calls.map((call) => call[1])).toEqual([
      "../../pandoc/refs.bib",
    ]);
    expect(html).toContain('data-cites="smith2020"');
    expect(html).not.toContain("citation-missing");
  });
});
