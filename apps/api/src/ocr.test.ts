/**
 * Pruebas de la lectura del frente de la licencia de transito.
 *
 * No llaman a Textract: se arma a mano lo que Textract devuelve (palabras con
 * su posicion) imitando la disposicion real de la licencia colombiana, con
 * datos ficticios. Lo que se protege es el fallo que se vio en produccion: al
 * preguntarle a Textract en ingles, contestaba "MOTOCICLETA" a la placa y el
 * año del modelo al numero de motor, y llenaba campos que no correspondian.
 */
import { describe, expect, it } from 'vitest';
import type { Block } from '@aws-sdk/client-textract';
import { camposDeTarjeta, leerPorPosicion, limpiarPlaca, paraElFormulario, renglonesDeTextract, type Renglon } from './ocr.js';

const ALTO_ROTULO = 0.009;
const ALTO_VALOR = 0.016;

/** Una linea de texto: palabras que empiezan en x y comparten la altura y. */
const linea = (y: number, alto: number, ...trozos: [number, string][]): Renglon =>
  trozos.flatMap(([x, texto]) => {
    let cursor = x;
    return texto.split(' ').map((palabra) => {
      const caja = { texto: palabra, x0: cursor, x1: cursor + palabra.length * 0.012, y0: y, y1: y + alto };
      cursor = caja.x1 + 0.008;
      return caja;
    });
  });
const rotulos = (y: number, ...t: [number, string][]) => linea(y, ALTO_ROTULO, ...t);
const valores = (y: number, ...t: [number, string][]) => linea(y + ALTO_ROTULO + 0.004, ALTO_VALOR, ...t);

/** Frente de una licencia ficticia, con la disposicion de la tarjeta real. */
const FRENTE: Renglon[] = [
  linea(0.40, 0.014, [0.2, 'REPÚBLICA DE COLOMBIA']),
  linea(0.44, 0.012, [0.17, 'LICENCIA DE TRÁNSITO No.'], [0.62, '10099988877']),
  rotulos(0.50, [0.06, 'PLACA'], [0.22, 'MARCA'], [0.49, 'LÍNEA'], [0.80, 'MODELO']),
  // Textract junta placa, marca y linea en UN solo renglon: igual se separan
  // por la columna de cada rotulo.
  valores(0.50, [0.06, 'ABC12D'], [0.22, 'YAMAHA'], [0.49, 'FZ 2.0']),
  valores(0.50, [0.80, '2021']),
  rotulos(0.55, [0.06, 'CILINDRADA CC'], [0.22, 'COLOR'], [0.70, 'SERVICIO']),
  valores(0.55, [0.06, '150'], [0.22, 'AZUL NEGRO'], [0.698, 'PARTICULAR']),
  rotulos(0.60, [0.06, 'CLASE DE VEHÍCULO'], [0.31, 'TIPO CARROCERÍA'], [0.55, 'COMBUS TIBLE'], [0.78, 'CAPACIDAD Kg/PSJ']),
  valores(0.60, [0.06, 'MOTOCICLETA'], [0.31, 'SIN CARROCERIA'], [0.55, 'GASOLINA'], [0.78, '2']),
  rotulos(0.65, [0.06, 'NÚMERO DE MOTOR'], [0.48, 'REG'], [0.57, 'VIN']),
  valores(0.65, [0.06, 'G3K8E-1234567'], [0.48, 'N'], [0.57, '9C6KE1234M0012345']),
  rotulos(0.70, [0.06, 'NÚMERO DE SERIE'], [0.48, 'REG'], [0.53, 'NÚMERO DE CHASIS'], [0.86, 'REG']),
  valores(0.70, [0.06, '******'], [0.48, 'N'], [0.53, '9C6KE1234M0012345'], [0.86, 'N']),
  rotulos(0.75, [0.06, 'PROPIETARIO: APELLIDO(S) Y NOMBRE(S)'], [0.69, 'IDENTIFICACIÓN']),
  valores(0.75, [0.06, 'PEREZ GOMEZ JUAN CARLOS'], [0.63, 'C.C. 12345678']),
];

const ESPERADO = {
  placa: 'ABC12D',
  marca: 'YAMAHA',
  linea: 'FZ 2.0',
  modelo: '2021',
  color: 'AZUL NEGRO',
  clase: 'MOTOCICLETA',
  licenciaTransito: '10099988877',
  vin: '9C6KE1234M0012345',
  chasis: '9C6KE1234M0012345',
  motor: 'G3K8E-1234567',
  propietarioNombre: 'PEREZ GOMEZ JUAN CARLOS',
  propietarioDocumento: '12345678',
};

/** Convierte los renglones en bloques de Textract, girados `grados`. */
const comoTextract = (renglones: Renglon[], grados = 0): Block[] => {
  const g = (grados * Math.PI) / 180;
  const rotar = (x: number, y: number) => ({
    X: 0.5 + (x - 0.5) * Math.cos(g) - (y - 0.5) * Math.sin(g),
    Y: 0.5 + (x - 0.5) * Math.sin(g) + (y - 0.5) * Math.cos(g),
  });
  const poligono = (c: { x0: number; x1: number; y0: number; y1: number }) =>
    [rotar(c.x0, c.y0), rotar(c.x1, c.y0), rotar(c.x1, c.y1), rotar(c.x0, c.y1)];
  const bloques: Block[] = [];
  renglones.forEach((r, i) => {
    const ids = r.map((_, j) => `p${i}-${j}`);
    const caja = { x0: r[0].x0, x1: r[r.length - 1].x1, y0: r[0].y0, y1: r[0].y1 };
    bloques.push({
      BlockType: 'LINE', Id: `l${i}`, Text: r.map((p) => p.texto).join(' '),
      Geometry: { Polygon: poligono(caja) }, Relationships: [{ Type: 'CHILD', Ids: ids }],
    });
    r.forEach((p, j) => bloques.push({ BlockType: 'WORD', Id: ids[j], Text: p.texto, Geometry: { Polygon: poligono(p) } }));
  });
  return bloques;
};

