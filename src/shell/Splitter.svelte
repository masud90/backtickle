<script lang="ts">
  import { DEFAULT_RATIO, KEY_STEP, clampRatio, ratioFromPointer } from './split';

  interface Props {
    /** The editor's share of the width, between 0 and 1. */
    ratio: number;
    onChange: (ratio: number) => void;
  }

  let { ratio, onChange }: Props = $props();

  let element: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  /** The splitter's parent is the grid that holds both panes. */
  function gridRect(): DOMRect | undefined {
    return element?.parentElement?.getBoundingClientRect();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !element) return;
    element.setPointerCapture(event.pointerId);
    dragging = true;
    event.preventDefault(); // no text selection while dragging
  }

  function onPointerMove(event: PointerEvent) {
    const rect = gridRect();
    if (!dragging || !rect) return;
    onChange(ratioFromPointer(event.clientX, rect.left, rect.width));
  }

  function onPointerEnd(event: PointerEvent) {
    dragging = false;
    if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent) {
    const width = gridRect()?.width ?? 0;
    if (event.key === 'ArrowLeft') onChange(clampRatio(ratio - KEY_STEP, width));
    else if (event.key === 'ArrowRight') onChange(clampRatio(ratio + KEY_STEP, width));
    else if (event.key === 'Enter' || event.key === 'Home') onChange(DEFAULT_RATIO);
    else return;
    event.preventDefault();
  }
</script>

<!--
  The WAI-ARIA "window splitter": a focusable separator. Drag, arrow keys, or double-click for
  50/50. Svelte's checker treats every separator as non-interactive, which is wrong for a splitter.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={element}
  data-testid="splitter"
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize editor and preview"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(ratio * 100)}
  tabindex="0"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerEnd}
  onpointercancel={onPointerEnd}
  ondblclick={() => onChange(DEFAULT_RATIO)}
  onkeydown={onKeyDown}
  data-dragging={dragging}
  class="group relative z-10 -mx-[9px] flex cursor-col-resize touch-none select-none justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
>
  <!-- The visible line stays 6 px wide; the element around it is the 24 px hit area (WCAG 2.5.8). -->
  <div
    data-testid="splitter-line"
    class="flex w-1.5 items-center justify-center border-x border-outline-variant/30 bg-surface-container-high transition-colors group-hover:bg-primary/30 group-data-[dragging=true]:bg-primary/30"
  >
    <span
      class="h-6 w-0.5 rounded-full bg-outline/40 group-hover:bg-primary group-data-[dragging=true]:bg-primary"
      aria-hidden="true"
    ></span>
  </div>
</div>
