import { describe, expect, it } from 'vitest';
import { ICONS } from '@/shell/icons/index';

describe('Icon rendering', () => {
  it('should have no outer svg tags in ICONS values', () => {
    for (const [_name, content] of Object.entries(ICONS)) {
      expect(content).not.toContain('<svg');
      expect(content).not.toContain('</svg>');
    }
  });

  it('should have path elements in all ICONS values', () => {
    for (const [_name, content] of Object.entries(ICONS)) {
      expect(content).toContain('<path');
    }
  });
});
