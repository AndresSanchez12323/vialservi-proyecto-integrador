import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { pedir, sesion, type Sesion } from '../comun/api';
import { inicioPorRol } from '../comun/Atras';
import { Logo } from '../comun/Logo';
import { BotonTema } from '../comun/BotonTema';
import { avisoError } from '../comun/avisos';

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
  const [cargando, setCargando] = useState(false);

  // Con sesión válida no hay login que mostrar: de vuelta a la app.
  // Así Atrás nunca deja al usuario ante un inicio de sesión ajeno.
  if (sesion.actual()) return <Navigate to={inicioPorRol()} replace />;

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const r = await pedir<{ token: string; usuario: Sesion }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ documento, clave }),
      });
      sesion.guardar(r.token, r.usuario);
      navegar(r.usuario.rol === 'TECNICO' || r.usuario.rol === 'CLIENTE' ? '/servicios' : '/panel');
    } catch (err) {
      avisoError(err, 'No fue posible iniciar sesion');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      {/* Fuera de la tarjeta y fijo: estas pantallas no tienen cabecera donde
          ponerlo, y aqui no se mueve con el formulario. */}
      <div className="fixed right-4 top-4 z-20"><BotonTema /></div>
      <div className="vidrio w-full max-w-md p-8">
        <Logo className="h-12" />
        <p className="mb-8 mt-4 text-sm text-tinta-suave">
          Gestión de expedientes de servicios mecánicos, de cerrajería, de grúa y de
          conductor elegido
        </p>

        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-tinta-suave">Documento</label>
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} className="campo" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-sm text-tinta-suave">Contraseña</label>
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className="campo" />
          </div>


          <button className="boton w-full" disabled={cargando}>
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
          {cargando && import.meta.env.PROD && (
            <p role="status" className="text-xs text-tinta-tenue">
              Si el servicio estaba en pausa, el primer acceso puede tardar hasta un minuto.
            </p>
          )}
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link to="/recuperar" className="text-tinta-suave underline hover:text-marca">
            Olvidé mi contraseña
          </Link>
          <Link to="/registro" className="text-marca underline hover:text-marca">
            Crear cuenta de cliente
          </Link>
        </div>

        <div className="vidrio-suave mt-8 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-tinta-tenue">Usuarios de demostración</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.doc}
                type="button"
                onClick={() => setDocumento(d.doc)}
                className="boton-suave text-left"
              >
                <span className="block font-mono text-xs text-marca">{d.doc}</span>
                <span className="block text-[11px] text-tinta-suave">{d.quien}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-tinta-tenue">Clave para todos: VialServi2026</p>
        </div>
      </div>
    </div>
  );
}
