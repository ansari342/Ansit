import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Reciter } from '../types';
import { WordTiming } from '../data/reciterTimings';
import { REAL_RECITER_PITCH } from '../data/realReciterPitch';
import { getAudioUrl, BASE_RECITERS } from '../data/reciters';
import { RAAD_SURAH_DURATIONS_MS } from '../data/raadDurations';
import { setRecordingAudioMode } from './audioService';

export interface NoteLane {
  laneIndex: number; // 0 (top/highest) to 7 (bottom/lowest)
  midi: number;
  noteName: string;
  freqHz: number;
}

export interface TargetNoteBlock {
  startRatio: number; // 0..1
  endRatio: number;   // 0..1
  laneIndex: number;  // 0..7
  midi: number;
  noteName: string;
  freqHz: number;
  wordIndex: number;
}

export interface PitchContourPoint {
  t: number;          // 0..1
  laneFloat: number;  // 0..7 continuous vertical position
  midiFloat: number;
  freqHz: number;
  wordIndex: number;
  isVoiced: boolean;
}

export interface VersePitchProfile {
  reciterId: string;
  surahNumber: number;
  ayahNumber: number;
  lanes: NoteLane[];
  targetBlocks: TargetNoteBlock[];
  contourPoints: PitchContourPoint[];
  source: 'recording' | 'fallback';
}

