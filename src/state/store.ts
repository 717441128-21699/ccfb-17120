import { DEFAULT_ALERTS, DEFAULT_ENHANCE } from '../config';
import type { AlertEvent, AlertSettings, EnhanceSettings, PersistedSettings } from '../types';

const STORAGE_KEY = 'silkworm-monitor-settings-v1';
const ALERTS_KEY = 'silkworm-monitor-alerts-v1';

type Listener<T> = (value: T) => void;

class Observable<T> {
  protected listeners = new Set<Listener<T>>();
  constructor(protected value: T) {}

  get(): T {
    return this.value;
  }

  subscribe(listener: Listener<T>, immediate = true): () => void {
    this.listeners.add(listener);
    if (immediate) listener(this.value);
    return () => this.listeners.delete(listener);
  }

  set(next: T): void {
    this.value = next;
    this.listeners.forEach((listener) => listener(next));
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enhance: DEFAULT_ENHANCE, alerts: DEFAULT_ALERTS };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      enhance: { ...DEFAULT_ENHANCE, ...(parsed.enhance ?? {}) },
      alerts: {
        ...DEFAULT_ALERTS,
        ...(parsed.alerts ?? {}),
        channelThresholds: parsed.alerts?.channelThresholds ?? {},
      },
    };
  } catch {
    return { enhance: DEFAULT_ENHANCE, alerts: DEFAULT_ALERTS };
  }
}

function loadAlerts(): AlertEvent[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as AlertEvent[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 100) : [];
  } catch {
    return [];
  }
}

const initial = loadSettings();

export const enhanceStore = new Observable<EnhanceSettings>(initial.enhance);
export const alertSettingsStore = new Observable<AlertSettings>(initial.alerts);
export const alertStore = new Observable<AlertEvent[]>(loadAlerts());

function persistSettings(): void {
  const value: PersistedSettings = {
    enhance: enhanceStore.get(),
    alerts: alertSettingsStore.get(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage may be unavailable */
  }
}

enhanceStore.subscribe(persistSettings, false);
alertSettingsStore.subscribe(persistSettings, false);
alertStore.subscribe((alerts) => {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts.slice(0, 100)));
  } catch {
    /* ignore */
  }
}, false);

export function pushAlert(event: AlertEvent): void {
  alertStore.set([event, ...alertStore.get()].slice(0, 100));
}

export function acknowledgeAlert(id: string): void {
  alertStore.set(alertStore.get().map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
}

export function clearAlerts(): void {
  alertStore.set([]);
}
