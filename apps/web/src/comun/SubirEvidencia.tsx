/**
 * Selector de archivo para aportar una evidencia.
 *
 * `capture="environment"` hace que en un celular se abra la camara trasera
 * directamente, que es lo que el tecnico necesita en la via: no tiene por que
 * navegar la galeria para tomar una foto que todavia no existe.
 */
import { useRef, useState } from 'react';
import { LIMITES, SEGUNDOS_MAX_VIDEO, revisarArchivo, subirEvidencia, type Progreso } from './subida';

const TEXTO: Record<Progreso, string> = {
  firmando: 'Preparando…',
  subiendo: 'Subiendo archivo…',
  registrando: 'Registrando…',
};

export function SubirEvidencia({
  expedienteId,
  categoria,
  alSubir,
}: {
  expedienteId: number;
  categoria: string;
  alSubir: () => void;
}) {
  const [paso, setPaso] = useState<Progreso | null>(null);
  const [error, setError] = useState('');
  const foto = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);

  const manejar = async (archivo: File | undefined, tipo: 'FOTO' | 'VIDEO') => {
    if (!archivo) return;
    setError('');

    // Se revisa ANTES de pedir la URL: no tiene sentido firmar una subida que
    // el servidor va a rechazar por peso o por duracion.
    const problema = await revisarArchivo(archivo, tipo);
    if (problema) {
      setError(problema);
      return;
    }

    try {
      await subirEvidencia({ expedienteId, tipo, categoria, archivo, alAvanzar: setPaso });
      alSubir();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible subir la evidencia');
    } finally {
      setPaso(null);
      // Se limpia el input para que elegir el MISMO archivo otra vez vuelva a
      // disparar onChange; si no, un reintento no haria nada.
      if (foto.current) foto.current.value = '';
      if (video.current) video.current.value = '';
    }
  };

  const ocupado = paso !== null;

  return (
    <div className="space-y-2">
      <input
        ref={foto}
        type="file"
        accept={LIMITES.FOTO.accept}
        capture="environment"
        className="hidden"
        onChange={(e) => void manejar(e.target.files?.[0], 'FOTO')}
      />
      <input
        ref={video}
        type="file"
        accept={LIMITES.VIDEO.accept}
        capture="environment"
        className="hidden"
        onChange={(e) => void manejar(e.target.files?.[0], 'VIDEO')}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button className="boton-suave" disabled={ocupado} onClick={() => foto.current?.click()}>
          📷 Tomar o elegir fotografía
        </button>
        <button className="boton-suave" disabled={ocupado} onClick={() => video.current?.click()}>
          🎥 Grabar o elegir video
        </button>
        {ocupado && <span className="text-xs text-amber-200">{TEXTO[paso]}</span>}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Fotografía hasta {LIMITES.FOTO.etiqueta} · video hasta {LIMITES.VIDEO.etiqueta} y{' '}
        {SEGUNDOS_MAX_VIDEO} segundos. El archivo sube directo al almacenamiento, no pasa por el
        servidor.
      </p>
    </div>
  );
}
