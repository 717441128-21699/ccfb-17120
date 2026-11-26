let audioContext: AudioContext | null = null;

export async function ensureAudio(): Promise<void> {
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audioContext = new Ctor();
    }
    if (audioContext?.state === 'suspended') await audioContext.resume();
  } catch {
    /* audio unavailable */
  }
}

export function playAlertTone(): void {
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioContext = new Ctor();
    }
    const ctx = audioContext;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now + i * 0.22);
      osc.frequency.exponentialRampToValueAtTime(660, now + i * 0.22 + 0.16);
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.22 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.2);
    }
  } catch {
    /* ignore */
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}
