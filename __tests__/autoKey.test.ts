/**
 * Auto key: a deeper voice singing the same melody must be judged on-pitch.
 * We test the pure comparison logic by driving MicPitchTracker.compare with synthetic readings.
 */
jest.mock('react-native', () => ({ Platform: { OS: 'test' } }));
jest.mock('expo-av', () => ({ Audio: { requestPermissionsAsync: jest.fn() } }));
jest.mock('../src/services/audioService', () => ({ setRecordingAudioMode: jest.fn() }));
jest.mock('../modules/aya-pitch-detector', () => ({
  isNativePitchDetectorAvailable: false,
  startNativePitchDetector: jest.fn(),
  stopNativePitchDetector: jest.fn(),
  addNativePitchListener: jest.fn(),
}));

import { MicPitchTracker, VersePitchTrack } from '../src/services/pitchService';
import { midiToFreqHz } from '../src/core/yin';

// Reciter: a 2-second melody around C4 (60), 10 ms hop
const melody = Array.from({ length: 200 }, (_, i) => 60 + 3 * Math.sin(i / 12));
const track: VersePitchTrack = {
  reciterId: 'test',
  surahNumber: 1,
  ayahNumber: 1,
  startMs: 0,
  endMs: 2000,
  hopMs: 10,
  midi: melody,
  minMidi: 54,
  maxMidi: 66,
  source: 'hd',
};

function run(tracker: MicPitchTracker, offsetSemitones: number, keyMode: 'auto' | 'exact') {
  const results = [];
  for (let i = 0; i < 200; i++) {
    const userMidi = melody[i] + offsetSemitones;
    results.push(tracker.compare({ freqHz: midiToFreqHz(userMidi), rms: 0.05, confidence: 0.05 }, track, i * 10, keyMode));
  }
  return results;
}

describe('Auto key', () => {
  it('judges a voice 5 semitones deeper as on-pitch once the key is learned', () => {
    const t = new MicPitchTracker();
    const r = run(t, -5, 'auto');
    const settled = r.slice(40);
    expect(settled.every(s => s.isOnPitch)).toBe(true);
    expect(settled[settled.length - 1].keyOffsetSemitones).toBe(-5);
  });

  it('judges a voice a full octave deeper as on-pitch in both modes', () => {
    expect(run(new MicPitchTracker(), -12, 'auto').slice(40).every(s => s.isOnPitch)).toBe(true);
    expect(run(new MicPitchTracker(), -12, 'exact').slice(5).every(s => s.isOnPitch)).toBe(true);
  });

  it('exact mode still flags a voice 5 semitones off', () => {
    const r = run(new MicPitchTracker(), -5, 'exact');
    expect(r.slice(5).every(s => !s.isOnPitch)).toBe(true);
  });

  it('auto key still catches wrong intervals (melody errors)', () => {
    const t = new MicPitchTracker();
    run(t, -5, 'auto'); // learn the key
    // Now sing a flat line instead of the melody: most samples should be off
    let off = 0;
    for (let i = 0; i < 200; i++) {
      const s = t.compare({ freqHz: midiToFreqHz(55), rms: 0.05, confidence: 0.05 }, track, i * 10, 'auto');
      if (!s.isOnPitch) off++;
    }
    expect(off).toBeGreaterThan(100);
  });
});
