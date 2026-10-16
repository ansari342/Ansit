import { detectPitchHzFromFloatSamples, freqHzToMidi, midiToNoteName } from '../src/core/yin';

function voiceLike(f0: number, sampleRate: number, n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    x[i] =
      0.3 * Math.sin(2 * Math.PI * f0 * t) +
      0.25 * Math.sin(2 * Math.PI * 2 * f0 * t + 0.7) +
      0.18 * Math.sin(2 * Math.PI * 3 * f0 * t + 1.1) +
      0.08 * Math.sin(2 * Math.PI * 4 * f0 * t) +
      0.01 * (Math.random() - 0.5);
  }
  return x;
}

describe('YIN pitch detector', () => {
  it.each([80, 98, 131, 147, 175, 196, 233, 262, 330, 392, 440])('detects %i Hz within 5 cents', f0 => {
    const r = detectPitchHzFromFloatSamples(voiceLike(f0, 48000, 2048), 48000);
    expect(r.freqHz).not.toBeNull();
    const cents = 1200 * Math.log2((r.freqHz as number) / f0);
    expect(Math.abs(cents)).toBeLessThan(5);
  });

  it('rejects silence and near-silence', () => {
    const silent = new Float32Array(2048).map(() => 0.002 * (Math.random() - 0.5));
    expect(detectPitchHzFromFloatSamples(silent, 48000).freqHz).toBeNull();
  });

  it('rejects broadband noise', () => {
    const noise = new Float32Array(2048).map(() => 0.3 * (Math.random() - 0.5));
    expect(detectPitchHzFromFloatSamples(noise, 48000).freqHz).toBeNull();
  });

  it('works at 16 kHz with a 1024 window (offline extraction settings)', () => {
    const r = detectPitchHzFromFloatSamples(voiceLike(150, 16000, 1024), 16000, 70, 420);
    expect(Math.abs(1200 * Math.log2((r.freqHz as number) / 150))).toBeLessThan(5);
  });

  it('maps frequencies to MIDI and note names', () => {
    expect(freqHzToMidi(440)).toBeCloseTo(69, 5);
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(48)).toBe('C3');
  });
});
