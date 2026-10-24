import { describe, it, expect } from 'vitest';
import { isConflictCode, isConflictMarker } from './git-conflicts.js';

describe('isConflictCode', () => {
  it("knows git status's codes for a file in conflict, and only those", () => {
    for (const xy of ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']) expect(isConflictCode(xy)).toBe(true);
    for (const xy of ['MM', 'A ', ' D', '??', 'U', 'UUU', 'toString']) expect(isConflictCode(xy)).toBe(false);
  });
});

describe('isConflictMarker', () => {
  it('knows the lines git writes where a conflict starts and ends', () => {
    for (const line of ['<<<<<<< HEAD', '>>>>>>> main', '>>>>>>> 1a2b3c4 (Add the parser)', '<<<<<<<']) {
      expect(isConflictMarker(line)).toBe(true);
    }
  });

  it('leaves other lines alone, a Markdown heading underline among them', () => {
    for (const line of ['=======', '<<<<<<<< eight', ' <<<<<<< indented', '<<<<<<<x', 'a <<<<<<< b', '>>>>>> six']) {
      expect(isConflictMarker(line)).toBe(false);
    }
  });
});