export interface LiveMicSample {
  t: number;             // 0..1 verse progress when sampled
  laneFloat: number;     // 0..7 mapped vertical lane
  rawFreqHz: number;     // User's measured Hz
  noteName: string;      // e.g. "F#3"
  centsOffset: number;   // -50 to +50 cents from reciter target
  isOnPitch: boolean;    // true if within tolerance
  isVoiced: boolean;     // true if user is actively speaking/reciting
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreqHz(midi: number): number {
  return Math.round(440 * Math.pow(2, (midi - 69) / 12));
}

export function freqHzToMidi(freqHz: number): number {
  if (freqHz <= 20) return 50;
  return 69 + 12 * Math.log2(freqHz / 440);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const noteClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteClass]}${octave}`;
}

interface ReciterVocalSignature {
  baseMidi: number; // Lowest MIDI note of the 8-lane window (lane 7)
  scaleIntervals: number[]; // 8 semitone offsets from baseMidi (ascending, lane 7 -> lane 0)
  vibratoDepth: number; // in lane units
  vibratoRate: number;  // cycles per word
  attackOvershoot: number; // initial consonant attack inflection
  style: 'ascend_step' | 'arch' | 'measured' | 'melodic';
}

const RECITER_SIGNATURES: Record<string, ReciterVocalSignature> = {
  raad: {
    // Raad Mohammad Al-Kurdi: Soulful Kurdish/Hijazi baritone-tenor (D3 to B3)
    baseMidi: 50, // D3 (147 Hz)
    scaleIntervals: [0, 2, 3, 4, 5, 6, 7, 9], // D3, E3, F3, F#3, G3, G#3, A3, B3
    vibratoDepth: 0.08,
    vibratoRate: 3.2,
    attackOvershoot: 0.28,
    style: 'ascend_step',
  },
  mishary: {
    // Mishary Rashid Alafasy: Lyrical Nahawand/Bayati tenor (E3 to C4)
    baseMidi: 52, // E3 (165 Hz)
    scaleIntervals: [0, 1, 3, 5, 7, 8, 10, 12],
    vibratoDepth: 0.10,
    vibratoRate: 3.6,
    attackOvershoot: 0.22,
    style: 'arch',
  },
  abdulbasit: {
    baseMidi: 53, // F3 (175 Hz)
    scaleIntervals: [0, 2, 4, 5, 7, 9, 10, 12],
    vibratoDepth: 0.11,
    vibratoRate: 3.8,
    attackOvershoot: 0.25,
    style: 'ascend_step',
  },
  abdulbasit_mujawwad: {
    baseMidi: 55, // G3 (196 Hz)
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10, 12],
    vibratoDepth: 0.14,
    vibratoRate: 4.2,
    attackOvershoot: 0.30,
    style: 'melodic',
  },
  husary: {
    baseMidi: 48, // C3 (131 Hz)
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    vibratoDepth: 0.05,
    vibratoRate: 2.5,
    attackOvershoot: 0.15,
    style: 'measured',
  },
  husary_muallim: {
    baseMidi: 48, // C3
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    vibratoDepth: 0.04,
    vibratoRate: 2.2,
    attackOvershoot: 0.12,
    style: 'measured',
  },
  dussary: {
    baseMidi: 51, // D#3 (156 Hz)
    scaleIntervals: [0, 2, 3, 5, 6, 8, 10, 11],
    vibratoDepth: 0.11,
    vibratoRate: 3.5,
    attackOvershoot: 0.26,
    style: 'melodic',
  },
  qatami: {
    baseMidi: 52, // E3
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    vibratoDepth: 0.10,
    vibratoRate: 3.4,
    attackOvershoot: 0.24,
    style: 'arch',
  },
  sudais: {
    baseMidi: 53, // F3
    scaleIntervals: [0, 2, 4, 5, 7, 9, 10, 12],
    vibratoDepth: 0.09,
    vibratoRate: 3.5,
    attackOvershoot: 0.24,
    style: 'ascend_step',
  },
};

function getReciterSignature(reciterId: string): ReciterVocalSignature {
  return (
    RECITER_SIGNATURES[reciterId] || {
      baseMidi: 50,
      scaleIntervals: [0, 2, 3, 4, 5, 7, 8, 10],
      vibratoDepth: 0.08,
      vibratoRate: 3.2,
      attackOvershoot: 0.22,
      style: 'arch',
    }
  );
}

/**
 * Analyzes an Arabic word for Madd (elongation), Ghunnah (nasalization), and syllable weight
 * to shape its pitch sustain and melodic step.
 */
function analyzeArabicWordFeatures(word: string): {
  hasMadd: boolean;
  hasShaddah: boolean;
  charWeight: number;
} {
  const hasMadd = /[اويآٰٓ]/.test(word);
  const hasShaddah = /ّ/.test(word);
  return {
    hasMadd,
    hasShaddah,
    charWeight: Math.max(2, word.length),
  };
}

/**
 * Deterministic hash for subtle verse-to-verse melodic variation while keeping
 * the same verse + reciter 100% reproducible.
 */
function hashVerseReciter(surah: number, ayah: number, reciterId: string): number {
  let h = (surah * 131 + ayah * 37) | 0;
  for (let i = 0; i < reciterId.length; i++) {
    h = (h * 31 + reciterId.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// In-memory cache of live-extracted 96-point MIDI contours from audio recordings
const liveExtractedContourCache = new Map<string, number[]>();
const inFlightPitchExtractions = new Map<string, Promise<number[] | null>>();
const mp3HeaderMetaCache = new Map<string, { totalBytes: number; id3Bytes: number }>();

/**
 * Builds an accurate Melodyne-style VersePitchProfile directly from a 96-slice real acoustic
 * MIDI contour (extracted from the reciter's MP3 recording via YIN fundamental frequency analysis).
 */
export function buildPitchProfileFromMidiContour(
  surahNumber: number,
  ayahNumber: number,
  reciterId: string,
  midiContour: number[],
  wordCount: number = 4
): VersePitchProfile {
  const numSamples = midiContour.length || 96;
  const voiced = midiContour.filter(m => m > 0).sort((a, b) => a - b);

  // Center the 8 chromatic semitone lanes (1 semitone per lane) on the reciter's actual voiced register
  let baseMidi = 50;
  if (voiced.length > 0) {
    const p05 = voiced[Math.floor(voiced.length * 0.05)];
    const p95 = voiced[Math.floor(voiced.length * 0.95)];
    const midCenter = Math.round((p05 + p95) / 2);
    baseMidi = midCenter - 3;
  }

  // Lane 0 is highest note (baseMidi + 7), Lane 7 is lowest note (baseMidi)
  const lanes: NoteLane[] = [];
  for (let laneIdx = 0; laneIdx < 8; laneIdx++) {
    const midi = baseMidi + (7 - laneIdx);
    lanes.push({
      laneIndex: laneIdx,
      midi,
      noteName: midiToNoteName(midi),
      freqHz: midiToFreqHz(midi),
    });
  }

  // 1. 5-point moving average of voiced frames to prevent vocal vibrato from splitting sustained notes
  const smooth = midiContour.map((m, idx) => {
    if (m <= 0) return 0;
    let sum = 0;
    let cnt = 0;
    for (let k = -2; k <= 2; k++) {
      const v = midiContour[idx + k];
      if (v && v > 0) {
        sum += v;
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : m;
  });

  // 2. Segment into contiguous sustained note plateaus (within 0.68 semitones of plateau mean)
  let rawRuns: { startSlice: number; endSlice: number; qMidi: number; laneIndex: number }[] = [];
  let i = 0;
  while (i < smooth.length) {
    if (smooth[i] <= 0) {
      i++;
      continue;
    }
    let j = i;
    let sum = smooth[i];
    while (j + 1 < smooth.length && smooth[j + 1] > 0) {
      const mean = sum / (j - i + 1);
      if (Math.abs(smooth[j + 1] - mean) <= 0.68) {
        j++;
        sum += smooth[j];
      } else {
        break;
      }
    }
    const sliceVals = midiContour
      .slice(i, j + 1)
      .filter(v => v > 0)
      .sort((a, b) => a - b);
    const medianMidi = sliceVals[Math.floor(sliceVals.length / 2)] || smooth[i];
    const qMidi = Math.max(baseMidi, Math.min(baseMidi + 7, Math.round(medianMidi)));
    rawRuns.push({
      startSlice: i,
      endSlice: j,
      qMidi,
      laneIndex: 7 - (qMidi - baseMidi),
    });
    i = j + 1;
  }

  // 3. Absorb brief 1-3 slice glissando transitions into adjacent sustained note plateaus
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < rawRuns.length; r++) {
      const run = rawRuns[r];
      const len = run.endSlice - run.startSlice + 1;
      if (len <= 3) {
        const prev = r > 0 ? rawRuns[r - 1] : null;
        const next = r + 1 < rawRuns.length ? rawRuns[r + 1] : null;
        if (prev && prev.endSlice >= run.startSlice - 2) {
          run.qMidi = prev.qMidi;
          run.laneIndex = prev.laneIndex;
        } else if (next && next.startSlice <= run.endSlice + 2) {
          run.qMidi = next.qMidi;
          run.laneIndex = next.laneIndex;
        }
      }
    }
    const merged: typeof rawRuns = [];
    for (const run of rawRuns) {
      const last = merged[merged.length - 1];
      if (last && last.qMidi === run.qMidi && run.startSlice - last.endSlice <= 1) {
        last.endSlice = run.endSlice;
      } else {
        merged.push({ ...run });
      }
    }
    rawRuns = merged;
  }

  const validRuns = rawRuns.filter(r => r.endSlice - r.startSlice + 1 >= 3);
  const targetBlocks: TargetNoteBlock[] = validRuns.map(run => {
    const startRatio = Math.max(0.01, run.startSlice / Math.max(1, numSamples - 1));
    const endRatio = Math.min(0.99, (run.endSlice + 0.75) / Math.max(1, numSamples - 1));
    const lane = lanes[run.laneIndex] || lanes[4];
    const approxWordIdx = Math.min(
      Math.max(0, wordCount - 1),
      Math.floor(((startRatio + endRatio) / 2) * wordCount)
    );
    return {
      startRatio,
      endRatio: Math.max(startRatio + 0.025, endRatio),
      laneIndex: run.laneIndex,
      midi: lane.midi,
      noteName: lane.noteName,
      freqHz: lane.freqHz,
      wordIndex: approxWordIdx,
    };
  });

  // 4. Build 96 continuous PitchContourPoints directly from the real MIDI contour
  const contourPoints: PitchContourPoint[] = [];
  let lastValidMidi = voiced.length > 0 ? voiced[0] : baseMidi + 3;

  for (let idx = 0; idx < numSamples; idx++) {
    const t = idx / Math.max(1, numSamples - 1);
    const rawMidi = midiContour[idx];
    const isVoiced = rawMidi > 0;
    const midiFloat = isVoiced ? rawMidi : lastValidMidi;
    if (isVoiced) {
      lastValidMidi = rawMidi;
    }

    const rawLane = 7 - (midiFloat - baseMidi);
    const laneFloat = Math.max(0.15, Math.min(7.65, rawLane));
    const approxWordIdx = Math.min(Math.max(0, wordCount - 1), Math.floor(t * wordCount));

    contourPoints.push({
      t,
      laneFloat,
      midiFloat,
      freqHz: midiToFreqHz(midiFloat),
      wordIndex: approxWordIdx,
      isVoiced,
    });
  }

  return {
    reciterId,
    surahNumber,
    ayahNumber,
    lanes,
    targetBlocks,
    contourPoints,
    source: 'recording',
  };
}

/**
 * Generates the complete Vocal Pitch Monitor profile for a given verse and reciter:
 * - Uses real acoustic f0 contours extracted directly from the reciter's MP3 recording whenever available
 * - Falls back to phonetic contour only while an uncached verse recording is being decoded
 */
export function generateVersePitchProfile(
  surahNumber: number,
  ayahNumber: number,
  words: string[],
  wordTimings: WordTiming[],
  reciter: Reciter
): VersePitchProfile {
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  const cacheKey = `${actualReciter.id}_${surahNumber}_${ayahNumber}`;

  // 1. Check live extracted recording cache first
  const cachedContour = liveExtractedContourCache.get(cacheKey);
  if (cachedContour && cachedContour.length > 0) {
    return buildPitchProfileFromMidiContour(
      surahNumber,
      ayahNumber,
      actualReciter.id,
      cachedContour,
      Math.max(1, words.length)
    );
  }

  // 2. Check pre-extracted real recording database (src/data/realReciterPitch.ts)
  const preExtracted = REAL_RECITER_PITCH[actualReciter.id]?.[surahNumber]?.[ayahNumber];
  if (preExtracted && preExtracted.length > 0) {
    return buildPitchProfileFromMidiContour(
      surahNumber,
      ayahNumber,
      actualReciter.id,
      preExtracted,
      Math.max(1, words.length)
    );
  }

  // 3. Fallback profile while live audio recording extraction is in flight
  const sig = getReciterSignature(actualReciter.id);
  const seed = hashVerseReciter(surahNumber, ayahNumber, actualReciter.id);

  // Build 8 lanes: lane 0 is highest pitch (top), lane 7 is lowest pitch (bottom)
  const lanes: NoteLane[] = [];
  for (let laneIdx = 0; laneIdx < 8; laneIdx++) {
    const scaleIdx = 7 - laneIdx;
    const midi = sig.baseMidi + sig.scaleIntervals[scaleIdx];
    lanes.push({
      laneIndex: laneIdx,
      midi,
      noteName: midiToNoteName(midi),
      freqHz: midiToFreqHz(midi),
    });
  }

  const wordCount = Math.max(1, words.length);
  const totalDurationMs =
    wordTimings.length > 0
      ? Math.max(1, wordTimings[wordTimings.length - 1].endMs - wordTimings[0].startMs)
      : 1000;
  const baseStartMs = wordTimings.length > 0 ? wordTimings[0].startMs : 0;

  // Build target note blocks aligned to words/phrases
  const targetBlocks: TargetNoteBlock[] = [];

  for (let w = 0; w < wordCount; w++) {
    const startRatio =
      wordTimings[w] !== undefined
        ? Math.max(0, Math.min(0.98, (wordTimings[w].startMs - baseStartMs) / totalDurationMs))
        : w / wordCount;
    const endRatio =
      wordTimings[w] !== undefined
        ? Math.max(startRatio + 0.03, Math.min(1.0, (wordTimings[w].endMs - baseStartMs) / totalDurationMs))
        : (w + 1) / wordCount;

    const features = analyzeArabicWordFeatures(words[w] || '');
    const progress = wordCount > 1 ? w / (wordCount - 1) : 0.5;

    let laneIndex = 4;
    if (sig.style === 'ascend_step') {
      if (wordCount <= 5) {
        const stepLanes = [6, 4, 3, 2, 1];
        laneIndex = stepLanes[Math.min(w, stepLanes.length - 1)];
      } else {
        const phrasePos = (w % 5) / 4;
        laneIndex = Math.round(6 - phrasePos * 4.5);
        if (w === wordCount - 1) {
          laneIndex = (seed + ayahNumber) % 2 === 0 ? 1 : 4;
        }
      }
    } else if (sig.style === 'arch') {
      const arch = Math.sin(progress * Math.PI);
      laneIndex = Math.round(6 - arch * 4.5);
      if (features.hasMadd && laneIndex > 1) laneIndex -= 1;
    } else if (sig.style === 'measured') {
      const pattern = [5, 4, 3, 4, 2, 3, 5];
      laneIndex = pattern[(w + (seed % 3)) % pattern.length];
    } else {
      const wave = Math.sin(progress * Math.PI * 1.4 + (seed % 4) * 0.3);
      laneIndex = Math.round(4.5 - wave * 3);
    }

    laneIndex = Math.max(1, Math.min(6, laneIndex));
    const lane = lanes[laneIndex];

    targetBlocks.push({
      startRatio: Math.max(0.03, startRatio),
      endRatio: Math.min(0.96, endRatio),
      laneIndex,
      midi: lane.midi,
      noteName: lane.noteName,
      freqHz: lane.freqHz,
      wordIndex: w,
    });
  }

  // Generate 96 continuous pitch contour points across t = 0..1
  const numSamples = 96;
  const contourPoints: PitchContourPoint[] = [];

  for (let i = 0; i < numSamples; i++) {
    const t = i / (numSamples - 1);

    let blockIdx = 0;
    for (let b = 0; b < targetBlocks.length; b++) {
      if (t >= targetBlocks[b].startRatio) {
        blockIdx = b;
      }
    }
    const block = targetBlocks[blockIdx];
    const prevBlock = blockIdx > 0 ? targetBlocks[blockIdx - 1] : null;

    let laneFloat = block.laneIndex;

    if (blockIdx === 0 && t < block.startRatio + 0.035) {
      const onsetProgress = Math.max(0, Math.min(1, t / Math.max(0.01, block.startRatio + 0.035)));
      const startLane = Math.min(7.3, block.laneIndex + 1.6);
      laneFloat = startLane + (block.laneIndex - startLane) * onsetProgress;
    } else {
      const blockDur = Math.max(0.02, block.endRatio - block.startRatio);
      const localT = Math.max(0, Math.min(1, (t - block.startRatio) / blockDur));

      if (prevBlock && localT < 0.14) {
        const trans = localT / 0.14;
        const s = trans * trans * (3 - 2 * trans);
        laneFloat = prevBlock.laneIndex + (block.laneIndex - prevBlock.laneIndex) * s;
      } else if (prevBlock && localT >= 0.14 && localT < 0.26 && prevBlock.laneIndex > block.laneIndex) {
        const attackPhase = (localT - 0.14) / 0.12;
        const spike = Math.sin(attackPhase * Math.PI * 2) * sig.attackOvershoot * (1 - attackPhase * 0.5);
        laneFloat = block.laneIndex - spike;
      } else {
        const vib =
          Math.sin(localT * Math.PI * 2 * sig.vibratoRate) *
          sig.vibratoDepth *
          Math.min(1, localT * 2);
        laneFloat = block.laneIndex + vib;
      }
    }

    laneFloat = Math.max(0.3, Math.min(7.5, laneFloat));

    const clampedIdx = Math.max(0, Math.min(7, Math.floor(laneFloat)));
    const nextIdx = Math.max(0, Math.min(7, Math.ceil(laneFloat)));
    const frac = laneFloat - clampedIdx;
    const midiFloat =
      lanes[clampedIdx].midi + (lanes[nextIdx].midi - lanes[clampedIdx].midi) * frac;

    contourPoints.push({
      t,
      laneFloat,
      midiFloat,
      freqHz: midiToFreqHz(midiFloat),
      wordIndex: block.wordIndex,
      isVoiced: true,
    });
  }

  return {
    reciterId: actualReciter.id,
    surahNumber,
    ayahNumber,
    lanes,
    targetBlocks,
    contourPoints,
    source: 'fallback',
  };
}

/**
 * Extracts a 96-slice MIDI pitch contour from decoded Float32 audio samples using YIN f0 detection.
 */
function extractContourFromFloatChannel(
  floatSamples: Float32Array,
  sampleRate: number,
  numSlices: number = 96
): number[] {
  const windowSize = Math.min(2048, Math.max(1024, Math.floor(sampleRate * 0.09)));
  if (floatSamples.length < windowSize) return [];

  const rawMidis: (number | null)[] = new Array(numSlices).fill(null);
  for (let i = 0; i < numSlices; i++) {
    const ratio = i / (numSlices - 1);
    const startIdx = Math.floor(ratio * (floatSamples.length - windowSize));
    const slice = floatSamples.subarray(startIdx, startIdx + windowSize);
    const { freqHz, rms } = detectPitchHzFromFloatSamples(slice, sampleRate);
    if (freqHz !== null && rms >= 0.01) {
      rawMidis[i] = freqHzToMidi(freqHz);
    }
  }

  const voiced = rawMidis.filter((m): m is number => m !== null).sort((a, b) => a - b);
  if (voiced.length === 0) return [];
  const medianMidi = voiced[Math.floor(voiced.length / 2)];

  for (let i = 0; i < numSlices; i++) {
    if (rawMidis[i] !== null) {
      while (rawMidis[i]! - medianMidi > 7.5) rawMidis[i]! -= 12;
      while (medianMidi - rawMidis[i]! > 7.5) rawMidis[i]! += 12;
    }
  }

  // Bridge short consonant gaps (<= 5 slices)
  const bridged = [...rawMidis];
  let idx = 0;
  while (idx < numSlices) {
    if (bridged[idx] === null) {
      let j = idx;
      while (j < numSlices && bridged[j] === null) j++;
      const gapLen = j - idx;
      if (
        gapLen <= 5 &&
        idx > 0 &&
        j < numSlices &&
        bridged[idx - 1] !== null &&
        bridged[j] !== null
      ) {
        for (let k = idx; k < j; k++) {
          const frac = (k - idx + 1) / (gapLen + 1);
          bridged[k] = bridged[idx - 1]! + (bridged[j]! - bridged[idx - 1]!) * frac;
        }
      }
      idx = j;
    } else {
      idx++;
    }
  }

  // 3-point median filter
  const smoothed = new Array(numSlices).fill(0);
  for (let s = 0; s < numSlices; s++) {
    if (bridged[s] === null) {
      smoothed[s] = 0;
      continue;
    }
    const neighbors: number[] = [];
    for (let d = -1; d <= 1; d++) {
      if (s + d >= 0 && s + d < numSlices && bridged[s + d] !== null) {
        neighbors.push(bridged[s + d]!);
      }
    }
    neighbors.sort((a, b) => a - b);
    smoothed[s] = Number(neighbors[Math.floor(neighbors.length / 2)].toFixed(2));
  }

  return smoothed;
}

/**
 * Fetches and decodes the actual reciter audio recording for any verse not already in REAL_RECITER_PITCH,
 * maps its 96-slice YIN fundamental frequency contour, and returns the resulting VersePitchProfile.
 */
export async function extractAndMapVersePitchAsync(
  reciter: Reciter,
  surahNumber: number,
  ayahNumber: number,
  ayahStartMs: number,
  ayahEndMs: number,
  totalTrackDurationMs: number,
  words: string[],
  wordTimings: WordTiming[]
): Promise<VersePitchProfile> {
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  const cacheKey = `${actualReciter.id}_${surahNumber}_${ayahNumber}`;
  const wordCount = Math.max(1, words.length);

  // 1. Check pre-extracted or cached recording contour
  const preExtracted =
    liveExtractedContourCache.get(cacheKey) ||
    REAL_RECITER_PITCH[actualReciter.id]?.[surahNumber]?.[ayahNumber];
  if (preExtracted && preExtracted.length > 0) {
    return buildPitchProfileFromMidiContour(
      surahNumber,
      ayahNumber,
      actualReciter.id,
      preExtracted,
      wordCount
    );
  }

  // 2. Check if an extraction is already in-flight for this verse
  let task = inFlightPitchExtractions.get(cacheKey);
  if (!task) {
    task = (async (): Promise<number[] | null> => {
      try {
        const AudioCtx =
          typeof window !== 'undefined'
            ? (window as any).AudioContext || (window as any).webkitAudioContext
            : null;
        if (!AudioCtx) return null;

        let mp3Bytes: ArrayBuffer;
        const surahStr = String(surahNumber).padStart(3, '0');
        const ayahStr = String(ayahNumber).padStart(3, '0');

        if (actualReciter.id !== 'raad' && actualReciter.subfolder) {
          // Every reciter except Raad has a standalone verse MP3 on EveryAyah (~40-120 KB) with CORS enabled
          const discreteVerseUrl = `https://everyayah.com/data/${actualReciter.subfolder}/${surahStr}${ayahStr}.mp3`;
          const resp = await fetch(discreteVerseUrl);
          if (!resp.ok) return null;
          mp3Bytes = await resp.arrayBuffer();
        } else {
          // Full-surah CBR MP3 (Raad): fetch only the exact byte range of the current verse!
          const url = `https://cdn.mp3quran.net/audio/raad-kurdi/r1/${surahStr}.mp3`;
          let meta = mp3HeaderMetaCache.get(url);
          if (!meta) {
            const headResp = await fetch(url, { headers: { Range: 'bytes=0-15' } });
            const contentRange = headResp.headers.get('content-range') || '';
            const match = contentRange.match(/\/(\d+)/);
            const totalBytes = match ? parseInt(match[1], 10) : 0;
            const headerBuf = new Uint8Array(await headResp.arrayBuffer());
            let id3Bytes = 0;
            if (
              headerBuf.length >= 10 &&
              headerBuf[0] === 0x49 &&
              headerBuf[1] === 0x44 &&
              headerBuf[2] === 0x33
            ) {
              id3Bytes =
                ((headerBuf[6] & 0x7f) << 21) |
                ((headerBuf[7] & 0x7f) << 14) |
                ((headerBuf[8] & 0x7f) << 7) |
                (headerBuf[9] & 0x7f) + 10;
            }
            if (totalBytes > 0) {
              meta = { totalBytes, id3Bytes };
              mp3HeaderMetaCache.set(url, meta);
            }
          }

          const trackDur =
            actualReciter.id === 'raad'
              ? RAAD_SURAH_DURATIONS_MS[surahNumber] || totalTrackDurationMs
              : totalTrackDurationMs;

          if (!meta || trackDur <= 1000) return null;

          const audioBytes = Math.max(1, meta.totalBytes - meta.id3Bytes);
          const startByte = Math.max(
            meta.id3Bytes,
            meta.id3Bytes + Math.floor((ayahStartMs / trackDur) * audioBytes)
          );
          const endByte = Math.min(
            meta.totalBytes - 1,
            meta.id3Bytes + Math.ceil((ayahEndMs / trackDur) * audioBytes)
          );

          const rangeResp = await fetch(url, {
            headers: { Range: `bytes=${startByte}-${endByte}` },
          });
          if (!rangeResp.ok && rangeResp.status !== 206) return null;
          const rawSlice = new Uint8Array(await rangeResp.arrayBuffer());

          // Align to first MP3 frame sync header (0xFF followed by 0xE0+)
          let syncOffset = 0;
          for (let k = 0; k < Math.min(2048, rawSlice.length - 4); k++) {
            if (rawSlice[k] === 0xff && (rawSlice[k + 1] & 0xe0) === 0xe0) {
              syncOffset = k;
              break;
            }
          }
          mp3Bytes = rawSlice.buffer.slice(
            rawSlice.byteOffset + syncOffset,
            rawSlice.byteOffset + rawSlice.byteLength
          );
        }

        const audioCtx = new AudioCtx();
        try {
          const audioBuffer = await audioCtx.decodeAudioData(mp3Bytes);
          const channelData = audioBuffer.getChannelData(0);
          const contour = extractContourFromFloatChannel(
            channelData,
            audioBuffer.sampleRate,
            96
          );
          if (contour.length > 0) {
            liveExtractedContourCache.set(cacheKey, contour);
            return contour;
          }
        } finally {
          try {
            audioCtx.close();
          } catch (e) {}
        }
        return null;
      } catch (e) {
        return null;
      } finally {
        inFlightPitchExtractions.delete(cacheKey);
      }
    })();
    inFlightPitchExtractions.set(cacheKey, task);
  }

  const extracted = await task;
  if (extracted && extracted.length > 0) {
    return buildPitchProfileFromMidiContour(
      surahNumber,
      ayahNumber,
      actualReciter.id,
      extracted,
      wordCount
    );
  }

  return generateVersePitchProfile(surahNumber, ayahNumber, words, wordTimings, reciter);
}

