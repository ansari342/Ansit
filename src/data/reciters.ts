import { Reciter } from '../types';

export const MULTIPLE_RECITER_ID = 'multiple';

export const MULTIPLE_RECITER: Reciter = {
  id: MULTIPLE_RECITER_ID,
  name: 'Multiple Reciters',
  shortName: 'Multiple',
  subfolder: 'multiple',
  badge: 'Cycles on Loop',
};

export const BASE_RECITERS: Reciter[] = [
  {
    id: 'mishary',
    name: 'Mishary Rashid Alafasy',
    shortName: 'Mishary Alafasy',
    subfolder: 'Alafasy_128kbps',
    isSurahBased: true,
    quranComId: 7,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/mishari_al_afasy/murattal/{surah}.mp3',
    badge: 'Seamless Studio',
  },
  {
    id: 'raad',
    name: 'Raad Mohammad Al-Kurdi',
    shortName: 'Raad Al-Kurdi',
    subfolder: 'kurdi',
    isSurahBased: true,
    baseUrl: 'https://server6.mp3quran.net/kurdi/',
    badge: 'Soulful Recitation',
  },
  {
    id: 'abdulbasit',
    name: 'Abdul Basit Abdul Samad (Murattal)',
    shortName: 'Abdul Basit',
    subfolder: 'Abdul_Basit_Murattal_192kbps',
    isSurahBased: true,
    quranComId: 2,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/abdul_baset/murattal/{surah}.mp3',
    badge: 'Golden Voice',
  },
  {
    id: 'husary',
    name: 'Mahmoud Khalil Al-Husary',
    shortName: 'Al-Husary',
    subfolder: 'Husary_128kbps',
    isSurahBased: true,
    quranComId: 6,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/khalil_al_husary/murattal/{surah}.mp3',
    badge: 'Master of Tajweed',
  },
  {
    id: 'ghamdi',
    name: 'Saad Al-Ghamdi',
    shortName: 'Saad Al-Ghamdi',
    subfolder: 'Ghamadi_40kbps',
    isSurahBased: true,
    quranComId: 13,
    surahUrlPattern: 'https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete/{surah3}.mp3',
  },
  {
    id: 'sudais',
    name: 'Abdur-Rahman As-Sudais',
    shortName: 'As-Sudais',
    subfolder: 'Abdurrahmaan_As-Sudais_192kbps',
    isSurahBased: true,
    quranComId: 3,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/{surah}.mp3',
    badge: 'Imam of Haram',
  },
  {
    id: 'shuraim',
    name: 'Saud Al-Shuraim',
    shortName: 'Al-Shuraim',
    subfolder: 'Saood_ash-Shuraym_128kbps',
    isSurahBased: true,
    quranComId: 10,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/saud_ash-shuraym/murattal/{surah3}.mp3',
  },
  {
    id: 'muaiqly',
    name: 'Maher Al-Muaiqly',
    shortName: 'Al-Muaiqly',
    subfolder: 'MaherAlMuaiqly128kbps',
  },
  {
    id: 'dussary',
    name: 'Yasser Al-Dosari',
    shortName: 'Al-Dosari',
    subfolder: 'Yasser_Ad-Dussary_128kbps',
    isSurahBased: true,
    quranComId: 97,
    surahUrlPattern: 'https://download.quranicaudio.com/quran/yasser_ad-dussary/{surah3}.mp3',
    badge: 'Melodic & Deep',
  },
  {
    id: 'minshawi',
    name: 'Muhammad Siddiq Al-Minshawi (Murattal)',
    shortName: 'Al-Minshawi',
    subfolder: 'Minshawy_Murattal_128kbps',
    isSurahBased: true,
    quranComId: 9,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/siddiq_minshawi/murattal/{surah}.mp3',
    badge: 'Reverent Murattal',
  },
  {
    id: 'minshawi_mujawwad',
    name: 'Muhammad Siddiq Al-Minshawi (Mujawwad)',
    shortName: 'Minshawi (Mujawwad)',
    subfolder: 'Minshawy_Mujawwad_192kbps',
    isSurahBased: true,
    quranComId: 8,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/siddiq_al-minshawi/mujawwad/{surah3}.mp3',
  },
  {
    id: 'abdulbasit_mujawwad',
    name: 'Abdul Basit Abdul Samad (Mujawwad)',
    shortName: 'Basit (Mujawwad)',
    subfolder: 'Abdul_Basit_Mujawwad_128kbps',
    isSurahBased: true,
    quranComId: 1,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/abdul_baset/mujawwad/{surah}.mp3',
  },
  {
    id: 'husary_muallim',
    name: 'Mahmoud Khalil Al-Husary (Muallim / Teaching)',
    shortName: 'Husary (Muallim)',
    subfolder: 'Husary_Muallim_128kbps',
    isSurahBased: true,
    quranComId: 12,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/khalil_al_husary/muallim/{surah}.mp3',
  },
  {
    id: 'shatri',
    name: 'Abu Bakr Al-Shatri',
    shortName: 'Al-Shatri',
    subfolder: 'Abu_Bakr_Ash-Shaatree_128kbps',
    isSurahBased: true,
    quranComId: 4,
    surahUrlPattern: 'https://download.quranicaudio.com/qdc/abu_bakr_shatri/murattal/{surah}.mp3',
  },
  {
    id: 'hudhaify',
    name: 'Ali Al-Hudhaify',
    shortName: 'Al-Hudhaify',
    subfolder: 'Hudhaify_64kbps',
  },
  {
    id: 'qatami',
    name: 'Nasser Al-Qatami',
    shortName: 'Al-Qatami',
    subfolder: 'Nasser_Alqatami_128kbps',
    isSurahBased: true,
    quranComId: 104,
    surahUrlPattern: 'https://download.quranicaudio.com/quran/nasser_bin_ali_alqatami/{surah3}.mp3',
  },
  {
    id: 'sowaid',
    name: 'Ayman Suwayd (Tajweed)',
    shortName: 'Ayman Suwayd',
    subfolder: 'Ayman_Sowaid_64kbps',
  },
];

export const RECITERS: Reciter[] = [
  MULTIPLE_RECITER,
  ...BASE_RECITERS,
];

export function getAudioUrl(reciter: Reciter, surahNumber: number, ayahNumber: number): string {
  const actualReciter = reciter.id === MULTIPLE_RECITER_ID ? BASE_RECITERS[0] : reciter;
  const surahStr = surahNumber.toString().padStart(3, '0');
  if (actualReciter.isSurahBased) {
    if (actualReciter.surahUrlPattern) {
      return actualReciter.surahUrlPattern
        .replace('{surah}', surahNumber.toString())
        .replace('{surah3}', surahStr);
    }
    const base = actualReciter.baseUrl || 'https://server6.mp3quran.net/kurdi/';
    return `${base}${surahStr}.mp3`;
  }
  const ayahStr = ayahNumber.toString().padStart(3, '0');
  return `https://everyayah.com/data/${actualReciter.subfolder}/${surahStr}${ayahStr}.mp3`;
}
