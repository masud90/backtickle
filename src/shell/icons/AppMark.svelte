<script lang="ts">
  interface Props {
    variant: 'tile' | 'glyph';
    size?: number;
    class?: string;
  }

  // Sizes with a class in styles/a11y.css (10 to 24 px): they follow the interface scale.
  const iconSizes = new Set(Array.from({ length: 15 }, (_, i) => i + 10));

  let { variant, size = 16, class: extra }: Props = $props();
  const sizeClass = $derived(iconSizes.has(size) ? `wd-icon-${size}` : '');
  const classes = $derived([sizeClass, extra].filter(Boolean).join(' ') || undefined);
</script>

<!-- The backtick keycap app mark. The tile has the same geometry as
     src-tauri/icons/source/icon.svg; the glyph is its keycap outline and backtick in one color. -->
<svg
  width={size}
  height={size}
  class={classes}
  viewBox={variant === 'tile' ? '100 100 824 824' : '182 202 660 660'}
  aria-hidden="true"
  data-testid="app-mark"
  data-variant={variant}
>
  {#if variant === 'tile'}
    <g transform="translate(100 100) scale(0.8046875)">
      <rect width="1024" height="1024" rx="230" fill="#2B2D42" />
      <rect x="202" y="222" width="620" height="620" rx="110" fill="#9AA3B2" />
      <rect x="242" y="232" width="540" height="530" rx="86" fill="#F4F5F7" />
      <path
        d="M318 352 C346 314 374 314 402 340 S458 366 486 328"
        stroke="#2B2D42"
        stroke-width="30"
        stroke-linecap="round"
        fill="none"
      />
      <line x1="470" y1="440" x2="560" y2="610" stroke="#E5383B" stroke-width="84" stroke-linecap="round" />
    </g>
  {:else}
    <g fill="none" stroke="currentColor" stroke-linecap="round">
      <rect x="222" y="242" width="580" height="580" rx="110" stroke-width="64" />
      <line x1="470" y1="430" x2="560" y2="620" stroke-width="96" />
    </g>
  {/if}
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
  }
</style>
