import { describe, it, expect } from 'vitest';
import { parseEnvLines } from './env-lines.js';

describe('parseEnvLines', () => {
  it('reads one KEY=value per line, keeping = in values', () => {
    expect(parseEnvLines('OPENAI_API_KEY=sk-a=b\n\n  DEBUG=1  \nEMPTY=')).toEqual({
      env: { OPENAI_API_KEY: 'sk-a=b', DEBUG: '1', EMPTY: '' },
    });
    expect(parseEnvLines('')).toEqual({ env: {} });
  });

  it('says which line is wrong', () => {
    expect(parseEnvLines('JUST_A_NAME')).toEqual({ error: 'Write each variable as KEY=value (got "JUST_A_NAME").' });
    expect(parseEnvLines('=value')).toMatchObject({ error: expect.stringContaining('KEY=value') });
    expect(parseEnvLines('1BAD=x')).toMatchObject({ error: expect.stringContaining("1BAD isn't a variable name") });
    expect(parseEnvLines('MY-VAR=x')).toMatchObject({ error: expect.stringContaining('MY-VAR') });
  });
});