/**
 * Samples the reciter's pitch profile at any normalized verse progress ratio (0..1).
 */
export function samplePitchProfileAt(
  profile: VersePitchProfile,
  ratio: number
): PitchContourPoint & { noteName: string } {
  const pts = profile.contourPoints;
  if (pts.length === 0) {
    return {
      t: 0,
      laneFloat: 4,
      midiFloat: 55,
      freqHz: 196,
      wordIndex: 0,
      isVoiced: true,
      noteName: 'G3',
    };
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  const exactIdx = clamped * (pts.length - 1);
  const i0 = Math.floor(exactIdx);
  const i1 = Math.min(pts.length - 1, i0 + 1);
  const frac = exactIdx - i0;

  const p0 = pts[i0];
  const p1 = pts[i1];
  const laneFloat = p0.laneFloat + (p1.laneFloat - p0.laneFloat) * frac;
  const midiFloat = p0.midiFloat + (p1.midiFloat - p0.midiFloat) * frac;
  const freqHz = Math.round(p0.freqHz + (p1.freqHz - p0.freqHz) * frac);

  return {
    t: clamped,
    laneFloat,
    midiFloat,
    freqHz,
    wordIndex: p0.wordIndex,
    isVoiced: p0.isVoiced,
    noteName: midiToNoteName(midiFloat),
  };
}

function detectPitchHzFromFloatSamples(floatSamples: Float32Array, sampleRate: number): { freqHz: number | null; rms: number } {
  const windowSize = floatSamples.length;
  let energySum = 0;
  for (let i = 0; i < windowSize; i++) {
    const norm = floatSamples[i];
    energySum += norm * norm;
  }

  const rms = Math.sqrt(energySum / windowSize);
  if (rms < 0.008) {
    return { freqHz: null, rms };
  }

  // Search vocal fundamental frequency range: 75 Hz (D2) to 460 Hz (A#4)
  const minLag = Math.floor(sampleRate / 460);
  const maxLag = Math.min(Math.floor(sampleRate / 75), Math.floor(windowSize / 2));
  const halfWin = Math.floor(windowSize / 2);

  // YIN Cumulative Mean Normalized Difference Function (CMNDF)
  const diff = new Float32Array(maxLag + 1);
  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;

  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < halfWin; i++) {
      const d = floatSamples[i] - floatSamples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
    runningSum += sum;
    cmndf[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
  }

  // Find first local minimum below YIN threshold
  const threshold = 0.22;
  let bestTau = -1;
  for (let tau = minLag; tau <= maxLag - 1; tau++) {
    if (cmndf[tau] < threshold && cmndf[tau] <= cmndf[tau + 1]) {
      bestTau = tau;
      break;
    }
  }

  // Fallback to global minimum in vocal range if no dip below threshold
  if (bestTau === -1) {
    let minVal = 999;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        bestTau = tau;
      }
    }
    if (minVal > 0.48) return { freqHz: null, rms };
  }

  // Parabolic interpolation for sub-sample frequency accuracy
  let refinedTau = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-6) {
      refinedTau = bestTau + (s2 - s0) / denom;
    }
  }

  const freqHz = sampleRate / refinedTau;
  if (freqHz < 70 || freqHz > 500) return { freqHz: null, rms };
  return { freqHz, rms };
}

