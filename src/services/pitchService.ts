import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { Reciter } from '../types';
import { SURAH_PITCH_HD } from '../data/surahPitchHD';
import { REAL_RECITER_PITCH } from '../data/realReciterPitch';
import { BASE_RECITERS } from '../data/reciters';
import { setRecordingAudioMode } from './audioService';
import {
  isNativePitchDetectorAvailable,
  startNativePitchDetector,
  stopNativePitchDetector,
  addNativePitchListener,
  Subscription,
} from '../../modules/aya-pitch-detector';

export { midiToFreqHz, freqHzToMidi, midiToNoteName, detectPitchHzFromFloatSamples } from '../core/yin';
import { midiToFreqHz, freqHzToMidi, midiToNoteName, detectPitchHzFromFloatSamples } from '../core/yin';

// ---------------------------------------------------------------------------------------------
// Reciter voice pitch tracks
// ---------------------------------------------------------------------------------------------

/**
 * A reciter's fundamental-frequency contour for one ayah, sampled on a fixed grid.
 * `midi[i]` is the pitch at `startMs + i * hopMs` within the recording (0 = unvoiced / pause).
 */
export interface VersePitchTrack {
  reciterId: string;
  surahNumber: number;
  ayahNumber: number;
  /** Absolute recording time (ms) of frame 0. */
  startMs: number;
  /** Absolute recording time (ms) of the end of the last frame. */
  endMs: number;
  hopMs: number;
  midi: number[];
  /** Display range: lowest / highest MIDI (semitones) covering the voiced frames with padding. */
  minMidi: number;
  maxMidi: number;
  source: 'hd' | 'coarse' | 'live';
}

export interface PitchSamplePoint {
  midi: number;
  freqHz: number;
  noteName: string;
  isVoiced: boolean;
}

function resolveReciterId(reciter: Reciter): string {
  return reciter.id === 'multiple' ? BASE_RECITERS[0].id : reciter.id;
}

function computeDisplayRange(midi: number[]): { minMidi: number; maxMidi: number } {
  const voiced = midi.filter(m => m > 0).sort((a, b) => a - b);
  if (voiced.length === 0) return { minMidi: 45, maxMidi: 60 };
  const p02 = voiced[Math.floor(voiced.length * 0.02)];
  const p98 = voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * 0.98))];
  let minMidi = Math.floor(p02) - 1;
  let maxMidi = Math.ceil(p98) + 1;
  // Keep at least one octave visible so the curve has room to breathe
  while (maxMidi - minMidi < 12) {
    minMidi -= 1;
    if (maxMidi - minMidi < 12) maxMidi += 1;
  }
  return { minMidi, maxMidi };
}

/**
 * Returns the millisecond-accurate (10 ms hop) pitch track for an ayah when the whole-surah HD map
 * exists for this reciter, else a coarse 96-slice contour, else null.
 *
 * `ayahStartMs` / `ayahEndMs` are the absolute recording boundaries of the ayah being played.
 */
export function getVersePitchTrack(
  reciter: Reciter,
  surahNumber: number,
  ayahNumber: number,
  ayahStartMs: number,
  ayahEndMs: number
): VersePitchTrack | null {
  const reciterId = resolveReciterId(reciter);

  const hd = SURAH_PITCH_HD[reciterId]?.[surahNumber];
  if (hd && ayahEndMs > ayahStartMs) {
    const startFrame = Math.max(0, Math.floor(ayahStartMs / hd.hopMs));
    const endFrame = Math.min(hd.midi.length, Math.ceil(ayahEndMs / hd.hopMs));
    if (endFrame - startFrame >= 10) {
      const midi = hd.midi.slice(startFrame, endFrame);
      const range = computeDisplayRange(midi);
      return {
        reciterId,
        surahNumber,
        ayahNumber,
        startMs: startFrame * hd.hopMs,
        endMs: endFrame * hd.hopMs,
        hopMs: hd.hopMs,
        midi,
        ...range,
        source: 'hd',
      };
    }
  }

  const coarse = REAL_RECITER_PITCH[reciterId]?.[surahNumber]?.[ayahNumber];
  if (coarse && coarse.length > 1) {
    const durationMs = Math.max(1000, ayahEndMs - ayahStartMs);
    const hopMs = durationMs / coarse.length;
    const range = computeDisplayRange(coarse);
    return {
      reciterId,
      surahNumber,
      ayahNumber,
      startMs: ayahStartMs,
      endMs: ayahStartMs + durationMs,
      hopMs,
      midi: coarse,
      ...range,
      source: 'coarse',
    };
  }

  return null;
}

