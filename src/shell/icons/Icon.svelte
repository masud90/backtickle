<script lang="ts">
  import { ICONS, type IconName } from './index';

  interface Props {
    name: IconName;
    size?: number;
    label?: string;
  }

  // Sizes with a class in styles/a11y.css (10 to 24 px): they follow the interface scale.
  const iconSizes = new Set(Array.from({ length: 15 }, (_, i) => i + 10));

  let { name, size = 16, label }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  class={iconSizes.has(size) ? `wd-icon-${size}` : undefined}
  viewBox="0 -960 960 960"
  fill="currentColor"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {@html ICONS[name]}
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
  }
</style>
