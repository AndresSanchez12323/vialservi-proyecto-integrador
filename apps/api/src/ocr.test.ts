/**
 * Pruebas de lo que se guarda y lo que se tira de una lectura de tarjeta.
 *
 * No llaman a Textract: la parte que decide es `camposDeTarjeta`, y esta
 * separada del llamado a AWS justamente para poder comprobarla aqui. Lo que
 * se protege es un fallo concreto y silencioso: una respuesta de "no lo
 * encontre" que se colaba como si fuera un dato del documento, porque la
 * limpieza del texto corria ANTES de comprobar si decia algo.
 */
import { describe, expect, it } from 'vitest';
import { camposDeTarjeta } from './ocr.js';

describe('Lectura de la tarjeta de propiedad', () => {
  it('toma los campos del documento y normaliza placa, series y documento', () => {
    const datos = camposDeTarjeta({
      placa: 'abc 123',
      marca: ' Renault ',
      linea: 'Logan Life',
      modelo: '2018',
      color: 'Gris',
      vin: '9fb-jc5220rb077777',
      propietarioDocumento: 'CC 71.234.567',
    });

    expect(datos.placa).toBe('ABC123');
    expect(datos.marca).toBe('Renault');
    expect(datos.linea).toBe('Logan Life');
    expect(datos.modelo).toBe('2018');
    expect(datos.vin).toBe('9FB-JC5220RB077777');
    expect(datos.propietarioDocumento).toBe('71234567');
  });

  it('descarta las respuestas de "no lo encontre", aunque lleven espacios o punto', () => {
    const datos = camposDeTarjeta({
      placa: 'NOT FOUND',
      marca: 'Not Found.',
      linea: 'N/A',
      clase: 'no aplica',
      vin: 'NOT FOUND',
      chasis: 'sin dato',
      motor: '-',
      propietarioNombre: 'none',
      propietarioDocumento: 'N/A',
    });

    // Ninguno queda: antes "NOT FOUND" perdia el espacio al limpiarse, se
    // volvia "NOTFOUND" y se guardaba como VIN; y la placa llegaba a "NOTFOU",
    // con longitud valida, de modo que la lectura fallida pasaba por buena.
    expect(datos).toEqual({});
  });

  it('una placa que no se leyo completa no se acepta a medias', () => {
    expect(camposDeTarjeta({ placa: 'AB1', marca: 'Mazda' }).placa).toBeUndefined();
    expect(camposDeTarjeta({ placa: 'ABC12', marca: 'Mazda' }).placa).toBe('ABC12');
  });

  it('un valor sin letras solo sirve si trae algun digito', () => {
    expect(camposDeTarjeta({ modelo: '2018' }).modelo).toBe('2018');
    expect(camposDeTarjeta({ modelo: '---' }).modelo).toBeUndefined();
    expect(camposDeTarjeta({ modelo: '   ' }).modelo).toBeUndefined();
  });
});
