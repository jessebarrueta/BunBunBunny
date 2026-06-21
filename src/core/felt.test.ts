import { describe, expect, it } from 'vitest';
import { isFuzzyColor } from './felt';

describe('isFuzzyColor', () => {
  it('selects saturated pink and cyan while excluding neutral materials', () => {
    expect(isFuzzyColor(230, 80, 140)).toBe(true);
    expect(isFuzzyColor(60, 170, 235)).toBe(true);
    expect(isFuzzyColor(20, 20, 20)).toBe(false);
    expect(isFuzzyColor(240, 240, 240)).toBe(false);
  });
});
