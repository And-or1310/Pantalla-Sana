// Todo el audio se reproduce en el navegador: el motor solo dice QUÉ sonido toca.
let ctx: AudioContext | null = null;

function tone(freq: number, at: number, dur: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

export function beep(repeat = 1) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    for (let i = 0; i < repeat; i++) {
      const t = ctx.currentTime + i * 0.6;
      tone(660, t, 0.12);
      tone(880, t + 0.14, 0.17);
    }
  } catch { /* sin audio disponible */ }
}

export function speak(text: string) {
  if (!("speechSynthesis" in window)) return beep();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-MX";
  window.speechSynthesis.speak(u);
}

export function playUrl(url: string) {
  const a = new Audio(url);
  a.volume = 0.85;
  a.play().catch(() => beep());
}
