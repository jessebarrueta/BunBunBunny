import { describe, expect, it } from 'vitest';
import { isSwipeUp } from './gesture';

describe('isSwipeUp', () => {
  it('accepts only an upward drag that clears the exit threshold', () => {
    expect(isSwipeUp(300, 228)).toBe(true);
    expect(isSwipeUp(300, 229)).toBe(false);
    expect(isSwipeUp(228, 300)).toBe(false);
  });
});
