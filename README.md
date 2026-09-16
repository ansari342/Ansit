# Aya — Quran Memorization & Verse Looping

**Aya** is a distraction-free, meditative Quran audio player and memorization (Hifz) companion for iOS. Designed with high-precision word-by-word highlighting, seamless gapless audio looping, and authentic Uthmanic typography.

---

## Live Links & App Store Connect Documentation

- **Marketing / Landing Page:** [https://ansari342.github.io/Ansit/website/](https://ansari342.github.io/Ansit/website/)
- **Privacy Policy URL:** [https://ansari342.github.io/Ansit/website/privacy.html](https://ansari342.github.io/Ansit/website/privacy.html)
- **Support & FAQ URL:** [https://ansari342.github.io/Ansit/website/support.html](https://ansari342.github.io/Ansit/website/support.html)

---

## Core Features

1. **Millisecond Word-by-Word Highlighting**
   - Words illuminate in luminous gold (`#fbbf24`) as they are recited, transitioning to crisp white after spoken.
   - Integrates official Quran.com word-segment timestamps with an intelligent Tajweed acoustic pacing fallback for offline or unsegmented reciters.
   - Standalone Quranic Waqf (stopping) symbols attach cleanly to preceding words to preserve King Fahd Complex Uthmanic Hafs ligatures.

2. **Customizable Verse & Range Looping**
   - **Single Verse Loop:** Repeat an individual ayah `1x` to `∞` times before advancing.
   - **Verse Range Loop:** Continuously loop a custom range of verses (e.g., Verses 1–10) for structured Hifz sessions.
   - **Multiple Reciters Mode:** Automatically cycle through world-renowned reciters on each loop iteration.
   - **Configurable Pause Delay:** Add a custom pause between repetitions for self-recitation and reflection.

3. **Renowned Reciters**
   - Mishary Rashid Alafasy
   - Raad Mohammad Al-Kurdi
   - Abdul Basit Abdul Samad (Murattal & Mujawwad)
   - Mahmoud Khalil Al-Husary (Murattal & Muallim)
   - Saad Al-Ghamdi
   - Abdur-Rahman As-Sudais
   - Saud Al-Shuraim
   - Maher Al-Muaiqly
   - Yasser Al-Dosari
   - Muhammad Siddiq Al-Minshawi (Murattal & Mujawwad)
   - Abu Bakr Al-Shatri

4. **Reflection & Memorization Analytics**
   - Local, private tracking of daily streaks, total verses repeated, listening time, and most repeated ayahs.
   - Zero third-party tracking or external data collection.

---

## Development & Build

### Prerequisites
- Node.js `20.x`
- Yarn (`yarn install`)
- Expo CLI / EAS CLI

### Running Locally
```bash
# Start Metro bundler
yarn start

# Run on iOS Simulator
yarn ios
```

### Production iOS Build (TestFlight)
```bash
eas build --platform ios --profile production --auto-submit --non-interactive
```
