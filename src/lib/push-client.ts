/**
 * Helpers de navegador para la suscripción push — separados de
 * PushSubscribeButton.tsx para poder testear `urlBase64ToUint8Array` sin
 * montar React ni depender de `navigator`/`window`.
 */

/** Detecta soporte real: Safari de escritorio y navegadores viejos no tienen Push API aunque tengan service workers. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * ¿Corriendo instalada (ícono de pantalla de inicio), no como pestaña suelta
 * del navegador? En iOS Safari, `Notification`/`PushManager` pueden EXISTIR
 * en el objeto global sin funcionar de verdad si la página no se abrió desde
 * el ícono instalado — por eso este chequeo aparte, no alcanza con
 * `pushSupported()`. `navigator.standalone` es la propiedad no estándar que
 * usa iOS; `display-mode: standalone` es la señal estándar (Android/desktop).
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Convierte la clave pública VAPID (base64url, como la entrega
 * `web-push generate-vapid-keys`) al Uint8Array que exige
 * `PushManager.subscribe({ applicationServerKey })`. Traducción estándar de
 * la especificación Web Push — no hay atajo del navegador para esto.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}
