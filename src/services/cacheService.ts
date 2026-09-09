import * as FileSystem from 'expo-file-system/legacy';
import { Reciter } from '../types';
import { getAudioUrl, BASE_RECITERS } from '../data/reciters';

const AUDIO_DIR = `${FileSystem.cacheDirectory}quran_audio/`;

let isDirCreated = false;

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

export async function getOrDownloadVerseAudio(
  reciter: Reciter,
  surah: number,
  ayah: number
): Promise<string> {
  await ensureDirectoryExists();
  const localUri = getLocalAudioUri(reciter, surah, ayah);

  try {
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (fileInfo.exists && (fileInfo.size || 0) > 1000) {
      return localUri;
    }
  } catch (e) {
    // proceed to download
  }

  const remoteUrl = getAudioUrl(reciter, surah, ayah);

  if (reciter.isSurahBased) {
    // For surah-based continuous audio, stream directly so AVPlayer has full bandwidth
    // and doesn't compete with a concurrent download socket on cellular/CarPlay.
    return remoteUrl;
  }

  try {
    const result = await FileSystem.downloadAsync(remoteUrl, localUri);
    if (result.status === 200) {
      return result.uri;
    }
  } catch (err) {
    console.warn(`Failed to cache ${remoteUrl}, falling back to direct stream:`, err);
  }

  return remoteUrl;
}

export async function prefetchVerseRange(
  reciter: Reciter,
  surah: number,
  fromVerse: number,
  toVerse: number
): Promise<void> {
  await ensureDirectoryExists();
  if (reciter.isSurahBased) {
    getOrDownloadVerseAudio(reciter, surah, 1).catch(err => {
      console.warn('Background pre-fetch warning:', err);
    });
    return;
  }
  const promises: Promise<string>[] = [];
  for (let ayah = fromVerse; ayah <= toVerse; ayah++) {
    promises.push(getOrDownloadVerseAudio(reciter, surah, ayah));
  }
  Promise.all(promises).catch(err => {
    console.warn('Background pre-fetch warning:', err);
  });
}
