/**
 * Recuperacion de contraseña en dos pasos: se pide el codigo y se confirma.
 *
 * El primer paso responde lo mismo exista o no la cuenta, a proposito: si
 * dijera "ese documento no existe", esta pantalla serviria para averiguar que
 * cedulas tienen cuenta en VialServi. Por eso el texto de confirmacion habla
 * en condicional.
 *
 * En desarrollo, con CORREO_MODO=consola, el codigo sale en el log del API; si
 * ademas CORREO_REVELAR_CODIGO esta encendido, el servidor lo devuelve y aqui
 * se muestra en un aviso marcado como de desarrollo.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { publico } from '../comun/api';

export function RecuperarClave() {
  const navegar = useNavigate();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [documento, setDocumento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [aviso, setAviso] = useState('');
  const [codigoDemo, setCodigoDemo] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const pedirCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const r = await publico<{ mensaje: string; codigo?: string }>('/auth/recuperar', { documento });
      setAviso(r.mensaje);
      if (r.codigo) setCodigoDemo(r.codigo);
      setPaso(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible solicitar el código');
    } finally {
      setCargando(false);
    }
  };

  const confirmarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await publico('/auth/recuperar/confirmar', { documento, codigo, nuevaClave: nueva });
      navegar('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cambiar la contraseña');
    } finally {
      setCargando(false);
    }
  };

  const listoPaso2 =
    codigo.trim().length === 6 && nueva.length >= 8 && nueva === confirmar;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="vidrio w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
        <p className="mb-6 text-sm text-slate-300">
          {paso === 1
            ? 'Indique su documento y le enviamos un código al correo registrado.'
            : 'Escriba el código que recibió y su nueva contraseña.'}
        </p>

        {paso === 1 ? (
          <form onSubmit={pedirCodigo} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-300">Documento</label>
              <input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className="campo font-mono"
                inputMode="numeric"
                autoFocus
              />
            </div>
            {error && (
              <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </p>
            )}
            <button className="boton w-full" disabled={documento.trim().length < 5 || cargando}>
              {cargando ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmarCodigo} className="space-y-4">
            {aviso && (
              <p className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
                {aviso}
              </p>
            )}
            {codigoDemo && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <span className="font-semibold">Modo desarrollo:</span> su código es{' '}
                <span className="font-mono text-base">{codigoDemo}</span>
              </p>
            )}

            <div>
              <label className="mb-1 block text-sm text-slate-300">Código de 6 dígitos</label>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="campo text-center font-mono text-xl tracking-[0.4em]"
                inputMode="numeric"
                placeholder="000000"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-300">Nueva contraseña</label>
              <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} className="campo" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-300">Repetir contraseña</label>
              <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className="campo" />
            </div>

            {nueva && nueva.length < 8 && (
              <p className="text-xs text-amber-200">La contraseña debe tener al menos 8 caracteres.</p>
            )}
            {confirmar && nueva !== confirmar && (
              <p className="text-xs text-amber-200">Las contraseñas no coinciden.</p>
            )}
            {error && (
              <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </p>
            )}

            <button className="boton w-full" disabled={!listoPaso2 || cargando}>
              {cargando ? 'Cambiando…' : 'Cambiar contraseña'}
            </button>
            <button type="button" className="boton-suave w-full" onClick={() => setPaso(1)}>
              Pedir otro código
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/login" className="text-amber-300 underline hover:text-amber-200">
            Volver al inicio de sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
