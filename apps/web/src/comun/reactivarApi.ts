/** Reactivar Aurora mediante una lectura antes de enviar una escritura.
 * Solo GET se reintenta: un timeout de POST/PATCH no demuestra que fallo.
 * No hay intervalos ni sondas en segundo plano que impidan la pausa.
 */
export function crearReactivador(direccion: string) {
  let ultimoListo: number | undefined;
  let pendiente: Promise<void> | undefined;
  const error = () => new Error('El servicio no esta listo. Espere unos segundos e intente de nuevo; no se envio el cambio.');
  async function reactivar() {
    for (let intento = 0; intento < 2; intento++) {
      const controlador = new AbortController();
      const limite = setTimeout(() => controlador.abort(), 31000);
      try {
        const respuesta = await fetch(direccion, { method: 'GET', cache: 'no-store', signal: controlador.signal });
        if (respuesta.ok) {
          const resultado = await respuesta.json();
          if (resultado.estado !== 'listo' || resultado.baseDeDatos !== 'ok') throw error();
          ultimoListo = performance.now();
          return;
        }
        if (![502, 503, 504].includes(respuesta.status)) throw error();
      } catch (fallo) {
        // Las respuestas inesperadas no se reintentan. Los fallos de red y
        // timeout si: este GET no modifica datos ni envia correos.
        if (fallo instanceof Error && fallo.message === error().message) throw fallo;
      } finally { clearTimeout(limite); }
      if (intento === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw error();
  }
  return async () => {
    if (ultimoListo !== undefined && performance.now() - ultimoListo < 120000) return;
    pendiente ??= reactivar().finally(() => { pendiente = undefined; });
    return pendiente;
  };
}