/** Samples the reciter's pitch at an absolute recording time (ms), interpolating between frames. */
export function sampleTrackAtMs(track: VersePitchTrack, absoluteMs: number): PitchSamplePoint {
  const rel = (absoluteMs - track.startMs) / track.hopMs;
  const i0 = Math.max(0, Math.min(track.midi.length - 1, Math.floor(rel)));
  const i1 = Math.min(track.midi.length - 1, i0 + 1);
  const frac = Math.max(0, Math.min(1, rel - i0));
  const a = track.midi[i0];
  const b = track.midi[i1];

  let midi = 0;
  if (a > 0 && b > 0) midi = a + (b - a) * frac;
  else if (a > 0) midi = a;
  else if (b > 0 && frac > 0.5) midi = b;

  if (midi <= 0) {
    return { midi: 0, freqHz: 0, noteName: '—', isVoiced: false };
  }
  return { midi, freqHz: midiToFreqHz(midi), noteName: midiToNoteName(midi), isVoiced: true };
}

// ---------------------------------------------------------------------------------------------
// On-demand HD extraction for verses without a shipped map (Web Audio API only)
// ---------------------------------------------------------------------------------------------

const liveTrackCache = new Map<string, VersePitchTrack>();
const inFlight = new Map<string, Promise<VersePitchTrack | null>>();

function extractHdContour(channel: Float32Array, sampleRate: number, hopMs: number): number[] {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const win = Math.min(channel.length, Math.round(sampleRate * 0.064));
  const frames = Math.max(0, Math.floor((channel.length - win) / hop));
  const raw: number[] = new Array(frames).fill(0);
  const rmsArr: number[] = new Array(frames).fill(0);
  for (let f = 0; f < frames; f++) {
    const slice = channel.subarray(f * hop, f * hop + win);
    const r = detectPitchHzFromFloatSamples(slice, sampleRate, 70, 420);
    rmsArr[f] = r.rms;
    raw[f] = r.freqHz && r.confidence < 0.4 ? freqHzToMidi(r.freqHz) : 0;
  }
  const sorted = [...rmsArr].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0.05;
  const gate = Math.max(0.005, p95 * 0.05);
  for (let f = 0; f < frames; f++) if (rmsArr[f] < gate) raw[f] = 0;

  // Drop < 40 ms voiced islands, bridge <= 60 ms gaps, 5-point median
  let f = 0;
  while (f < frames) {
    if (raw[f] > 0) {
      let j = f;
      while (j < frames && raw[j] > 0) j++;
      if (j - f < 4) for (let k = f; k < j; k++) raw[k] = 0;
      f = j;
    } else f++;
  }
  f = 0;
  while (f < frames) {
    if (raw[f] === 0) {
      let j = f;
      while (j < frames && raw[j] === 0) j++;
      const gap = j - f;
      if (gap <= 6 && f > 0 && j < frames && Math.abs(raw[f - 1] - raw[j]) < 5) {
        for (let k = f; k < j; k++) raw[k] = raw[f - 1] + ((raw[j] - raw[f - 1]) * (k - f + 1)) / (gap + 1);
      }
      f = j;
    } else f++;
  }
  const out: number[] = new Array(frames).fill(0);
  for (let i = 0; i < frames; i++) {
    if (raw[i] <= 0) continue;
    const w: number[] = [];
    for (let d = -2; d <= 2; d++) {
      const v = raw[i + d];
      if (v && v > 0) w.push(v);
    }
    w.sort((a, b) => a - b);
    out[i] = Number(w[Math.floor(w.length / 2)].toFixed(1));
  }
  return out;
}

/**
 * Decodes the reciter's recording for an ayah in the browser and maps its 10 ms pitch contour.
 * Resolves null on native platforms (no Web Audio) or on any network / decode failure.
 */
