import { describe, expect, it } from 'vitest';
import { earlyBy } from './time.js';

describe('earlyBy', () => {
  it('reads days and hours, or hours and minutes under a day', () => {
    expect(earlyBy('2026-11-01T01:15:00Z', '2026-10-29T10:39:00Z')).toBe('2d 14h');
    expect(earlyBy('2026-10-29T15:00:00Z', '2026-10-29T09:40:00Z')).toBe('5h 20m');
  });
  it('is null when filed late or there is no deadline', () => {
    expect(earlyBy('2026-10-29T09:00:00Z', '2026-10-29T10:00:00Z')).toBeNull();
    expect(earlyBy(null, '2026-10-29T10:00:00Z')).toBeNull();
  });
});
