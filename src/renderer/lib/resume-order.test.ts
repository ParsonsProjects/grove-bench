import { describe, it, expect } from 'vitest';
import { orderTabsForResume } from './resume-order.js';

describe('orderTabsForResume', () => {
  it('puts the active tab first and keeps the rest in persisted order', () => {
    expect(orderTabsForResume(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('keeps persisted order when there is no active tab', () => {
    expect(orderTabsForResume(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('keeps persisted order when the active tab is not among the open tabs', () => {
    expect(orderTabsForResume(['a', 'b'], 'zzz')).toEqual(['a', 'b']);
  });

  it('drops duplicate ids', () => {
    expect(orderTabsForResume(['a', 'b', 'a'], 'b')).toEqual(['b', 'a']);
  });

  it('handles an empty list', () => {
    expect(orderTabsForResume([], 'a')).toEqual([]);
  });
});
