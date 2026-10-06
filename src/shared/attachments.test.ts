import { describe, it, expect } from 'vitest';
import { isAudioType, isPdfType, knownMediaType } from './attachments.js';

describe('knownMediaType', () => {
  it('gives the type for PDFs and audio, whatever the case of the extension', () => {
    expect(knownMediaType('Spec.PDF')).toBe('application/pdf');
    expect(knownMediaType('memo.mp3')).toBe('audio/mpeg');
    expect(knownMediaType('memo.wav')).toBe('audio/wav');
  });

  it('is empty for other types and for names without an extension', () => {
    expect(knownMediaType('data.zip')).toBe('');
    expect(knownMediaType('README')).toBe('');
  });

  it('is empty for extensions that name Object.prototype members', () => {
    expect(knownMediaType('x.constructor')).toBe('');
    expect(knownMediaType('x.__proto__')).toBe('');
    expect(knownMediaType('x.toString')).toBe('');
  });
});

describe('isPdfType and isAudioType', () => {
  it('go by the MIME type', () => {
    expect(isPdfType('application/pdf')).toBe(true);
    expect(isPdfType('')).toBe(false);
    expect(isAudioType('audio/ogg')).toBe(true);
    expect(isAudioType('video/mp4')).toBe(false);
  });
});
