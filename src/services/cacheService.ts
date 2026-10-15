import * as FileSystem from 'expo-file-system/legacy';
import { Reciter } from '../types';
import { getAudioUrl, BASE_RECITERS } from '../data/reciters';

const AUDIO_DIR = `${FileSystem.cacheDirectory}quran_audio/`;

let isDirCreated = false;
// In-memory lookup table for instant 0ms cache hits without blocking on disk I/O
const memoryCacheMap = new Map<string, string>();
const inFlightDownloads = new Map<string, Promise<string | null>>();

function getCacheKey(reciter: Reciter, surah: number, ayah: number): string {
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  if (actualReciter.isSurahBased) {
    return `${actualReciter.id}_${surah}`;
  }
  return `${actualReciter.id}_${surah}_${ayah}`;
}

async function ensureDirectoryExists(): Promise<void> {
  if (isDirCreated) return;
  try {
    const dirInfo = await FileSystem.getInfoAsync(AUDIO_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
    }
    isDirCreated = true;
  } catch (e) {
    console.warn('Failed to create audio cache directory:', e);
  }
}

export function getLocalAudioUri(reciter: Reciter, surah: number, ayah: number): string {
  const actualReciter = reciter.id === 'multiple' ? BASE_RECITERS[0] : reciter;
  const surahStr = surah.toString().padStart(3, '0');
  if (actualReciter.isSurahBased) {
    return `${AUDIO_DIR}${actualReciter.id}_${surahStr}.mp3`;
  }
  const ayahStr = ayah.toString().padStart(3, '0');
  return `${AUDIO_DIR}${actualReciter.id}_${surahStr}${ayahStr}.mp3`;
}

/**
 * Downloads a verse to disk in the background without blocking active playback.
 */
export function cacheVerseInBackground(
  reciter: Reciter,
  surah: number,
  ayah: number
): Promise<string | null> {
  if (reciter.isSurahBased) return Promise.resolve(null);

  const key = getCacheKey(reciter, surah, ayah);
  const existingMem = memoryCacheMap.get(key);
  if (existingMem) return Promise.resolve(existingMem);

  const existingFlight = inFlightDownloads.get(key);
  if (existingFlight) return existingFlight;

  const task = (async () => {
    try {
      await ensureDirectoryExists();
      const localUri = getLocalAudioUri(reciter, surah, ayah);
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists && (fileInfo.size || 0) > 1000) {
        memoryCacheMap.set(key, localUri);
        return localUri;
      }

      const remoteUrl = getAudioUrl(reciter, surah, ayah);
      const result = await FileSystem.downloadAsync(remoteUrl, localUri);
      if (result.status === 200) {
        memoryCacheMap.set(key, result.uri);
        return result.uri;
      }
    } catch (e) {
      // Ignore background cache errors; streaming fallback handles playback
    } finally {
      inFlightDownloads.delete(key);
    }
    return null;
  })();

  inFlightDownloads.set(key, task);
  return task;
}

/**
 * Returns the fastest playable URI immediately:
 * 1. If in memoryCacheMap (0ms), returns local file URI immediately.
 * 2. If on disk (fast stat), returns local file URI and caches in memoryCacheMap.
 * 3. Otherwise returns remoteUrl immediately so AVPlayer starts streaming right away,
 *    while kicking off a non-blocking background download for future loops.
 */
export async function getOrDownloadVerseAudio(
  reciter: Reciter,
  surah: number,
  ayah: number
): Promise<string> {
  const key = getCacheKey(reciter, surah, ayah);

  // 1. Instant 0ms memory cache hit
  const memHit = memoryCacheMap.get(key);
  if (memHit) {
    return memHit;
  }

  const remoteUrl = getAudioUrl(reciter, surah, ayah);
  if (reciter.isSurahBased) {
    return remoteUrl;
  }

  // 2. Quick disk check; if already on disk from a previous session, use it
  try {
    const localUri = getLocalAudioUri(reciter, surah, ayah);
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists && (fileInfo.size || 0) > 1000) {
      memoryCacheMap.set(key, localUri);
      return localUri;
    }
  } catch (e) {}

  // 3. Not on disk yet: trigger background caching for subsequent loops,
  //    and return remoteUrl IMMEDIATELY so playback starts without waiting for full download!
  cacheVerseInBackground(reciter, surah, ayah).catch(() => {});
  return remoteUrl;
}

export async function prefetchVerseRange(
  reciter: Reciter,
  surah: number,
  fromVerse: number,
  toVerse: number
): Promise<void> {
  if (reciter.isSurahBased) {
    return;
  }

  // Pre-cache upcoming verses in small concurrency batches
  const maxToCache = Math.min(toVerse, fromVerse + 10);
  (async () => {
    await ensureDirectoryExists();
    for (let ayah = fromVerse; ayah <= maxToCache; ayah += 3) {
      const batch: Promise<string | null>[] = [
        cacheVerseInBackground(reciter, surah, ayah),
      ];
      if (ayah + 1 <= maxToCache) {
        batch.push(cacheVerseInBackground(reciter, surah, ayah + 1));
      }
      if (ayah + 2 <= maxToCache) {
        batch.push(cacheVerseInBackground(reciter, surah, ayah + 2));
      }
      try {
        await Promise.all(batch);
      } catch (e) {
        break;
      }
    }
  })().catch(() => {});
}
