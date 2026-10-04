/**
 * Muestra una evidencia.
 *
 * El bucket es privado, asi que no se puede poner la direccion del objeto en un
 * <img>: hay que pedirle al API una URL de lectura prefirmada, que caduca en
 * minutos. Eso es a proposito —una foto de cedula con firma no puede quedar
 * accesible a quien adivine la direccion— y es la razon por la que este
 * componente hace una consulta en lugar de recibir la URL ya hecha.
 *
 * La URL se pide solo cuando la tarjeta se abre, no al listar: un expediente con
 * 30 evidencias no debe firmar 30 URL para mostrar miniaturas que nadie va a
 * mirar.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { pedir, type Evidencia } from './api';
import { CATEGORIAS, ROLES, fecha } from './formato';

type Lectura = { url: string | null; clave: string; modo: 'local' | 's3' };

export function VistaEvidencia({
  evidencia,
  expedienteId,
}: {
  evidencia: Evidencia;
  expedienteId: number;
}) {
  const [abierta, setAbierta] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['evidencia-url', evidencia.id],
    queryFn: () => pedir<Lectura>(`/expedientes/${expedienteId}/evidencias/${evidencia.id}/url`),
    enabled: abierta,
    // La URL caduca; se vuelve a pedir si el usuario deja la pantalla abierta.
    staleTime: 10 * 60 * 1000,
  });

  const esFoto = evidencia.tipo === 'FOTO';

  return (
    <div className="vidrio-suave overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        className="w-full p-4 text-left transition hover:bg-white/5"
      >
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className={`etiqueta border ${CATEGORIAS[evidencia.categoria]?.clase ?? ''}`}>
            {CATEGORIAS[evidencia.categoria]?.texto ?? evidencia.categoria}
          </span>
          <span className="text-[11px] text-slate-400">
            {evidencia.tipo} {abierta ? '▾' : '▸'}
          </span>
        </div>

        {evidencia.posteriorAlCierre && (
          <span className="etiqueta mt-2 border border-amber-300/40 bg-amber-400/20 text-amber-200">
            posterior al cierre
          </span>
        )}

        <p className="mt-2 text-sm">{evidencia.subidaPor.nombre}</p>
        <p className="text-xs text-amber-300">
          {ROLES[evidencia.subidaPor.rol] ?? evidencia.subidaPor.rol}
        </p>
        <p className="mt-1 text-xs text-slate-500">{fecha(evidencia.tomadaEn)}</p>
      </button>

      {abierta && (
        <div className="border-t border-white/10 p-3">
          {isLoading && <p className="text-xs text-slate-400">Abriendo…</p>}
          {error && <p className="text-xs text-rose-300">{(error as Error).message}</p>}

          {data?.url ? (
            esFoto ? (
              <a href={data.url} target="_blank" rel="noreferrer">
                <img
                  src={data.url}
                  alt={`Evidencia ${evidencia.categoria}`}
                  className="max-h-64 w-full rounded-lg object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <video src={data.url} controls className="max-h-64 w-full rounded-lg" />
            )
          ) : (
            data && (
              // Modo local: no hay archivo que mostrar, solo la referencia. Se
              // dice con claridad para que nadie crea que la imagen falló.
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs text-slate-400">
                  Modo local: se registró la referencia, no el archivo.
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{data.clave}</p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
