/**
 * takeService — records the user's recitation ("takes"), stores them per verse, plays them back,
 * and aggregates the words the user marks as weak.
 *
 *  iOS/Android: expo-av Recording (AAC) with metering → amplitude envelope every 100 ms.
 *  Web:         MediaRecorder + AnalyserNode (so the Expo web preview works too).
 *
 * Everything stays on-device.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { setRecordingAudioMode } from './audioService';

export type SlipReason = 'forgot' | 'wrong' | 'tajweed';

export interface WordMark {
  wordIndex: number;
  reason: SlipReason;
}

export interface Take {
  id: string;
  surahNumber: number;
  verse: number;
  uri: string;
  durationMs: number;
  /** dBFS every ENVELOPE_STEP_MS (−160 … 0). */
  envelope: number[];
  createdAt: number;
  marks: WordMark[];
}

export interface WeakWord {
  surahNumber: number;
  verse: number;
  wordIndex: number;
  count: number;
  reasons: Partial<Record<SlipReason, number>>;
  lastAt: number;
}

export const ENVELOPE_STEP_MS = 100;
const MAX_TAKES_PER_VERSE = 3;
const TAKES_KEY = '@aya_takes_v1';
const WEAK_KEY = '@aya_weak_words_v1';
const TAKES_DIR = `${LegacyFileSystem.documentDirectory || ''}takes/`;

export const SLIP_REASON_LABEL: Record<SlipReason, string> = { forgot: 'Forgot', wrong: 'Wrong word', tajweed: 'Tajwīd' };

// ----------------------------------------------------------------------------- storage

let takesCache: Take[] | null = null;
let weakCache: Record<string, WeakWord> | null = null;

async function loadTakes(): Promise<Take[]> {
  if (takesCache) return takesCache;
  try {
    const raw = await AsyncStorage.getItem(TAKES_KEY);
    takesCache = raw ? (JSON.parse(raw) as Take[]) : [];
  } catch (e) {
    takesCache = [];
  }
  return takesCache;
}

async function saveTakes(takes: Take[]): Promise<void> {
  takesCache = takes;
  try {
    await AsyncStorage.setItem(TAKES_KEY, JSON.stringify(takes));
  } catch (e) {}
}

async function loadWeak(): Promise<Record<string, WeakWord>> {
  if (weakCache) return weakCache;
  try {
    const raw = await AsyncStorage.getItem(WEAK_KEY);
    weakCache = raw ? (JSON.parse(raw) as Record<string, WeakWord>) : {};
  } catch (e) {
    weakCache = {};
  }
  return weakCache;
}

