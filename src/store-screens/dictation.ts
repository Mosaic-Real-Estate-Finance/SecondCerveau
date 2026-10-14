// The dictation played back for the store screenshots: the words appear one
// by one, at the pace of speech, as Soniox would stream them.
export const DICTATION =
  "Rendez-vous ce matin avec Sophie Leroy, directrice financière chez Altarea. Elle cherche un financement de 4 millions pour l'opération de Bordeaux, livraison prévue fin 2027. À rappeler jeudi avec une proposition de taux.";

const WORDS = DICTATION.split(" ");
const WORD_MS = 330;

let shown = 0;
let timer = 0;
const listeners = new Set<() => void>();

/** Starts the playback; `upTo` stops it after that many words. */
export function play(upTo = WORDS.length) {
  window.clearInterval(timer);
  shown = 0;
  timer = window.setInterval(() => {
    shown = Math.min(shown + 1, upTo);
    listeners.forEach((listener) => listener());
    if (shown >= upTo) window.clearInterval(timer);
  }, WORD_MS);
}

export const partial = () => WORDS.slice(0, shown).join(" ");

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * A voice for the glow to follow: two detuned tones and filtered noise, their
 * level rising and falling with each syllable. Never played out loud; only
 * the analyser behind the glow hears it.
 */
export function syntheticVoice(): MediaStream {
  const context = new AudioContext();
  const out = context.createMediaStreamDestination();
  const level = context.createGain();
  level.gain.value = 0;
  for (const frequency of [140, 212]) {
    const tone = context.createOscillator();
    tone.type = "sawtooth";
    tone.frequency.value = frequency;
    tone.connect(level);
    tone.start();
  }
  const noise = context.createBufferSource();
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  buffer.getChannelData(0).forEach((_, i, data) => (data[i] = Math.random() * 2 - 1));
  noise.buffer = buffer;
  noise.loop = true;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  noise.connect(band).connect(level);
  noise.start();
  level.connect(out);
  // Syllables: a swell every ~180 ms, louder on stressed ones, a short breath
  // now and then.
  let t = context.currentTime;
  const schedule = () => {
    while (t < context.currentTime + 2) {
      const breath = Math.random() < 0.08;
      const peak = breath ? 0.02 : 0.25 + Math.random() * 0.55;
      level.gain.setTargetAtTime(peak, t, 0.03);
      level.gain.setTargetAtTime(0.04, t + 0.11, 0.04);
      t += breath ? 0.4 : 0.15 + Math.random() * 0.08;
    }
  };
  schedule();
  window.setInterval(schedule, 500);
  void context.resume();
  return out.stream;
}
