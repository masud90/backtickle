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

<!-- The B3 (Hanging) app mark; the same geometry as src-tauri/icons/source/icon.svg. -->
<svg
  width={size}
  height={size}
  class={classes}
  viewBox={variant === 'tile' ? '100 100 824 824' : '212 232 600 568'}
  aria-hidden="true"
  data-testid="app-mark"
  data-variant={variant}
>
  {#if variant === 'tile'}
    <rect x="100" y="100" width="824" height="824" rx="185" fill="#0058bc" />
  {/if}
  <g fill={variant === 'tile' ? '#ffffff' : 'currentColor'}>
    <rect x="212" y="232" width="600" height="72" />
    <rect x="336" y="304" width="72" height="266" />
    <polygon points="232,560 512,560 372,800" />
    <rect x="616" y="304" width="72" height="266" />
    <polygon points="512,560 792,560 652,800" />
  </g>
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
  }
</style>