export async function getTakesForVerse(surahNumber: number, verse: number): Promise<Take[]> {
  const all = await loadTakes();
  return all.filter(t => t.surahNumber === surahNumber && t.verse === verse).sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateTakeMarks(takeId: string, marks: WordMark[]): Promise<void> {
  const all = await loadTakes();
  const idx = all.findIndex(t => t.id === takeId);
  if (idx === -1) return;
  const prev = all[idx].marks;
  all[idx] = { ...all[idx], marks };
  await saveTakes([...all]);

  // Aggregate newly added marks into weak words
  const weak = await loadWeak();
  const take = all[idx];
  for (const m of marks) {
    if (prev.some(p => p.wordIndex === m.wordIndex && p.reason === m.reason)) continue;
    const key = `${take.surahNumber}:${take.verse}:${m.wordIndex}`;
    const w = weak[key] || { surahNumber: take.surahNumber, verse: take.verse, wordIndex: m.wordIndex, count: 0, reasons: {}, lastAt: 0 };
    w.count += 1;
    w.reasons[m.reason] = (w.reasons[m.reason] || 0) + 1;
    w.lastAt = Date.now();
    weak[key] = w;
  }
  weakCache = weak;
  try {
    await AsyncStorage.setItem(WEAK_KEY, JSON.stringify(weak));
  } catch (e) {}
}

export async function getWeakWords(surahNumber: number, fromVerse?: number, toVerse?: number): Promise<WeakWord[]> {
  const weak = await loadWeak();
  return Object.values(weak)
    .filter(w => w.surahNumber === surahNumber && (fromVerse === undefined || (w.verse >= fromVerse && w.verse <= (toVerse ?? fromVerse))))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

export async function deleteTake(takeId: string): Promise<void> {
  const all = await loadTakes();
  const t = all.find(x => x.id === takeId);
  if (t && Platform.OS !== 'web') LegacyFileSystem.deleteAsync(t.uri, { idempotent: true }).catch(() => {});
  await saveTakes(all.filter(x => x.id !== takeId));
}

async function persistTake(take: Take): Promise<Take> {
  const all = await loadTakes();
  const sameVerse = all.filter(t => t.surahNumber === take.surahNumber && t.verse === take.verse).sort((a, b) => b.createdAt - a.createdAt);
  const overflow = sameVerse.slice(MAX_TAKES_PER_VERSE - 1);
  for (const old of overflow) {
    if (Platform.OS !== 'web') LegacyFileSystem.deleteAsync(old.uri, { idempotent: true }).catch(() => {});
  }
  const kept = all.filter(t => !overflow.some(o => o.id === t.id));
  await saveTakes([take, ...kept]);
  return take;
}

/** Pauses longer than `minMs` where the level stays under `thresholdDb`, in envelope coordinates. */
export function detectPauses(envelope: number[], thresholdDb: number = -45, minMs: number = 800): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  let i = 0;
  while (i < envelope.length) {
    if (envelope[i] < thresholdDb) {
      let j = i;
      while (j < envelope.length && envelope[j] < thresholdDb) j++;
      const len = (j - i) * ENVELOPE_STEP_MS;
      if (len >= minMs && i > 0 && j < envelope.length) out.push({ startMs: i * ENVELOPE_STEP_MS, endMs: j * ENVELOPE_STEP_MS });
      i = j;
    } else i++;
  }
  return out;
}

// ----------------------------------------------------------------------------- recording

export interface RecorderHandle {
  stop: () => Promise<Take | null>;
  cancel: () => Promise<void>;
}

export type LevelListener = (db: number, elapsedMs: number) => void;

export async function startTakeRecording(
  surahNumber: number,
  verse: number,
  onLevel?: LevelListener
): Promise<RecorderHandle | null> {
  const envelope: number[] = [];
  const startedAt = Date.now();
  const id = `${surahNumber}_${verse}_${startedAt}`;

  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const chunks: BlobPart[] = [];
      const recorder = new (window as any).MediaRecorder(stream);
      recorder.ondataavailable = (e: any) => e.data && e.data.size > 0 && chunks.push(e.data);
      recorder.start(250);
      const tick = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let energy = 0;
        for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
        const rms = Math.sqrt(energy / buf.length);
        const db = rms > 1e-6 ? Math.max(-160, 20 * Math.log10(rms)) : -160;
        envelope.push(Math.round(db));
        onLevel?.(db, Date.now() - startedAt);
      }, ENVELOPE_STEP_MS);
      const teardown = () => {
        clearInterval(tick);
        try {
          stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
          ctx.close();
        } catch (e) {}
      };
      return {
        stop: () =>
          new Promise<Take | null>(resolve => {
            recorder.onstop = async () => {
              teardown();
              const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
              const take: Take = {
                id,
                surahNumber,
                verse,
                uri: URL.createObjectURL(blob),
                durationMs: Date.now() - startedAt,
                envelope,
                createdAt: startedAt,
                marks: [],
              };
              resolve(await persistTake(take));
            };
            recorder.stop();
          }),
        cancel: async () => {
          try {
            recorder.onstop = null;
            recorder.stop();
          } catch (e) {}
          teardown();
        },
      };
    } catch (e) {
      return null;
    }
  }

  try {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return null;
    await setRecordingAudioMode(true);
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
    recording.setProgressUpdateInterval(ENVELOPE_STEP_MS);
    let lastDuration = 0;
    recording.setOnRecordingStatusUpdate(st => {
      if (!st.isRecording) return;
      const db = typeof st.metering === 'number' ? st.metering : -160;
      envelope.push(Math.round(db));
      lastDuration = st.durationMillis;
      onLevel?.(db, st.durationMillis);
    });
    await recording.startAsync();

    const finish = async (keep: boolean): Promise<Take | null> => {
      try {
        recording.setOnRecordingStatusUpdate(null);
        await recording.stopAndUnloadAsync();
      } catch (e) {}
      await setRecordingAudioMode(false);
      const tmpUri = recording.getURI();
      if (!keep || !tmpUri) {
        if (tmpUri) LegacyFileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
        return null;
      }
      let uri = tmpUri;
      try {
        const info = await LegacyFileSystem.getInfoAsync(TAKES_DIR);
        if (!info.exists) await LegacyFileSystem.makeDirectoryAsync(TAKES_DIR, { intermediates: true });
        const ext = tmpUri.split('.').pop() || 'm4a';
        uri = `${TAKES_DIR}${id}.${ext}`;
        await LegacyFileSystem.moveAsync({ from: tmpUri, to: uri });
      } catch (e) {
        uri = tmpUri;
      }
      const take: Take = {
        id,
        surahNumber,
        verse,
        uri,
        durationMs: lastDuration || Date.now() - startedAt,
        envelope,
        createdAt: startedAt,
        marks: [],
      };
      return persistTake(take);
    };

    return { stop: () => finish(true), cancel: async () => void (await finish(false)) };
  } catch (e) {
    await setRecordingAudioMode(false).catch(() => {});
    return null;
  }
}

// ----------------------------------------------------------------------------- playback

let takeSound: Audio.Sound | null = null;

export async function stopTakePlayback(): Promise<void> {
  const s = takeSound;
  takeSound = null;
  if (s) {
    try {
      s.setOnPlaybackStatusUpdate(null);
      await s.stopAsync();
      await s.unloadAsync();
    } catch (e) {}
  }
}

/** Plays a take; resolves when it finishes (or is stopped). `onProgress` gets positionMs. */
export function playTake(take: Take, onProgress?: (positionMs: number) => void): Promise<void> {
  return new Promise(async resolve => {
    await stopTakePlayback();
    try {
      if (Platform.OS !== 'web') await setRecordingAudioMode(false);
      const { sound } = await Audio.Sound.createAsync({ uri: take.uri }, { shouldPlay: true, progressUpdateIntervalMillis: 60 });
      takeSound = sound;
      let done = false;
      sound.setOnPlaybackStatusUpdate(st => {
        if (!st.isLoaded) return;
        onProgress?.(st.positionMillis);
        if (st.didJustFinish && !done) {
          done = true;
          sound.setOnPlaybackStatusUpdate(null);
          sound.unloadAsync().catch(() => {});
          if (takeSound === sound) takeSound = null;
          resolve();
        }
      });
    } catch (e) {
      resolve();
    }
  });
}
