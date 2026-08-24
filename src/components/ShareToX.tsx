import { useState } from 'react';
import { buildXPost, xIntentUrl, type XShareMatch } from '../lib/x-share';

/**
 * "Copiar informe para X": convierte la ficha de un partido en un post listo
 * para @tenismoApp — predicción/resultado + hashtags de jugadores, torneo y
 * circuito, en 140 caracteres (ver src/lib/x-share.ts para el porqué de ese
 * presupuesto y cómo se arma el texto).
 *
 * Solo copia texto al portapapeles o abre el compositor de X con el texto
 * precargado — nunca publica nada por sí sola, quien lo postea es la persona.
 *
 * `matchUrl` lo arma el llamador (MatchDetail.tsx) con SITE_ORIGIN +
 * matchPath(match) — nunca `window.location`, para que el enlace del post sea
 * siempre el de producción aunque el texto se genere en local o en un preview
 * deploy. Al no depender de `window`, tampoco hace falta el truco de
 * useEffect+useState para evitar mismatch de hidratación: el texto sale
 * completo desde el primer render, en servidor y en cliente por igual.
 */
export default function ShareToX(props: XShareMatch) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = buildXPost(props);

  async function copiar() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('No se pudo copiar. Selecciona y copia el texto manualmente.');
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-ink">Compartir en X</h2>
        <span className="text-2xs text-ink-faint">Listo para @tenismoApp</span>
      </div>
      <p className="whitespace-pre-line rounded-md border border-line/60 bg-surface-2/40 p-2.5 text-2xs leading-relaxed text-ink-muted">
        {text}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copiar}
          className="rounded-lg bg-court px-3 py-1.5 text-xs font-semibold text-bg hover:bg-court/90"
        >
          {copied ? '¡Copiado!' : 'Copiar informe'}
        </button>
        <a
          href={xIntentUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-court/40 hover:text-court-ink"
        >
          Abrir en X ↗
        </a>
      </div>
      {error && <p className="mt-2 text-2xs text-live">{error}</p>}
    </div>
  );
}