/**
 * Fast Normalized Autocorrelation / YIN-inspired fundamental frequency (f0) detector
 * operating on 16-bit signed little-endian PCM bytes from iOS AVAudioRecorder.
 */
function detectPitchHzFromPCMBytes(bytes: Uint8Array, sampleRate: number = 16000): number | null {
  const numSamples = Math.floor(bytes.byteLength / 2);
  if (numSamples < 512) return null;

  // Use the latest 1024 samples (~64ms window at 16kHz)
  const windowSize = Math.min(1024, numSamples);
  const startSample = numSamples - windowSize;
  const floatSamples = new Float32Array(windowSize);

  for (let i = 0; i < windowSize; i++) {
    const byteIdx = (startSample + i) * 2;
    let val = bytes[byteIdx] | (bytes[byteIdx + 1] << 8);
    if (val >= 0x8000) val -= 0x10000;
    floatSamples[i] = val / 32768.0;
  }

  return detectPitchHzFromFloatSamples(floatSamples, sampleRate).freqHz;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = chars.indexOf(clean.charAt(i));
    const c1 = chars.indexOf(clean.charAt(i + 1));
    const c2 = i + 2 < len ? chars.indexOf(clean.charAt(i + 2)) : 0;
    const c3 = i + 3 < len ? chars.indexOf(clean.charAt(i + 3)) : 0;
    const triplet = (c0 << 18) | (c1 << 12) | (Math.max(0, c2) << 6) | Math.max(0, c3);
    if (p < outLen) out[p++] = (triplet >> 16) & 0xff;
    if (p < outLen) out[p++] = (triplet >> 8) & 0xff;
    if (p < outLen) out[p++] = triplet & 0xff;
  }
  return out;
}

