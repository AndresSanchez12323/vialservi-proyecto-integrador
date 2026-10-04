/**
 * Registro publico. SOLO crea cuentas de cliente: los permisos de central,
 * tecnico y administrador los asigna personal autorizado. El formulario no
 * ofrece elegir rol y el servidor tampoco lo acepta, de modo que la regla no
 * depende de que la pantalla la respete.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { publico, sesion, type Sesion } from '../comun/api';

export function Registro() {
  const navegar = useNavigate();
  const [form, setForm] = useState({
    documento: '', nombre: '', correo: '', telefono: '', clave: '', confirmar: '',
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cambiar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [campo]: e.target.value });

  // Se valida aqui tambien para avisar antes de ir al servidor, pero la regla
  // de verdad vive en el API: esto es comodidad, no seguridad.
  const problemas: string[] = [];
  if (form.documento && !/^\d{5,15}$/.test(form.documento)) problemas.push('El documento son solo números (5 a 15 dígitos).');
  if (form.clave && form.clave.length < 8) problemas.push('La contraseña debe tener al menos 8 caracteres.');
  if (form.confirmar && form.clave !== form.confirmar) problemas.push('Las contraseñas no coinciden.');

  const completo =
    /^\d{5,15}$/.test(form.documento) &&
    form.nombre.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(form.correo) &&
    form.telefono.trim().length >= 7 &&
    form.clave.length >= 8 &&
    form.clave === form.confirmar;

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const r = await publico<{ token: string; usuario: Sesion; enlazadoAFichaExistente: boolean }>(
        '/auth/registro',
        {
          documento: form.documento,
          nombre: form.nombre.trim(),
          correo: form.correo.trim().toLowerCase(),
          telefono: form.telefono.trim(),
          clave: form.clave,
        },
      );
      // El registro ya devuelve la sesion: pedirle iniciar sesion otra vez
      // seria un paso de mas sin ninguna ganancia.
      sesion.guardar(r.token, r.usuario);
      navegar('/vehiculos');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible crear la cuenta');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="vidrio w-full max-w-lg p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Crear cuenta</h1>
        <p className="mb-6 text-sm text-slate-300">
          Regístrese como cliente para registrar sus vehículos y solicitar servicios.
        </p>

        <form onSubmit={registrar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-300">Documento</label>
              <input
                value={form.documento}
                onChange={cambiar('documento')}
                className="campo font-mono"
                inputMode="numeric"
                placeholder="1012345678"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-300">Teléfono</label>
              <input
                value={form.telefono}
                onChange={cambiar('telefono')}
                className="campo"
                inputMode="tel"
                placeholder="3001234567"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">Nombre completo</label>
            <input value={form.nombre} onChange={cambiar('nombre')} className="campo" placeholder="Santiago Gómez" />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">Correo</label>
            <input
              type="email"
              value={form.correo}
              onChange={cambiar('correo')}
              className="campo"
              placeholder="santiago@correo.com"
            />
            <p className="mt-1 text-xs text-slate-400">
              A este correo llega el código si olvida la contraseña.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-300">Contraseña</label>
              <input type="password" value={form.clave} onChange={cambiar('clave')} className="campo" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-300">Repetir contraseña</label>
              <input type="password" value={form.confirmar} onChange={cambiar('confirmar')} className="campo" />
            </div>
          </div>

          {problemas.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {problemas.map((p) => <li key={p}>• {p}</li>)}
            </ul>
          )}
          {error && (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          <button className="boton w-full" disabled={!completo || cargando}>
            {cargando ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          ¿Ya tiene cuenta?{' '}
          <Link to="/login" className="text-amber-300 underline hover:text-amber-200">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
