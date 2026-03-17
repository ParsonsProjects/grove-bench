import { vi } from 'vitest';

// Auto-mock electron for all main process tests
vi.mock('electron');
