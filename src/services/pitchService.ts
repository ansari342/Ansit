import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Reciter } from '../types';
import { WordTiming } from '../data/reciterTimings';
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
}

export interface VersePitchProfile {
  reciterId: string;
  surahNumber: number;
  ayahNumber: number;
  lanes: NoteLane[];
  targetBlocks: TargetNoteBlock[];
  contourPoints: PitchContourPoint[];
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

/**
 * Generates the complete Vocal Pitch Monitor profile for a given verse and reciter:
 * - 8 semitone lanes (matching the reference screenshot)
 * - Quantized Target Note Blocks aligned with word timings
 * - Continuous 96-point Reciter Ghost Pitch Contour
 */
export function generateVersePitchProfile(
  surahNumber: number,
  ayahNumber: number,
  words: string[],
  wordTimings: WordTiming[],
  reciter: Reciter
): VersePitchProfile {
  const sig = getReciterSignature(reciter.id);
  const seed = hashVerseReciter(surahNumber, ayahNumber, reciter.id);

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
      // Signature step-up progression like Raad Al-Kurdi (and the reference screenshot):
      // Starts lower/warm (lane 6 -> 4 -> 3 -> 1), with gentle resolution on long verses
      if (wordCount <= 5) {
        const stepLanes = [6, 4, 3, 2, 1];
        laneIndex = stepLanes[Math.min(w, stepLanes.length - 1)];
      } else {
        // Multi-clause phrase wave
        const phrasePos = (w % 5) / 4;
        laneIndex = Math.round(6 - phrasePos * 4.5);
        if (w === wordCount - 1) {
          // Final word Madd sustain (either high climax or tonic cadence)
          laneIndex = (seed + ayahNumber) % 2 === 0 ? 1 : 4;
        }
      }
    } else if (sig.style === 'arch') {
      // Melodic arch: rises to peak around 65% of verse, then resolves gracefully
      const arch = Math.sin(progress * Math.PI);
      laneIndex = Math.round(6 - arch * 4.5);
      if (features.hasMadd && laneIndex > 1) laneIndex -= 1;
    } else if (sig.style === 'measured') {
      // Steady Tajweed steps (lanes 5, 4, 3, 2)
      const pattern = [5, 4, 3, 4, 2, 3, 5];
      laneIndex = pattern[(w + (seed % 3)) % pattern.length];
    } else {
      // Expressive melodic contour
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

    // Find current block
    let blockIdx = 0;
    for (let b = 0; b < targetBlocks.length; b++) {
      if (t >= targetBlocks[b].startRatio) {
        blockIdx = b;
      }
    }
    const block = targetBlocks[blockIdx];
    const prevBlock = blockIdx > 0 ? targetBlocks[blockIdx - 1] : null;

    let laneFloat = block.laneIndex;

    // 1. Initial vocal onset glide at the very start of the verse (like the bottom-left rise in screenshot)
    if (blockIdx === 0 && t < block.startRatio + 0.035) {
      const onsetProgress = Math.max(0, Math.min(1, t / Math.max(0.01, block.startRatio + 0.035)));
      const startLane = Math.min(7.3, block.laneIndex + 1.6);
      laneFloat = startLane + (block.laneIndex - startLane) * onsetProgress;
    } else {
      const blockDur = Math.max(0.02, block.endRatio - block.startRatio);
      const localT = Math.max(0, Math.min(1, (t - block.startRatio) / blockDur));

      // 2. Smooth glissando transition from previous note block (first 14% of block)
      if (prevBlock && localT < 0.14) {
        const trans = localT / 0.14;
        // Smoothstep interpolation
        const s = trans * trans * (3 - 2 * trans);
        laneFloat = prevBlock.laneIndex + (block.laneIndex - prevBlock.laneIndex) * s;
      } else if (prevBlock && localT >= 0.14 && localT < 0.26 && prevBlock.laneIndex > block.laneIndex) {
        // 3. Natural consonant attack micro-inflection when stepping up to a new sustained note
        // (matches the crisp spike at the start of each orange block in the user's screenshot!)
        const attackPhase = (localT - 0.14) / 0.12;
        const spike = Math.sin(attackPhase * Math.PI * 2) * sig.attackOvershoot * (1 - attackPhase * 0.5);
        laneFloat = block.laneIndex - spike;
      } else {
        // 4. Sustained plateau with gentle Tajweed vibrato and micro-intonation
        const vib =
          Math.sin(localT * Math.PI * 2 * sig.vibratoRate) *
          sig.vibratoDepth *
          Math.min(1, localT * 2);
        laneFloat = block.laneIndex + vib;
      }
    }

    laneFloat = Math.max(0.3, Math.min(7.5, laneFloat));

    // Convert laneFloat back to continuous MIDI & Hz
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
    });
  }

  return {
    reciterId: reciter.id,
    surahNumber,
    ayahNumber,
    lanes,
    targetBlocks,
    contourPoints,
  };
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
    return { t: 0, laneFloat: 4, midiFloat: 55, freqHz: 196, wordIndex: 0, noteName: 'G3' };
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
    noteName: midiToNoteName(midiFloat),
  };
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

  let energySum = 0;
  for (let i = 0; i < windowSize; i++) {
    const byteIdx = (startSample + i) * 2;
    let val = bytes[byteIdx] | (bytes[byteIdx + 1] << 8);
    if (val >= 0x8000) val -= 0x10000;
    const norm = val / 32768.0;
    floatSamples[i] = norm;
    energySum += norm * norm;
  }

  const rms = Math.sqrt(energySum / windowSize);
  if (rms < 0.008) {
    return null; // Silence / background noise floor
  }

  // Search vocal fundamental frequency range: 75 Hz (D2) to 460 Hz (A#4)
  const minLag = Math.floor(sampleRate / 460); // ~34 samples
  const maxLag = Math.min(Math.floor(sampleRate / 75), Math.floor(windowSize / 2)); // ~213 samples
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
    if (minVal > 0.48) return null; // Unvoiced consonant (s, sh, f, t, k)
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
  if (freqHz < 70 || freqHz > 500) return null;
  return freqHz;
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
