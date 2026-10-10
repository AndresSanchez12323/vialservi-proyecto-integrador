import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearReactivador } from '../../web/src/comun/reactivarApi.js';

const listo = () => new Response(JSON.stringify({ estado: 'listo', baseDeDatos: 'ok' }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe('Reactivacion sin repetir escrituras', () => {
  it('comparte la lectura concurrente y la recuerda dos minutos', async () => {
    const consultar = vi.fn().mockResolvedValueOnce(listo());
    vi.stubGlobal('fetch', consultar);
    const despertar = crearReactivador('/api/listo');
    await Promise.all([despertar(), despertar()]);
    await despertar();
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(consultar.mock.calls[0][1].method).toBe('GET');
  });
  it('reintenta un 503 solamente como GET', async () => {
    const consultar = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(listo());
    vi.stubGlobal('fetch', consultar);
    await crearReactivador('/api/listo')();
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(consultar.mock.calls.every((llamada) => llamada[1].method === 'GET')).toBe(true);
  });
  it('rechaza una respuesta 403 sin reintentar ni dar por lista la base', async () => {
    const consultar = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', consultar);
    await expect(crearReactivador('/api/listo')()).rejects.toThrow('no se envio el cambio');
    expect(consultar).toHaveBeenCalledTimes(1);
  });
  it('no acepta un 200 cuyo cuerpo no confirme la base', async () => {
    const consultar = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ estado: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', consultar);
    await expect(crearReactivador('/api/listo')()).rejects.toThrow('no se envio el cambio');
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