export async function extractVersePitchTrackAsync(
  reciter: Reciter,
  surahNumber: number,
  ayahNumber: number,
  ayahStartMs: number,
  ayahEndMs: number,
  totalTrackDurationMs: number
): Promise<VersePitchTrack | null> {
  const reciterId = resolveReciterId(reciter);
  const key = `${reciterId}_${surahNumber}_${ayahNumber}`;
  const cached = liveTrackCache.get(key);
  if (cached) return cached;

  const AudioCtx =
    typeof window !== 'undefined'
      ? (window as any).AudioContext || (window as any).webkitAudioContext
      : null;
  if (!AudioCtx) return null;

  let task = inFlight.get(key);
  if (!task) {
    task = (async (): Promise<VersePitchTrack | null> => {
      try {
        const actual = BASE_RECITERS.find(r => r.id === reciterId) || reciter;
        const surahStr = String(surahNumber).padStart(3, '0');
        const ayahStr = String(ayahNumber).padStart(3, '0');
        let bytes: ArrayBuffer;
        let trackStartMs = ayahStartMs;

        if (reciterId !== 'raad' && actual.subfolder) {
          const resp = await fetch(`https://everyayah.com/data/${actual.subfolder}/${surahStr}${ayahStr}.mp3`);
          if (!resp.ok) return null;
          bytes = await resp.arrayBuffer();
        } else {
          const url = `https://cdn.mp3quran.net/audio/raad-kurdi/r1/${surahStr}.mp3`;
          const head = await fetch(url, { headers: { Range: 'bytes=0-15' } });
          const total = parseInt((head.headers.get('content-range') || '').split('/')[1] || '0', 10);
          if (!total || totalTrackDurationMs <= 1000) return null;
          const startByte = Math.max(0, Math.floor((ayahStartMs / totalTrackDurationMs) * total) - 4096);
          const endByte = Math.min(total - 1, Math.ceil((ayahEndMs / totalTrackDurationMs) * total) + 4096);
          const resp = await fetch(url, { headers: { Range: `bytes=${startByte}-${endByte}` } });
          if (!resp.ok && resp.status !== 206) return null;
          const raw = new Uint8Array(await resp.arrayBuffer());
          let sync = 0;
          for (let k = 0; k < Math.min(4096, raw.length - 4); k++) {
            if (raw[k] === 0xff && (raw[k + 1] & 0xe0) === 0xe0) {
              sync = k;
              break;
            }
          }
          bytes = raw.buffer.slice(raw.byteOffset + sync, raw.byteOffset + raw.byteLength);
          trackStartMs = (startByte / total) * totalTrackDurationMs;
        }

        const ctx = new AudioCtx();
        try {
          const decoded = await ctx.decodeAudioData(bytes);
          const contour = extractHdContour(decoded.getChannelData(0), decoded.sampleRate, 10);
          if (contour.length < 10) return null;
          const track: VersePitchTrack = {
            reciterId,
            surahNumber,
            ayahNumber,
            startMs: trackStartMs,
            endMs: trackStartMs + contour.length * 10,
            hopMs: 10,
            midi: contour,
            ...computeDisplayRange(contour),
            source: 'live',
          };
          liveTrackCache.set(key, track);
          return track;
        } finally {
          try {
            ctx.close();
          } catch (e) {}
        }
      } catch (e) {
        return null;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, task);
  }
  return task;
}

// ---------------------------------------------------------------------------------------------
// Live microphone pitch tracking
// ---------------------------------------------------------------------------------------------

export interface MicPitchSample {
  /** Absolute recording time (ms) this sample is aligned to. */
  atMs: number;
  isVoiced: boolean;
  /** Raw detected pitch (MIDI, fractional) or 0 when unvoiced. */
  rawMidi: number;
  rawFreqHz: number;
  /** Raw pitch folded by whole octaves into the reciter's display range (for drawing). */
  displayMidi: number;
  noteName: string;
  targetMidi: number;
  targetIsVoiced: boolean;
  /** Signed difference user − reciter in cents, after octave folding. */
  centsOffset: number;
  isOnPitch: boolean;
}

export interface RawMicReading {
  freqHz: number | null;
  rms: number;
  confidence: number;
}

/**
 * Streams the user's live fundamental frequency from the microphone.
 * iOS: native AVAudioEngine tap (AyaPitchDetector). Web: Web Audio API. Others: unsupported.
 */
export class MicPitchTracker {
  private running = false;
  private nativeSub: Subscription | null = null;
  private webCleanup: (() => void) | null = null;
  private smoothedMidi: number | null = null;
  private lastVoicedAt = 0;

  static get isSupported(): boolean {
    if (Platform.OS === 'web') {
      return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    }
    return isNativePitchDetectorAvailable;
  }

  async start(onReading: (reading: RawMicReading) => void): Promise<boolean> {
    await this.stop();

    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        this.running = true;
        const id = setInterval(() => {
          if (!this.running) return;
          analyser.getFloatTimeDomainData(buf);
          const r = detectPitchHzFromFloatSamples(buf, ctx.sampleRate || 44100);
          onReading({ freqHz: r.freqHz, rms: r.rms, confidence: r.confidence });
        }, 25);
        this.webCleanup = () => {
          clearInterval(id);
          try {
            stream.getTracks().forEach(t => t.stop());
            ctx.close();
          } catch (e) {}
        };
        return true;
      } catch (e) {
        console.warn('Web microphone error:', e);
        return false;
      }
    }

    if (!isNativePitchDetectorAvailable) return false;

    try {
      // Ask through expo-av first so its session bookkeeping agrees with play-and-record
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return false;
      await setRecordingAudioMode(true);

      this.nativeSub = addNativePitchListener(event => {
        if (!this.running) return;
        onReading({
          freqHz: event.isVoiced && event.freqHz > 0 ? event.freqHz : null,
          rms: event.rms,
          confidence: event.confidence,
        });
      });
      const started = await startNativePitchDetector();
      if (!started) {
        await this.stop();
        return false;
      }
      this.running = true;
      return true;
    } catch (e) {
      console.warn('Native microphone error:', e);
      await this.stop();
      return false;
    }
  }

  /**
   * Compares a raw microphone reading against the reciter's track at the current playback time.
   * The user's pitch is folded by whole octaves toward the reciter so a lower/higher natural voice
   * is judged on the melody (interval contour), not on the absolute octave.
   */
  compare(reading: RawMicReading, track: VersePitchTrack | null, atMs: number): MicPitchSample {
    const target = track ? sampleTrackAtMs(track, atMs) : { midi: 0, isVoiced: false, freqHz: 0, noteName: '—' };
    const now = Date.now();

    if (reading.freqHz === null || reading.rms < 0.006) {
      // Hold the last pitch for 120 ms across consonants so the trace doesn't flicker
      if (this.smoothedMidi !== null && now - this.lastVoicedAt > 120) {
        this.smoothedMidi = null;
      }
      return {
        atMs,
        isVoiced: false,
        rawMidi: 0,
        rawFreqHz: 0,
        displayMidi: 0,
        noteName: '—',
        targetMidi: target.midi,
        targetIsVoiced: target.isVoiced,
        centsOffset: 0,
        isOnPitch: false,
      };
    }

    const rawMidi = freqHzToMidi(reading.freqHz);
    this.lastVoicedAt = now;

    // Light smoothing (alpha 0.55) — fast enough to follow melisma, enough to kill jitter
    if (this.smoothedMidi === null || Math.abs(rawMidi - this.smoothedMidi) > 4) {
      this.smoothedMidi = rawMidi;
    } else {
      this.smoothedMidi = this.smoothedMidi * 0.45 + rawMidi * 0.55;
    }
    const userMidi = this.smoothedMidi;

    // Octave folding toward the reciter's register
    let displayMidi = userMidi;
    const anchor = target.isVoiced ? target.midi : track ? (track.minMidi + track.maxMidi) / 2 : userMidi;
    while (displayMidi - anchor > 6) displayMidi -= 12;
    while (anchor - displayMidi > 6) displayMidi += 12;

    const centsOffset = target.isVoiced ? Math.round((displayMidi - target.midi) * 100) : 0;
    const isOnPitch = target.isVoiced && Math.abs(centsOffset) <= 75;

    return {
      atMs,
      isVoiced: true,
      rawMidi: userMidi,
      rawFreqHz: reading.freqHz,
      displayMidi,
      noteName: midiToNoteName(userMidi),
      targetMidi: target.midi,
      targetIsVoiced: target.isVoiced,
      centsOffset,
      isOnPitch,
    };
  }

  reset(): void {
    this.smoothedMidi = null;
  }

  async stop(): Promise<void> {
    const wasRunning = this.running;
    this.running = false;
    this.smoothedMidi = null;
    if (this.webCleanup) {
      this.webCleanup();
      this.webCleanup = null;
    }
    if (this.nativeSub) {
      try {
        this.nativeSub.remove();
      } catch (e) {}
      this.nativeSub = null;
    }
    if (Platform.OS !== 'web') {
      await stopNativePitchDetector();
      if (wasRunning) {
        await setRecordingAudioMode(false);
      }
    }
  }
}
