import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { sesion } from './api';
import { Atras } from './Atras';
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

  const salir = () => {
    sesion.cerrar();
    navegar('/login');
  };

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <header className="vidrio mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">VialServi</h1>
          <p className="text-xs text-slate-300">
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
          </div>
          <button onClick={salir} className="boton-suave">Salir</button>
        </div>
      </header>

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
