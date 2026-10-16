/**
 * YIN fundamental-frequency detector (de Cheveigné & Kawahara, 2002) with parabolic refinement.
 * Pure function — shared by the web microphone path, offline extraction, and unit tests.
 */
export interface PitchEstimate {
  freqHz: number | null;
  rms: number;
  confidence: number;
}

export function detectPitchHzFromFloatSamples(
  x: ArrayLike<number>,
  sampleRate: number,
  fMin: number = 60,
  fMax: number = 500,
  rmsGate: number = 0.0035
): PitchEstimate {
  const n = x.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  const rms = Math.sqrt(energy / Math.max(1, n));
  if (rms < rmsGate) return { freqHz: null, rms, confidence: 1 };

  const minLag = Math.floor(sampleRate / fMax);
  const maxLag = Math.min(Math.floor(sampleRate / fMin), Math.floor(n / 2));
  const half = Math.floor(n / 2);
  if (maxLag <= minLag + 2) return { freqHz: null, rms, confidence: 1 };

  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = x[i] - x[i + tau];
      sum += d * d;
    }
    running += sum;
    cmndf[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  const threshold = 0.18;
  let tau = -1;
  for (let t = minLag; t < maxLag; t++) {
    if (cmndf[t] < threshold) {
      while (t + 1 < maxLag && cmndf[t + 1] < cmndf[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    let best = 1;
    for (let t = minLag; t <= maxLag; t++) {
      if (cmndf[t] < best) {
        best = cmndf[t];
        tau = t;
      }
    }
    if (best > 0.38) return { freqHz: null, rms, confidence: best };
  }

  const halfTau = Math.floor(tau / 2);
  if (halfTau >= minLag && cmndf[halfTau] < 0.2 && cmndf[halfTau] <= cmndf[tau] + 0.05) {
    tau = halfTau;
  }

  let refined = tau;
  if (tau > minLag && tau < maxLag) {
    const s0 = cmndf[tau - 1];
    const s1 = cmndf[tau];
    const s2 = cmndf[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-9) refined = tau + (s2 - s0) / denom;
  }
  const freqHz = sampleRate / refined;
  if (freqHz < fMin || freqHz > fMax) return { freqHz: null, rms, confidence: 1 };
  return { freqHz, rms, confidence: cmndf[tau] };
}

export function freqHzToMidi(freqHz: number): number {
  if (freqHz <= 20) return 0;
  return 69 + 12 * Math.log2(freqHz / 440);
}

export function midiToFreqHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const noteClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteClass]}${octave}`;
}
