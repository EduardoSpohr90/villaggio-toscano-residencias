// Registro do service worker e atualização sem prender ninguém em versão
// antiga: a nova versão instala em segundo plano e o app oferece
// "Nova versão disponível — Atualizar". Ao confirmar, ativa e recarrega.

type Listener = (ready: boolean) => void;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function announce(sw: ServiceWorker | null) {
  waiting = sw;
  for (const fn of listeners) fn(!!sw);
}

export function onUpdateReady(fn: Listener) {
  listeners.add(fn);
  fn(!!waiting);
  return () => {
    listeners.delete(fn);
  };
}

export function applyUpdate() {
  if (!waiting) return window.location.reload();
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Só recarrega quando a troca foi pedida pelo usuário (havia versão em espera).
    if (reloading || !waiting) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // Primeira instalação não é "atualização": não há versão anterior.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) announce(sw);
        });
      });
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 30 * 60 * 1000);
    } catch {
      /* sem service worker o app continua funcionando online */
    }
  });
}
