import logoUrl from '../recursos/logo-vialservi.jpg';

/**
 * Marca de VialServi S.A.S.
 *
 * El archivo es un JPG con fondo blanco (sin transparencia), asi que se
 * presenta dentro de una pastilla blanca: sobre el fondo oscuro de la app, un
 * rectangulo blanco suelto se veria como un recuadro roto.
 */
export function Logo({ className = 'h-9' }: { className?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center overflow-hidden rounded-lg bg-white px-1.5 py-1">
      <img src={logoUrl} alt="VialServi S.A.S" className={`w-auto ${className}`} />
    </span>
  );
}
