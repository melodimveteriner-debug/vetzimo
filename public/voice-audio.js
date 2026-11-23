export const VOICE_PAUSE_MS = 2000;

export function createVoiceActivity() {
  let floor = 0.001, onset, lastSpeech;
  return {
    get heard() { return lastSpeech !== undefined; },
    get lastSpeech() { return lastSpeech; },
    sample(now, level) {
      const threshold = Math.min(0.024, Math.max(0.0035, floor * 2.8));
      if (level >= threshold) {
        onset ??= now;
        if (now - onset >= 80) lastSpeech = now;
        return 0;
      }
      onset = undefined;
      floor += (level - floor) * 0.06;
      return lastSpeech === undefined ? 0 : now - lastSpeech;
    },
  };
}

export function voiceLevel(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function prepareVoiceSamples(samples, sampleRate) {
  const end = Math.min(samples.length, sampleRate * 30);
  const frame = Math.round(sampleRate / 50);
  let first, last, peak = 0;
  for (let index = 0; index < end; index += frame) {
    const section = samples.subarray(index, Math.min(end, index + frame));
    if (voiceLevel(section) < 0.002) continue;
    first ??= index;
    last = index + section.length;
  }
  if (first === undefined || last - first < sampleRate * 0.2) return null;
  const trimmed = samples.slice(Math.max(0, first - sampleRate * 0.2), Math.min(end, last + sampleRate * 0.35));
  for (const sample of trimmed) peak = Math.max(peak, Math.abs(sample));
  const gain = Math.min(4, Math.max(1, 0.45 / peak));
  if (gain > 1) for (let i = 0; i < trimmed.length; ++i) trimmed[i] *= gain;
  return trimmed;
}
