import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlmacenamientoEnMemoria } from './almacenamiento.js';
import {
  contarPaginas,
  extraerPaginas,
  normalizarSegmentos,
  segmentosPorPagina,
} from './paginado.js';
import { almacenamientoDeEntorno, motorDeEntorno } from './fabricas.js';
import { MotorGemini } from './motorGemini.js';
import { MotorSimulado } from './motorSimulado.js';
import { limpiarGuiones, registrarGuion } from './motorSimulado.js';
import { REMITO } from '@nextdocs/dominio';
import { createHash } from 'node:crypto';

const entornoOriginal = { ...process.env };

describe('fabricas de entorno', () => {
  beforeEach(() => {
    process.env['ALMACENAMIENTO'] = 'memoria';
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
    limpiarGuiones();
  });

  it('devuelve el motor simulado cuando no se configura proveedor', () => {
    delete process.env['PROVEEDOR_IA'];
    expect(motorDeEntorno()).toBeInstanceOf(MotorSimulado);
  });

  it('devuelve gemini cuando hay clave', () => {
    process.env['PROVEEDOR_IA'] = 'gemini';
    process.env['GOOGLE_API_KEY'] = 'clave-de-prueba';
    expect(motorDeEntorno()).toBeInstanceOf(MotorGemini);
  });

  it('avisa si falta la clave de gemini en vez de arrancar a medias', () => {
    process.env['PROVEEDOR_IA'] = 'gemini';
    delete process.env['GOOGLE_API_KEY'];
    expect(() => motorDeEntorno()).toThrow(/GOOGLE_API_KEY/);
  });

  it('rechaza un proveedor que no existe', () => {
    process.env['PROVEEDOR_IA'] = 'inventado';
    expect(() => motorDeEntorno()).toThrow(/Proveedor de IA desconocido/);
  });

  it('usa el almacenamiento en memoria cuando se lo pide', () => {
    expect(almacenamientoDeEntorno()).toBeInstanceOf(AlmacenamientoEnMemoria);
  });
});

describe('almacenamiento en memoria', () => {
  it('devuelve lo mismo que guardo', async () => {
    const almacen = new AlmacenamientoEnMemoria();
    await almacen.guardar('inquilino/uno.pdf', Buffer.from('hola'), 'application/pdf');
    expect((await almacen.leer('inquilino/uno.pdf')).toString()).toBe('hola');
  });

  it('falla al leer una clave que no existe', async () => {
    const almacen = new AlmacenamientoEnMemoria();
    await expect(almacen.leer('no-esta.pdf')).rejects.toThrow();
  });
});

describe('motor simulado', () => {
  afterEach(() => {
    limpiarGuiones();
  });

  it('clasifica por el nombre del archivo cuando no hay guion', async () => {
    const motor = new MotorSimulado();
    const salida = await motor.clasificar({
      contenido: Buffer.from('sin guion'),
      tipoMime: 'application/pdf',
      nombreArchivo: 'REMITO-1234.pdf',
      plantillasPosibles: ['REMITO', 'FACTURA'],
    });

    expect(salida.tipo).toBe('REMITO');
    expect(salida.confianza).toBeGreaterThan(0.9);
  });

  it('solo extrae los campos que estan en la plantilla', async () => {
    const contenido = Buffer.from('remito guionado');
    registrarGuion(createHash('sha256').update(contenido).digest('hex'), {
      campos: {
        numero: { valor: '0004-00001234', confianza: 0.97 },
        inventado: { valor: 'no deberia salir', confianza: 0.99 },
      },
    });

    const salida = await new MotorSimulado().extraer({
      contenido,
      tipoMime: 'application/pdf',
      plantilla: REMITO,
    });

    expect(Object.keys(salida.campos)).toEqual(['numero']);
    expect(salida.uso.proveedor).toBe('simulado');
  });

  it('propaga la falla del proveedor con su codigo', async () => {
    const contenido = Buffer.from('proveedor caido');
    registrarGuion(createHash('sha256').update(contenido).digest('hex'), { falla: 'PROVEEDOR_CAIDO' });

    await expect(
      new MotorSimulado().extraer({ contenido, tipoMime: 'application/pdf', plantilla: REMITO }),
    ).rejects.toThrow(/no responde/);
  });
});

describe('paginado de pdf', () => {
  const armarPdf = async (paginas: number) => {
    const { PDFDocument } = await import('pdf-lib');
    const documento = await PDFDocument.create();
    for (let i = 0; i < paginas; i += 1) documento.addPage([595, 842]);
    return Buffer.from(await documento.save());
  };

  it('cuenta las paginas de verdad', async () => {
    expect(await contarPaginas(await armarPdf(10))).toBe(10);
    expect(await contarPaginas(await armarPdf(1))).toBe(1);
  });

  it('avisa si el pdf no se puede abrir', async () => {
    await expect(contarPaginas(Buffer.from('no soy un pdf'))).rejects.toMatchObject({
      name: 'ErrorPaginado',
      codigo: 'PDF_ILEGIBLE',
    });
  });

  it('extrae un rango de paginas como pdf nuevo', async () => {
    const original = await armarPdf(10);
    const recorte = await extraerPaginas(original, 3, 5);
    expect(await contarPaginas(recorte)).toBe(3);
  });

  it('no se sale del rango del documento', async () => {
    const original = await armarPdf(4);
    expect(await contarPaginas(await extraerPaginas(original, 3, 99))).toBe(2);
    expect(await contarPaginas(await extraerPaginas(original, 0, 1))).toBe(1);
  });

  it('un segmento por pagina cuando no hay quien decida', () => {
    expect(segmentosPorPagina(3)).toEqual([
      { desde: 1, hasta: 1, tipo: null },
      { desde: 2, hasta: 2, tipo: null },
      { desde: 3, hasta: 3, tipo: null },
    ]);
  });

  it('acepta segmentos que cubren todo sin pisarse', () => {
    const salida = normalizarSegmentos(
      [{ desde: 1, hasta: 2, tipo: 'factura' }, { desde: 3, hasta: 3, tipo: 'remito' }],
      3,
    );
    expect(salida).toEqual([
      { desde: 1, hasta: 2, tipo: 'FACTURA' },
      { desde: 3, hasta: 3, tipo: 'REMITO' },
    ]);
  });

  it('descarta la segmentacion si deja paginas afuera', () => {
    expect(normalizarSegmentos([{ desde: 1, hasta: 1 }], 5)).toEqual([]);
  });

  it('descarta la segmentacion si los rangos se pisan', () => {
    expect(normalizarSegmentos([{ desde: 1, hasta: 3 }, { desde: 2, hasta: 4 }], 4)).toEqual([]);
  });

  it('descarta rangos imposibles', () => {
    expect(normalizarSegmentos([{ desde: 4, hasta: 2 }], 4)).toEqual([]);
    expect(normalizarSegmentos('no es una lista', 4)).toEqual([]);
  });
});
