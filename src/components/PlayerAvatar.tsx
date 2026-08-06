import { AVATAR_SIZES, avatarInitials, avatarPhotoSrc, avatarStyles, type AvatarSize } from '../lib/avatar';

/**
 * Versión React de PlayerAvatar.astro, para las islas (ranking, formularios).
 * Toda la lógica —iniciales, color, URL— vive en src/lib/avatar.ts para que
 * un mismo jugador se vea idéntico en las dos.
 */
export default function PlayerAvatar({
  name, playerId, hasPhoto = false, size = 'md', className = '',
}: {
  name: string;
  playerId?: number | null;
  hasPhoto?: boolean;
  size?: AvatarSize;
  className?: string;
}) {
  const S = AVATAR_SIZES[size];
  const src = avatarPhotoSrc(playerId, hasPhoto);
  const estilos = avatarStyles(name);

  if (src) {
    return (
      <img
        src={src}
        alt={`Foto de ${name}`}
        width={S.px}
        height={S.px}
        loading="lazy"
        decoding="async"
        className={`${S.box} shrink-0 rounded-full border border-line object-cover ${className}`}
        style={estilos.photo}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${S.box} ${S.text} grid shrink-0 place-items-center rounded-full border border-line font-display font-semibold ${className}`}
      style={estilos.fallback}
    >{avatarInitials(name)}</span>
  );
}
