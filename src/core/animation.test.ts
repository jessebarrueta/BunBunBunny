import { describe, expect, it } from 'vitest';
import { easeInOutCubic } from './animation';

describe('easeInOutCubic', () => {
  it('eases between clamped endpoints through the midpoint', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(2)).toBe(1);
  });
});