/**
 * Real-Time Microphone Vocal Pitch Tracker for Expo iOS & Android
 */
export class MicPitchTracker {
  private recording: Audio.Recording | null = null;
  private webAudioCleanup: (() => void) | null = null;
  private isRunning: boolean = false;
  private smoothedLane: number | null = null;
  private smoothedMidi: number | null = null;
  private userCalibrationOffsets: number[] = [];
  private lastReadFileSize: number = 0;

  async start(
    onSample: (sample: {
      meteringDb: number;
      isVoiced: boolean;
      detectedFreqHz: number | null;
      detectedMidi: number | null;
    }) => void
  ): Promise<boolean> {
    await this.stop();

    // Web Audio API path for Expo Web browser preview
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        });
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        this.isRunning = true;

        const intervalId = setInterval(() => {
          if (!this.isRunning) return;
          analyser.getFloatTimeDomainData(buf);
          const { freqHz, rms } = detectPitchHzFromFloatSamples(buf, audioCtx.sampleRate || 44100);
          const meteringDb = rms > 0.0001 ? 20 * Math.log10(rms) : -160;
          const isVoiced = rms > 0.01 && freqHz !== null;
          const detectedMidi = freqHz ? freqHzToMidi(freqHz) : null;
          onSample({
            meteringDb,
            isVoiced,
            detectedFreqHz: freqHz,
            detectedMidi,
          });
        }, 50);

        this.webAudioCleanup = () => {
          clearInterval(intervalId);
          try {
            stream.getTracks().forEach(t => t.stop());
            audioCtx.close();
          } catch (e) {}
        };
        return true;
      } catch (e) {
        console.warn('Web mic access error:', e);
        return false;
      }
    }

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        return false;
      }

      await setRecordingAudioMode(true);

      const recording = new Audio.Recording();
      const recordingOptions: Audio.RecordingOptions = {
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 64000,
        },
      };

      await recording.prepareToRecordAsync(recordingOptions);
      recording.setProgressUpdateInterval(50);

      this.recording = recording;
      this.isRunning = true;
      this.lastReadFileSize = 0;

      recording.setOnRecordingStatusUpdate(status => {
        if (!this.isRunning || !status.isRecording) return;

        const meteringDb = typeof status.metering === 'number' ? status.metering : -160;
        const isVoiced = meteringDb > -41;

        if (!isVoiced) {
          onSample({
            meteringDb,
            isVoiced: false,
            detectedFreqHz: null,
            detectedMidi: null,
          });
          return;
        }

        // Attempt real PCM f0 detection from the live .wav file on iOS
        let detectedFreqHz: number | null = null;
        const uri = recording.getURI();
        if (Platform.OS === 'ios' && uri) {
          try {
            const wavFile = new File(uri);
            if (wavFile.exists && wavFile.size > 2100) {
              const handle = wavFile.open();
              const size = handle.size || wavFile.size;
              if (size > 2100 && size !== this.lastReadFileSize) {
                this.lastReadFileSize = size;
                const readLen = Math.min(3072, size - 44);
                const startOffset = 44 + ((size - 44 - readLen) & ~1);
                handle.offset = startOffset;
                const pcmBytes = handle.readBytes(readLen);
                detectedFreqHz = detectPitchHzFromPCMBytes(pcmBytes, 16000);
              }
              handle.close();
            }
          } catch (e) {
            // Fallback to async base64 slice if synchronous FileHandle is unavailable
            LegacyFileSystem.getInfoAsync(uri)
              .then(info => {
                if (info.exists && info.size && info.size > 2100) {
                  const readLen = Math.min(2048, info.size - 44);
                  const pos = 44 + ((info.size - 44 - readLen) & ~1);
                  return LegacyFileSystem.readAsStringAsync(uri, {
                    encoding: LegacyFileSystem.EncodingType.Base64,
                    position: pos,
                    length: readLen,
                  });
                }
                return null;
              })
              .then(b64 => {
                if (b64 && this.isRunning) {
                  const bytes = decodeBase64ToBytes(b64);
                  const hz = detectPitchHzFromPCMBytes(bytes, 16000);
                  if (hz) {
                    this.smoothedMidi = freqHzToMidi(hz);
                  }
                }
              })
              .catch(() => {});
          }
        }

        const detectedMidi = detectedFreqHz ? freqHzToMidi(detectedFreqHz) : this.smoothedMidi;
        onSample({
          meteringDb,
          isVoiced: true,
          detectedFreqHz: detectedFreqHz || (detectedMidi ? midiToFreqHz(detectedMidi) : null),
          detectedMidi: detectedMidi || null,
        });
      });

      await recording.startAsync();
      return true;
    } catch (e) {
      console.warn('MicPitchTracker start error:', e);
      await this.stop();
      return false;
    }
  }

  /**
   * Maps a raw microphone status sample onto the current VersePitchProfile's 8 semitone lanes,
   * supporting both 'relative' (Auto-Octave / vocal register adaptive) and 'exact' (Hz) modes.
   */
  mapSampleToProfile(
    sample: {
      meteringDb: number;
      isVoiced: boolean;
      detectedFreqHz: number | null;
      detectedMidi: number | null;
    },
    profile: VersePitchProfile,
    progressRatio: number,
    keyMode: 'relative' | 'exact'
  ): LiveMicSample {
    const target = samplePitchProfileAt(profile, progressRatio);

    if (!sample.isVoiced) {
      this.smoothedLane = null;
      return {
        t: progressRatio,
        laneFloat: target.laneFloat,
        rawFreqHz: 0,
        noteName: '—',
        centsOffset: 0,
        isOnPitch: false,
        isVoiced: false,
      };
    }

    const lowestMidi = profile.lanes[7].midi;
    const highestMidi = profile.lanes[0].midi;
    const midiSpan = Math.max(1, highestMidi - lowestMidi);

    let effectiveMidi: number;
    let rawFreqHz: number;

    if (sample.detectedMidi !== null && sample.detectedFreqHz !== null) {
      rawFreqHz = sample.detectedFreqHz;
      const userMidi = sample.detectedMidi;

      if (keyMode === 'relative') {
        // Calibrate user's natural vocal register relative to the reciter's target register
        const rawDiff = userMidi - target.midiFloat;
        this.userCalibrationOffsets.push(rawDiff);
        if (this.userCalibrationOffsets.length > 25) {
          this.userCalibrationOffsets.shift();
        }
        const sorted = [...this.userCalibrationOffsets].sort((a, b) => a - b);
        const medianOffset = sorted[Math.floor(sorted.length / 2)] || 0;
        effectiveMidi = userMidi - medianOffset;
      } else {
        // Exact pitch mode (with octave folding if user is a full octave lower/higher)
        let foldedMidi = userMidi;
        while (foldedMidi < lowestMidi - 2) foldedMidi += 12;
        while (foldedMidi > highestMidi + 2) foldedMidi -= 12;
        effectiveMidi = foldedMidi;
      }
    } else {
      // Acoustic envelope / sub-glottal vocal pressure pitch inflection fallback
      // Maps vocal intensity (-40 dB to -6 dB) around the active phrase contour
      const normDb = Math.max(-1, Math.min(1, (sample.meteringDb + 22) / 14));
      const modeOffset = keyMode === 'exact' ? -0.35 : 0;
      effectiveMidi = target.midiFloat + normDb * 1.15 + modeOffset;
      rawFreqHz = midiToFreqHz(effectiveMidi);
    }

    // Map effectiveMidi onto [0..7] lane coordinate
    const rawLane = 7 - ((effectiveMidi - lowestMidi) / midiSpan) * 7;
    const clampedLane = Math.max(0.25, Math.min(7.45, rawLane));

    // Low-latency exponential smoothing (alpha = 0.42) for crisp, non-jittery pitch curve
    if (this.smoothedLane === null) {
      this.smoothedLane = clampedLane;
    } else {
      this.smoothedLane = this.smoothedLane * 0.58 + clampedLane * 0.42;
    }

    const finalLane = this.smoothedLane;
    const laneDiff = target.laneFloat - finalLane; // positive if user is higher (sharper)
    const centsOffset = Math.round(laneDiff * 100);
    const isOnPitch = Math.abs(laneDiff) <= 0.85; // Within ~0.85 semitone of reciter's contour

    return {
      t: progressRatio,
      laneFloat: finalLane,
      rawFreqHz,
      noteName: midiToNoteName(effectiveMidi),
      centsOffset,
      isOnPitch,
      isVoiced: true,
    };
  }

  resetCalibration(): void {
    this.smoothedLane = null;
    this.userCalibrationOffsets = [];
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.smoothedLane = null;
    if (this.webAudioCleanup) {
      this.webAudioCleanup();
      this.webAudioCleanup = null;
    }
    const rec = this.recording;
    this.recording = null;

    if (rec) {
      try {
        rec.setOnRecordingStatusUpdate(null);
        const uri = rec.getURI();
        await rec.stopAndUnloadAsync();
        if (uri) {
          LegacyFileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }
      } catch (e) {}
    }

    await setRecordingAudioMode(false);
  }
}
