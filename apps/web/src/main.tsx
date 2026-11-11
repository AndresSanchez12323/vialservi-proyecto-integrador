import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Disposicion } from './comun/Disposicion';
import { Login } from './paginas/Login';
import { sesion } from './comun/api';
import './estilos.css';

const esChrome =
  /Chrome\/\d/.test(navigator.userAgent) &&
  !/Edg\/|OPR\/|CriOS\/\d/.test(navigator.userAgent);

if (esChrome) {
  document.documentElement.classList.add('navegador-chrome');
}

const Landing = lazy(() => import('./paginas/Landing').then((m) => ({ default: m.Landing })));
const Registro = lazy(() => import('./paginas/Registro').then((m) => ({ default: m.Registro })));
const RecuperarClave = lazy(() => import('./paginas/RecuperarClave').then((m) => ({ default: m.RecuperarClave })));
const Panel = lazy(() => import('./paginas/Panel').then((m) => ({ default: m.Panel })));
const Servicios = lazy(() => import('./paginas/Servicios').then((m) => ({ default: m.Servicios })));
const ExpedienteDetalle = lazy(() => import('./paginas/ExpedienteDetalle').then((m) => ({ default: m.ExpedienteDetalle })));
const Vehiculos = lazy(() => import('./paginas/Vehiculos').then((m) => ({ default: m.Vehiculos })));
const Clientes = lazy(() => import('./paginas/Clientes').then((m) => ({ default: m.Clientes })));
const Tecnicos = lazy(() => import('./paginas/Tecnicos').then((m) => ({ default: m.Tecnicos })));
const Historicos = lazy(() => import('./paginas/Historicos').then((m) => ({ default: m.Historicos })));

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

const Privado = ({ children }: { children: React.ReactNode }) =>
  sesion.actual() ? <>{children}</> : <Navigate to="/login" replace />;

/** A donde entra cada rol al iniciar sesion. */
const inicio = () => {
  const rol = sesion.rol();
  return rol === 'TECNICO' || rol === 'CLIENTE' ? '/servicios' : '/panel';
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Cargando módulo…</div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/recuperar" element={<RecuperarClave />} />
            <Route
              element={
                <Privado>
                  <Disposicion />
                </Privado>
              }
            >
              <Route path="/panel" element={<Panel />} />
              <Route path="/servicios" element={<Servicios />} />
              <Route path="/expedientes/:id" element={<ExpedienteDetalle />} />
              <Route path="/vehiculos" element={<Vehiculos />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/tecnicos" element={<Tecnicos />} />
              <Route path="/historicos" element={<Historicos />} />
            </Route>
            <Route path="*" element={<Navigate to={sesion.actual() ? inicio() : '/login'} replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
