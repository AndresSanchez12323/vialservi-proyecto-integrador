/**
 * Pruebas de la plantilla del correo.
 *
 * No comprueban que "se vea bonito" —eso no se puede afirmar con una prueba—
 * sino las dos cosas que si se pueden romper en silencio: que el nombre del
 * usuario no pueda inyectar HTML, y que el codigo llegue en las dos versiones
 * del mensaje.
 */
import { describe, expect, it } from 'vitest';
import { correoRecuperacion, escapar } from './plantillas.js';

describe('Plantilla del correo de recuperacion', () => {
  it('escapa los caracteres con los que se inyecta HTML', () => {
    expect(escapar('<script>')).toBe('&lt;script&gt;');
    expect(escapar('a & b')).toBe('a &amp; b');
    expect(escapar(`"quoted" 'single'`)).toBe('&quot;quoted&quot; &#39;single&#39;');
  });

  it('un nombre con HTML no desmaqueta el correo ni mete enlaces', () => {
    // El nombre lo escribe el propio usuario al registrarse. Sin escapar, esto
    // convertiria nuestro mensaje en un vehiculo de phishing con nuestro
    // remitente, que es mucho peor que un correo mal maquetado.
    const malicioso = '<a href="http://malo.com">Haga clic</a>';
    const { html } = correoRecuperacion(malicioso, '123456', 15);

    expect(html).not.toContain('<a href="http://malo.com"');
    expect(html).toContain('&lt;a href=&quot;http://malo.com&quot;&gt;');
  });

  it('el codigo aparece en el HTML y en el texto plano', () => {
    // El texto plano no es un adorno: hay clientes que no muestran HTML, y un
    // correo que solo trae HTML cae mas facil en spam.
    const { html, texto, asunto } = correoRecuperacion('Santiago Gómez', '987654', 15);

    expect(texto).toContain('987654');
    expect(html).toContain('987654');
    // En el asunto tambien: deja ver el codigo desde la bandeja sin abrir.
    expect(asunto).toContain('987654');
  });

  it('avisa que nadie debe pedir el codigo, en las dos versiones', () => {
    const { html, texto } = correoRecuperacion('Ana', '111222', 15);
    expect(texto.toLowerCase()).toContain('nadie');
    expect(html.toLowerCase()).toContain('nadie');
  });

  it('dice cuantos minutos vence, con el valor que se le pase', () => {
    const { html, texto } = correoRecuperacion('Ana', '111222', 30);
    expect(texto).toContain('30 minutos');
    expect(html).toContain('30 minutos');
  });

  it('el HTML se maqueta con tablas y estilos en linea', () => {
    // Outlook renderiza con el motor de Word: sin tablas el correo se
    // desarma, y Gmail descarta buena parte de lo que no vaya en linea.
    const { html } = correoRecuperacion('Ana', '111222', 15);
    expect(html).toContain('<table');
    expect(html).toContain('style="');
    expect(html).not.toContain('display:flex');
    expect(html).toMatch(/^<!doctype html>/i);
  });
});
