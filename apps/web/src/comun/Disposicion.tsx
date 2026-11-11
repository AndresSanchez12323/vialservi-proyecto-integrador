import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { enviar, sesion } from './api';
import { Atras } from './Atras';
import { Logo } from './Logo';
import { Notificaciones } from './Notificaciones';
import { ROLES } from './formato';

/** El menu se arma segun el rol: cada quien ve solo los modulos que le
 *  corresponden. El filtro real vive en el servidor; esto es la navegacion. */
const MODULOS = [
  { ruta: '/panel', nombre: 'Panel', roles: ['ADMINISTRADOR', 'CENTRAL'], listo: true },
  { ruta: '/servicios', nombre: 'Gestionar servicio', roles: ['ADMINISTRADOR', 'CENTRAL', 'TECNICO', 'CLIENTE'], listo: true },
  // El cliente tambien entra aqui: registrar su vehiculo es el paso previo a
  // poder pedir un servicio. Solo ve los suyos, y ese filtro es del servidor.
  { ruta: '/vehiculos', nombre: 'Gestionar vehículo e inventario', roles: ['ADMINISTRADOR', 'CENTRAL', 'CLIENTE'], listo: true },
  { ruta: '/clientes', nombre: 'Gestionar cliente', roles: ['ADMINISTRADOR', 'CENTRAL'], listo: true },
  { ruta: '/tecnicos', nombre: 'Gestionar técnico', roles: ['ADMINISTRADOR', 'CENTRAL'], listo: true },
  { ruta: '/historicos', nombre: 'Gestionar históricos', roles: ['ADMINISTRADOR', 'CENTRAL'], listo: true },
  { ruta: '/usuarios', nombre: 'Gestionar usuarios y roles', roles: ['ADMINISTRADOR'], listo: false },
  { ruta: '/ayuda', nombre: 'Ayuda', roles: ['ADMINISTRADOR', 'CENTRAL', 'TECNICO', 'CLIENTE'], listo: false },
];

export function Disposicion() {
  const navegar = useNavigate();
  const usuario = sesion.usuario();
  const rol = usuario?.rol ?? '';
  // Central y administrador navegan desde el tablero: el menú lateral sobra.
  // Técnico y cliente no tienen tablero, así que lo conservan.
  const conTablero = rol === 'ADMINISTRADOR' || rol === 'CENTRAL';
  const visibles = MODULOS.filter((m) => m.roles.includes(rol));
  const [claveAbierta, setClaveAbierta] = useState(false);
  const [verificacionId, setVerificacionId] = useState('');
  const [codigo, setCodigo] = useState('');
  const [nueva, setNueva] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [errorClave, setErrorClave] = useState('');

  const solicitarCodigo = async () => {
    try {
      setErrorClave('');
      const r = await enviar<{ verificacionId: string }>('/auth/clave/iniciar', 'POST');
      setVerificacionId(r.verificacionId);
      setMensaje('Código enviado al correo registrado.');
    } catch (error) {
      setErrorClave(error instanceof Error ? error.message : 'No se pudo enviar el código.');
    }
  };
  const cambiarClave = async () => {
    try {
      setErrorClave('');
      await enviar('/auth/clave/confirmar', 'POST', { verificacionId, codigo, nueva });
      setMensaje('Contraseña actualizada correctamente.');
      setVerificacionId('');
      setCodigo('');
      setNueva('');
    } catch (error) {
      setErrorClave(error instanceof Error ? error.message : 'No se pudo cambiar la contraseña.');
    }
  };

  const salir = () => {
    sesion.cerrar();
    navegar('/login');
  };

  return (
    <div className="min-h-screen p-4 lg:p-6">
      {/* relative + z-30: .vidrio trae backdrop-blur, y un backdrop-filter crea
          contexto de apilamiento. Sin z-index propio, la cabecera encierra el
          desplegable de notificaciones en su capa y las tarjetas del contenido,
          que van despues en el DOM, se pintan encima. */}
      <header className="vidrio relative z-30 mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <Logo className="h-8" />
          <p className="mt-1 text-xs text-slate-300">
            Gestión de expedientes de servicios mecánicos, de cerrajería, de grúa y de
            conductor elegido
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Atras />
          <Notificaciones />
          <div className="text-right">
            <p className="text-sm font-medium">{usuario?.nombre}</p>
            <p className="text-xs text-amber-300">{ROLES[rol] ?? rol}</p>
            <button className="text-xs text-slate-400 underline hover:text-amber-200" onClick={() => { setClaveAbierta(true); setMensaje(''); setErrorClave(''); }}>
              Cambiar contraseña
            </button>
          </div>
          <button onClick={salir} className="boton-suave">Salir</button>
        </div>
      </header>

      {claveAbierta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
          <section className="vidrio w-full max-w-md space-y-3 p-6">
            <h2 className="text-lg font-semibold">Cambiar contraseña</h2>
            {!verificacionId ? (
              <button className="boton" onClick={solicitarCodigo}>Enviar código al correo</button>
            ) : (
              <>
                <input className="campo text-center font-mono tracking-widest" placeholder="Código de 6 dígitos"
                  value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} maxLength={6} />
                <input className="campo" type="password" placeholder="Nueva contraseña (mínimo 8 caracteres)"
                  value={nueva} onChange={(e) => setNueva(e.target.value)} />
                <button className="boton" disabled={codigo.length !== 6 || nueva.length < 8} onClick={cambiarClave}>
                  Confirmar cambio
                </button>
              </>
            )}
            {mensaje && <p className="text-sm text-emerald-300">{mensaje}</p>}
            {errorClave && <p className="text-sm text-rose-300">{errorClave}</p>}
            <button className="boton-suave" onClick={() => setClaveAbierta(false)}>Cerrar</button>
          </section>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {!conTablero && (
          <nav className="vidrio h-fit w-full p-3 lg:w-72">
            <ul className="space-y-1">
              {visibles.map((m) =>
                m.listo ? (
                  <li key={m.ruta}>
                    <NavLink
                      to={m.ruta}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2 text-sm transition ${
                          isActive
                            ? 'bg-amber-400/20 font-medium text-amber-200 shadow-inner'
                            : 'text-slate-200 hover:bg-white/10'
                        }`
                      }
                    >
                      {m.nombre}
                    </NavLink>
                  </li>
                ) : (
                  <li
                    key={m.ruta}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-500"
                    title="Módulo previsto en el alcance, aún no construido"
                  >
                    {m.nombre}
                    <span className="etiqueta bg-white/5 text-[10px] uppercase text-slate-400">
                      pendiente
                    </span>
                  </li>
                ),
              )}
            </ul>
          </nav>
        )}

        <main className="min-w-0 flex-1 pb-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