const leer = (bloques: Block[]) => camposDeTarjeta(leerPorPosicion(renglonesDeTextract(bloques)));

describe('Lectura del frente de la licencia de transito', () => {
  it('toma cada dato de la columna de su rotulo, aunque vengan en el mismo renglon', () => {
    expect(leer(comoTextract(FRENTE))).toEqual(ESPERADO);
  });

  it('endereza la foto torcida', () => {
    expect(leer(comoTextract(FRENTE, 8))).toEqual(ESPERADO);
    expect(leer(comoTextract(FRENTE, -6))).toEqual(ESPERADO);
  });

  it('no inventa campos: lo que no esta impreso se deja vacio', () => {
    const sinMotorNiPropietario = FRENTE.filter((r) =>
      !/MOTOR|G3K8E|PROPIETARIO|PEREZ/.test(r.map((p) => p.texto).join(' ')));
    const datos = leer(comoTextract(sinMotorNiPropietario));
    expect(datos.motor).toBeUndefined();
    expect(datos.propietarioNombre).toBeUndefined();
    expect(datos.placa).toBe('ABC12D');
  });

  it('el reverso u otra foto no devuelve datos del vehiculo', () => {
    const reverso: Renglon[] = [
      rotulos(0.3, [0.06, 'RESTRICCIÓN MOVILIDAD'], [0.4, 'BLINDAJE'], [0.5, 'POTENCIA HP']),
      valores(0.3, [0.4, '******'], [0.5, '13']),
      rotulos(0.4, [0.06, 'FECHA MATRÍCULA'], [0.3, 'FECHA EXP. LIC. TTO.']),
      valores(0.4, [0.06, '20/03/2025'], [0.3, '20/03/2025']),
    ];
    expect(leer(comoTextract(reverso))).toEqual({});
  });

  it('reconoce un rotulo con una letra mal leida, como LIMEA por LINEA', () => {
    const conErrata = FRENTE.map((r) => r.map((p) => (p.texto === 'LÍNEA' ? { ...p, texto: 'LIMEA' } : p)));
    const datos = leer(comoTextract(conErrata));
    expect(datos.linea).toBe('FZ 2.0');
    expect(datos.marca).toBe('YAMAHA');
  });

  it('un valor en letra grande no se toma por rotulo aunque se parezca (PLATA no es PLACA)', () => {
    const plata = FRENTE.map((r) => r.map((p) => (p.texto === 'AZUL' ? { ...p, texto: 'PLATA' } : p))
      .filter((p) => p.texto !== 'NEGRO'));
    const datos = leer(comoTextract(plata));
    expect(datos.color).toBe('PLATA');
    expect(datos.placa).toBe('ABC12D');
  });

  it('al formulario solo llegan placa, marca, linea y color: ni VIN ni numero de licencia', () => {
    expect(paraElFormulario(leer(comoTextract(FRENTE)))).toEqual({
      placa: 'ABC12D', marca: 'YAMAHA', linea: 'FZ 2.0', color: 'AZUL NEGRO',
    });
  });

  it('el tipo de documento no se pega al nombre del propietario', () => {
    expect(camposDeTarjeta({ propietarioNombre: 'PEREZ GOMEZ JUAN C.C.' }).propietarioNombre).toBe('PEREZ GOMEZ JUAN');
  });
});

describe('Validacion de cada campo', () => {
  it('la placa corrige las confusiones del OCR segun la posicion', () => {
    expect(limpiarPlaca('abc 123')).toBe('ABC123');
    expect(limpiarPlaca('A8C1Z3')).toBe('ABC123');
    expect(limpiarPlaca('GXY81H')).toBe('GXY81H');
    expect(limpiarPlaca('GXY 81H')).toBe('GXY81H');
  });

  it('no acepta como placa algo sin forma de placa', () => {
    expect(limpiarPlaca('OTOCICLETA')).toBeUndefined();
    expect(limpiarPlaca('AB1')).toBeUndefined();
    expect(camposDeTarjeta({ placa: 'MOTOCICLETA', marca: 'MOTOCICLETA' }).placa).toBeUndefined();
  });

  it('descarta las respuestas de "no hay dato", aunque lleven espacios o punto', () => {
    expect(camposDeTarjeta({
      placa: 'NOT FOUND', marca: 'Not Found.', linea: 'N/A', clase: 'no aplica', vin: 'NOT FOUND',
      chasis: 'sin dato', motor: '******', propietarioNombre: 'none', propietarioDocumento: 'N/A',
    })).toEqual({});
  });

  it('el modelo solo se acepta como año y el motor no puede ser un año suelto mal leido', () => {
    expect(camposDeTarjeta({ modelo: '2018' }).modelo).toBe('2018');
    expect(camposDeTarjeta({ modelo: 'XR150L' }).modelo).toBeUndefined();
    expect(camposDeTarjeta({ motor: '***' }).motor).toBeUndefined();
  });
});
