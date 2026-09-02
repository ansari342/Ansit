import { Reciter } from '../types';

export const RECITERS: Reciter[] = [
  {
    id: 'mishary',
    name: 'Mishary Rashid Alafasy',
    shortName: 'Mishary Alafasy',
    subfolder: 'Alafasy_128kbps',
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
  },
  {
    id: 'husary',
    name: 'Mahmoud Khalil Al-Husary',
    shortName: 'Al-Husary',
    subfolder: 'Husary_128kbps',
  },
  {
    id: 'ghamdi',
    name: 'Saad Al-Ghamdi',
    shortName: 'Saad Al-Ghamdi',
    subfolder: 'Ghamadi_40kbps',
  },
  {
    id: 'sudais',
    name: 'Abdur-Rahman As-Sudais',
    shortName: 'As-Sudais',
    subfolder: 'Abdurrahmaan_As-Sudais_192kbps',
  },
  {
    id: 'shuraim',
    name: 'Saud Al-Shuraim',
    shortName: 'Al-Shuraim',
    subfolder: 'Saood_ash-Shuraym_128kbps',
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
  },
  {
    id: 'minshawi',
    name: 'Muhammad Siddiq Al-Minshawi (Murattal)',
    shortName: 'Al-Minshawi',
    subfolder: 'Minshawy_Murattal_128kbps',
  },
  {
    id: 'minshawi_mujawwad',
    name: 'Muhammad Siddiq Al-Minshawi (Mujawwad)',
    shortName: 'Minshawi (Mujawwad)',
    subfolder: 'Minshawy_Mujawwad_192kbps',
  },
  {
    id: 'abdulbasit_mujawwad',
    name: 'Abdul Basit Abdul Samad (Mujawwad)',
    shortName: 'Basit (Mujawwad)',
    subfolder: 'Abdul_Basit_Mujawwad_128kbps',
  },
  {
    id: 'husary_muallim',
    name: 'Mahmoud Khalil Al-Husary (Muallim / Teaching)',
    shortName: 'Husary (Muallim)',
    subfolder: 'Husary_Muallim_128kbps',
  },
  {
    id: 'shatri',
    name: 'Abu Bakr Al-Shatri',
    shortName: 'Al-Shatri',
    subfolder: 'Abu_Bakr_Ash-Shaatree_128kbps',
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
  },
  {
    id: 'sowaid',
    name: 'Ayman Suwayd (Tajweed)',
    shortName: 'Ayman Suwayd',
    subfolder: 'Ayman_Sowaid_64kbps',
  },
];

export function getAudioUrl(reciter: Reciter, surahNumber: number, ayahNumber: number): string {
  const surahStr = surahNumber.toString().padStart(3, '0');
  if (reciter.isSurahBased) {
    const base = reciter.baseUrl || 'https://server6.mp3quran.net/kurdi/';
    return `${base}${surahStr}.mp3`;
  }
  const ayahStr = ayahNumber.toString().padStart(3, '0');
  return `https://everyayah.com/data/${reciter.subfolder}/${surahStr}${ayahStr}.mp3`;
}
