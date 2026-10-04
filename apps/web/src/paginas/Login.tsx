import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { pedir, sesion, type Sesion } from '../comun/api';
import { inicioPorRol } from '../comun/Atras';

const DEMO = [
  { doc: '2001', quien: 'Central de Operaciones' },
  { doc: '3001', quien: 'Técnico' },
  { doc: '71234567', quien: 'Cliente' },
  { doc: '1001', quien: 'Administrador' },
];

export function Login() {
  const navegar = useNavigate();
  const [documento, setDocumento] = useState('');
  const [clave, setClave] = useState('VialServi2026');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Con sesión válida no hay login que mostrar: de vuelta a la app.
  // Así Atrás nunca deja al usuario ante un inicio de sesión ajeno.
  if (sesion.actual()) return <Navigate to={inicioPorRol()} replace />;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const r = await pedir<{ token: string; usuario: Sesion }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ documento, clave }),
      });
      sesion.guardar(r.token, r.usuario);
      navegar(r.usuario.rol === 'TECNICO' || r.usuario.rol === 'CLIENTE' ? '/servicios' : '/panel');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="vidrio w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold tracking-tight">VialServi</h1>
        <p className="mb-8 text-sm text-slate-300">
          Gestión de expedientes de servicios mecánicos, de cerrajería, de grúa y de
          conductor elegido
        </p>

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-300">Documento</label>
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className="campo" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-300">Contraseña</label>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className="campo" />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          <button className="boton w-full" disabled={cargando}>
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link to="/recuperar" className="text-slate-300 underline hover:text-amber-200">
            Olvidé mi contraseña
          </Link>
          <Link to="/registro" className="text-amber-300 underline hover:text-amber-200">
            Crear cuenta de cliente
          </Link>
        </div>

        <div className="vidrio-suave mt-8 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Usuarios de demostración</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.doc}
                type="button"
                onClick={() => setDocumento(d.doc)}
                className="boton-suave text-left"
              >
                <span className="block font-mono text-xs text-amber-300">{d.doc}</span>
                <span className="block text-[11px] text-slate-300">{d.quien}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Clave para todos: VialServi2026</p>
        </div>
      </div>
    </div>
  );
}
