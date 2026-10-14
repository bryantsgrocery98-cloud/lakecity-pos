import { describe, expect, it } from 'vitest';
import { workdayFor } from './workday.js';

describe('workday cutoff', () => {
  const tz = 'America/New_York';
  it('uses the calendar day when the workday starts at midnight', () => {
    // 2026-10-12 01:30 EDT = 05:30 UTC
    expect(workdayFor(new Date('2026-10-12T05:30:00Z'), tz, '00:00')).toBe('2026-10-12');
  });
  it('puts an early-morning sale on the previous workday when the day starts later', () => {
    expect(workdayFor(new Date('2026-10-12T05:30:00Z'), tz, '04:00')).toBe('2026-10-11');
    expect(workdayFor(new Date('2026-10-12T08:30:00Z'), tz, '04:00')).toBe('2026-10-12'); // 4:30 AM EDT
  });
  it('handles month boundaries', () => {
    expect(workdayFor(new Date('2026-11-01T05:30:00Z'), tz, '04:00')).toBe('2026-10-31');
  });
});
