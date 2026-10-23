import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatAge } from './format-age.js';

describe('formatAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    const now = Date.now();
    expect(formatAge(now)).toBe('just now');
    expect(formatAge(now - 30_000)).toBe('just now');
    expect(formatAge(now - 59_000)).toBe('just now');
  });

  it('returns minutes for timestamps 1-59 minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    const now = Date.now();
    expect(formatAge(now - 60_000)).toBe('1m ago');
    expect(formatAge(now - 5 * 60_000)).toBe('5m ago');
    expect(formatAge(now - 59 * 60_000)).toBe('59m ago');
  });

  it('returns hours for timestamps 1-23 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    const now = Date.now();
    expect(formatAge(now - 60 * 60_000)).toBe('1h ago');
    expect(formatAge(now - 3 * 60 * 60_000)).toBe('3h ago');
    expect(formatAge(now - 23 * 60 * 60_000)).toBe('23h ago');
  });

  it('returns days for timestamps 1-29 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    const now = Date.now();
    expect(formatAge(now - 24 * 60 * 60_000)).toBe('1d ago');
    expect(formatAge(now - 7 * 24 * 60 * 60_000)).toBe('7d ago');
    expect(formatAge(now - 29 * 24 * 60 * 60_000)).toBe('29d ago');
  });

  it('returns months for timestamps 30+ days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
    const now = Date.now();
    expect(formatAge(now - 30 * 24 * 60 * 60_000)).toBe('1mo ago');
    expect(formatAge(now - 90 * 24 * 60 * 60_000)).toBe('3mo ago');
  });

  it('returns empty string for falsy timestamps', () => {
    expect(formatAge(0)).toBe('');
    expect(formatAge(undefined as any)).toBe('');
  });
});
