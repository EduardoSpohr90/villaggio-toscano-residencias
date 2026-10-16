// localStorage defensivo: no iOS (modo privado, cota cheia, armazenamento
// bloqueado) getItem/setItem podem lançar exceção. Uma exceção aqui nunca
// pode impedir o app de abrir ou o botão "+ Novo" de funcionar.

const memory = new Map<string, string>();

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return memory.has(key) ? (JSON.parse(memory.get(key)!) as T) : fallback;
    return JSON.parse(raw) as T;
  } catch {
    try {
      return memory.has(key) ? (JSON.parse(memory.get(key)!) as T) : fallback;
    } catch {
      return fallback;
    }
  }
}

/** Retorna false quando não foi possível gravar no aparelho. */
export function writeJSON(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* sem armazenamento disponível */
  }
}

/** Todas as chaves (para a detecção de dados antigos na migração). */
export function allKeys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

export function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const KEYS = {
  local: 'nc:local:v1',
  cache: 'nc:cache:v1',
  queue: 'nc:queue:v1',
  prefs: 'nc:prefs:v1',
  me: 'nc:me:v1',
  migration: 'nc:migration:v1',
  holidays: 'nc:holidays:v1',
} as const;
