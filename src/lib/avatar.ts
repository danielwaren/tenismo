/**
 * Lógica del avatar de jugador, compartida por la versión Astro y la React.
 *
 * Vive aparte para que las iniciales y el color sean IDÉNTICOS en las dos: si
 * el ranking (isla React) pintara a un jugador de otro color que la ficha
 * (Astro), el avatar dejaría de servir para reconocerlo de un vistazo, que es
 * justo para lo que está.
 */

/**
 * Iniciales a partir del formato de la base ("Alcaraz C." → "AC"). El apellido
 * va primero, así que se toma su inicial y la del nombre abreviado.
 */
export function avatarInitials(name: string): string {
  const limpio = name.replace(/[^\p{L}\s.]/gu, ' ').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return ((partes[0][0] ?? '') + (partes.length > 1 ? (partes[1][0] ?? '') : '')).toUpperCase();
}

/** Tono estable por nombre: mismo jugador, mismo color, siempre. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** URL de la foto servida por nuestro proxy, o null si no hay. */
export function avatarPhotoSrc(playerId: number | null | undefined, hasPhoto: boolean): string | null {
  return hasPhoto && playerId ? `/api/foto-jugador/${playerId}` : null;
}

export const AVATAR_SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-[11px]', px: 32 },
  md: { box: 'h-11 w-11', text: 'text-sm', px: 44 },
  lg: { box: 'h-16 w-16', text: 'text-lg', px: 64 },
  xl: { box: 'h-24 w-24', text: 'text-2xl', px: 96 },
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

/** Estilos inline del avatar, iguales en ambas implementaciones. */
export function avatarStyles(name: string) {
  const h = avatarHue(name);
  return {
    photo: { backgroundColor: `hsl(${h} 30% 18%)` },
    fallback: {
      background: `linear-gradient(140deg, hsl(${h} 34% 22%), hsl(${h} 30% 14%))`,
      color: `hsl(${h} 60% 78%)`,
    },
  };
}
