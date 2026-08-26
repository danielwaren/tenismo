/**
 * Hueco de anuncio — inerte hasta que se configure una red real.
 *
 * Sin `PUBLIC_ADSENSE_CLIENT_ID` (o el que corresponda cuando se decida la
 * red, ver docs/15-monetizacion.md) esto no renderiza NADA: nunca hay un
 * layout shift, un placeholder feo, ni una petición a un dominio externo sin
 * que alguien haya decidido explícitamente activarlo. Encender la
 * publicidad de verdad es una decisión de negocio (qué red, qué política de
 * contenido de apuestas aplica) — este componente solo deja el hueco listo
 * en el layout para cuando esa decisión se tome.
 *
 * `slot` identifica la posición (para poder medir cada una por separado más
 * adelante, y para variar el tamaño/formato sin tocar cada page que lo usa).
 */
export type AdSlotPosition = 'home-top' | 'match-detail-bottom' | 'list-inline';

const SLOT_LABEL: Record<AdSlotPosition, string> = {
  'home-top': 'Publicidad',
  'match-detail-bottom': 'Publicidad',
  'list-inline': 'Publicidad',
};

export default function AdSlot({ slot }: { slot: AdSlotPosition }) {
  const clientId = import.meta.env.PUBLIC_ADSENSE_CLIENT_ID as string | undefined;
  if (!clientId) return null;

  // Placeholder deliberadamente simple: el día que se active de verdad, el
  // <ins class="adsbygoogle"> de Google (u otro snippet, según la red que se
  // elija) reemplaza este bloque — ver docs/15-monetizacion.md antes de
  // tocar esto, hay una decisión de política de contenido pendiente.
  return (
    <div
      className="my-4 rounded-lg border border-line/50 bg-surface-2/30 p-3 text-center text-2xs text-ink-faint"
      data-ad-slot={slot}
      aria-label={SLOT_LABEL[slot]}
    >
      {SLOT_LABEL[slot]}
    </div>
  );
}
