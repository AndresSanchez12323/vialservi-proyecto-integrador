import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { sesion } from './api';
import { Atras } from './Atras';
import { BotonTema } from './BotonTema';
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
      {/* En movil la cabecera va en dos filas: la marca arriba, ocupando el
          ancho completo, y los controles debajo. Antes el grupo de la derecha
          era un flex SIN envoltura —cinco controles en una fila que no cabe en
          360 px— y sacaba la cabecera por el borde de la pantalla. */}
      <header className="vidrio relative z-30 mb-6 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <Logo className="h-8" />
            <p className="mt-1 text-xs text-tinta-suave">
              Gestión de expedientes de servicios mecánicos, de cerrajería, de grúa y de
              conductor elegido
            </p>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
            <Atras />
            <BotonTema />
            <Notificaciones />
            {/* min-w-0 + truncate: un nombre largo estrujaba los botones de al
                lado y les partia el texto, en vez de recortarse el. */}
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-medium">{usuario?.nombre}</p>
              <p className="truncate text-xs text-marca">{ROLES[rol] ?? rol}</p>
            </div>
            <button onClick={salir} className="boton-suave shrink-0">Salir</button>
          </div>
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
                            ? 'bg-marca-fondo/20 font-medium text-marca shadow-inner'
                            : 'text-tinta-suave hover:bg-velo/10'
                        }`
                      }
                    >
                      {m.nombre}
                    </NavLink>
                  </li>
                ) : (
                  <li
                    key={m.ruta}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-tinta-sutil"
                    title="Módulo previsto en el alcance, aún no construido"
                  >
                    {m.nombre}
                    <span className="etiqueta bg-velo/5 text-[10px] uppercase text-tinta-tenue">
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
