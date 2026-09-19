import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Disposicion } from './comun/Disposicion';
import { Login } from './paginas/Login';
import { Panel } from './paginas/Panel';
import { Servicios } from './paginas/Servicios';
import { ExpedienteDetalle } from './paginas/ExpedienteDetalle';
import { Vehiculos } from './paginas/Vehiculos';
import { Clientes } from './paginas/Clientes';
import { Tecnicos } from './paginas/Tecnicos';
import { Historicos } from './paginas/Historicos';
import { sesion } from './comun/api';
import './estilos.css';

const cliente = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
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
        <Routes>
          <Route path="/login" element={<Login />} />
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
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
