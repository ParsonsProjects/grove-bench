import { describe, it, expect } from 'vitest';
import { topics, type HelpTopic } from './index.js';

describe('help topics', () => {
  it('exports a non-empty array of topics', () => {
    expect(topics.length).toBeGreaterThan(0);
  });

  it('every topic has required fields', () => {
    for (const topic of topics) {
      expect(topic.id).toBeTruthy();
      expect(topic.title).toBeTruthy();
      expect(topic.section).toBeTruthy();
      expect(topic.content).toBeTruthy();
    }
  });

  it('every topic id is unique', () => {
    const ids = topics.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every topic content contains markdown heading', () => {
    for (const topic of topics) {
      expect(topic.content).toMatch(/^# .+/m);
    }
  });

  it('has expected sections', () => {
    const sections = [...new Set(topics.map(t => t.section))];
    expect(sections).toContain('Getting Started');
    expect(sections).toContain('Interface');
    expect(sections).toContain('Features');
  });

  it('contains the session states topic', () => {
    const sessionStates = topics.find(t => t.id === 'session-states');
    expect(sessionStates).toBeDefined();
    expect(sessionStates!.content).toContain('Ready');
    expect(sessionStates!.content).toContain('Working');
    expect(sessionStates!.content).toContain('Error');
    expect(sessionStates!.content).toContain('Stopped');
  });

  it('contains the keyboard shortcuts topic', () => {
    const shortcuts = topics.find(t => t.id === 'keyboard-shortcuts');
    expect(shortcuts).toBeDefined();
    expect(shortcuts!.content).toContain('Alt+1');
    expect(shortcuts!.content).toContain('Ctrl+F');
    expect(shortcuts!.content).toContain('Alt+M');
    expect(shortcuts!.content).toContain('Cycle agent mode');
    expect(shortcuts!.content).toContain('Alt+T');
    expect(shortcuts!.content).toContain('Toggle extended thinking');
  });

  it('session states shows green for ready state', () => {
    const sessionStates = topics.find(t => t.id === 'session-states');
    expect(sessionStates!.content).toContain('Green');
    expect(sessionStates!.content).toContain('Ready');
  });

  it('first topic is getting-started', () => {
    expect(topics[0].id).toBe('getting-started');
  });
});
