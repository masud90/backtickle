import { describe, expect, it } from 'vitest';
import { applyA11y, clampScale, resolveSwitch } from '@/shell/appearance';
import { DEFAULT_SETTINGS_FOR_TESTS } from './a11y-helpers';

describe('interface scale', () => {
  it('clamps to 1.0 to 1.5 on the 0.1 grid', () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(1.26)).toBe(1.3);
    expect(clampScale(9)).toBe(1.5);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('resolveSwitch', () => {
  it('system follows the media query; on and off decide', () => {
    expect(resolveSwitch('system', true)).toBe(true);
    expect(resolveSwitch('system', false)).toBe(false);
    expect(resolveSwitch('on', false)).toBe(true);
    expect(resolveSwitch('off', true)).toBe(false);
  });
});

describe('applyA11y', () => {
  it('leaves no attribute with the defaults and sets them for each switch', () => {
    const root = document.createElement('html');
    const base = DEFAULT_SETTINGS_FOR_TESTS();
    applyA11y(root, base);
    for (const name of [
      'data-scaled',
      'data-motion',
      'data-contrast',
      'data-dyslexia',
      'data-ruler',
    ])
      expect(root.hasAttribute(name), name).toBe(false);
    applyA11y(root, {
      ...base,
      a11y: {
        ...base.a11y,
        reduceMotion: 'on',
        highContrast: 'on',
        scale: 1.5,
        ruler: true,
        rulerTint: 'pink',
      },
    });
    expect(root.getAttribute('data-motion')).toBe('reduce');
    expect(root.getAttribute('data-contrast')).toBe('more');
    expect(root.hasAttribute('data-scaled')).toBe(true);
    expect(root.style.getPropertyValue('--wd-scale')).toBe('1.5');
    expect(root.getAttribute('data-ruler-tint')).toBe('pink');
  });
});
