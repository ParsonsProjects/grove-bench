import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';

import QuestionBlock from './QuestionBlock.svelte';
import { settingsStore } from '../stores/settings.svelte.js';

const questions = [
  {
    header: 'Database',
    question: 'Which database should the tests use?',
    multiSelect: false,
    options: [{ label: 'SQLite', description: 'In memory' }, { label: 'Postgres', description: 'Docker' }],
  },
  { header: 'Seed data', question: 'Seed the fixtures?', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] },
];
const props = { sessionId: 's1', requestId: 'r1', questions };

afterEach(() => {
  cleanup();
  settingsStore.current = { ...settingsStore.current, groveCharacters: true };
});

describe('QuestionBlock grove character', () => {
  it('asks once, above the first question, until answered', () => {
    render(QuestionBlock, { ...props, resolved: false });
    expect(screen.getAllByRole('img', { name: 'Asking you a question' })).toHaveLength(1);
  });

  it('shows it was answered', () => {
    render(QuestionBlock, { ...props, resolved: true, response: 'SQLite', selectedLabels: ['SQLite'] });
    expect(screen.getByRole('img', { name: 'Answered' })).toBeInTheDocument();
  });

  it('is left out when grove characters are off', () => {
    settingsStore.current = { ...settingsStore.current, groveCharacters: false };
    render(QuestionBlock, { ...props, resolved: false });
    expect(screen.queryByRole('img', { name: 'Asking you a question' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
  });
});
