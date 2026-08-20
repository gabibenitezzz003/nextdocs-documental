import { describe, expect, it } from 'vitest';

import { MARGEN_ENCABEZADO_PDF, claveAlmacen, inspeccionar, nombreSeguroDe, tipoRealDe } from './seguridad.js';
import { LIMITES } from './documentos.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2048)]);
const JPG = Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(2048)]);
const ZIP = Buffer.concat([Buffer.from('PK'), Buffer.alloc(2048)]);

describe('deteccion de tipo por firma', () => {
  it('reconoce los formatos aceptados', () => {
    expect(tipoRealDe(PDF)).toBe('application/pdf');
    expect(tipoRealDe(PNG)).toBe('image/png');
    expect(tipoRealDe(JPG)).toBe('image/jpeg');
  });

  it('no reconoce un formato no autorizado', () => {
    expect(tipoRealDe(ZIP)).toBeNull();
  });

  it('no se cuelga con un archivo diminuto', () => {
    expect(tipoRealDe(Buffer.from('ab'))).toBeNull();
  });
});

describe('saneo del nombre', () => {
  it('corta el recorrido de rutas', () => {
    const nombre = nombreSeguroDe('../../../etc/passwd.pdf');
    expect(nombre).not.toContain('..');
    expect(nombre).not.toContain('/');
  });

  it('saca caracteres que rompen el sistema de archivos', () => {
    expect(nombreSeguroDe('a:b*c?d"e<f>g|h.pdf')).not.toMatch(/[:*?"<>|]/);
  });

  it('nunca devuelve vacio', () => {
    expect(nombreSeguroDe('')).toBe('documento');
    expect(nombreSeguroDe('...')).toBe('documento');
  });

  it('respeta el largo maximo', () => {
    expect(nombreSeguroDe('a'.repeat(500)).length).toBeLessThanOrEqual(LIMITES.nombreMaximo);
  });
});

describe('inspeccion completa', () => {
  it('acepta un pdf coherente', () => {
    const r = inspeccionar('remito.pdf', 'application/pdf', PDF);
    expect(r.aceptado).toBe(true);
    expect(r.tipoReal).toBe('application/pdf');
  });

  it('rechaza cuando el tipo declarado miente', () => {
    const r = inspeccionar('remito.pdf', 'image/png', PDF);
    expect(r.aceptado).toBe(false);
    expect(r.rechazos.some((x) => x.codigo === 'TIPO_DECLARADO_NO_COINCIDE')).toBe(true);
  });

  it('rechaza cuando la extension no corresponde al contenido', () => {
    const r = inspeccionar('foto.png', undefined, PDF);
    expect(r.aceptado).toBe(false);
    expect(r.rechazos.some((x) => x.codigo === 'EXTENSION_NO_COINCIDE')).toBe(true);
  });

  it('rechaza un formato no autorizado aunque el nombre disimule', () => {
    const r = inspeccionar('inocente.pdf', 'application/pdf', ZIP);
    expect(r.aceptado).toBe(false);
    expect(r.rechazos.some((x) => x.codigo === 'TIPO_NO_RECONOCIDO')).toBe(true);
  });

  it('rechaza un archivo mas grande que el limite', () => {
    const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(LIMITES.tamanoMaximoBytes)]);
    const r = inspeccionar('grande.pdf', 'application/pdf', grande);
    expect(r.rechazos.some((x) => x.codigo === 'ARCHIVO_DEMASIADO_GRANDE')).toBe(true);
  });

  it('rechaza un archivo vacio', () => {
    const r = inspeccionar('vacio.pdf', 'application/pdf', Buffer.alloc(0));
    expect(r.rechazos.some((x) => x.codigo === 'ARCHIVO_VACIO')).toBe(true);
  });
});

describe('clave de almacenamiento', () => {
  it('la arma el sistema y nunca el usuario', () => {
    const clave = claveAlmacen('inq-1', 'doc-1', 'application/pdf');
    expect(clave).toBe('inq-1/doc-1/original.pdf');
  });

  it('aisla por inquilino', () => {
    const a = claveAlmacen('inq-a', 'doc-1', 'image/png');
    const b = claveAlmacen('inq-b', 'doc-1', 'image/png');
    expect(a).not.toBe(b);
    expect(a.startsWith('inq-a/')).toBe(true);
  });
});

describe('encabezado de pdf corrido', () => {
  it('acepta un pdf que arranca con basura antes de la firma', () => {
    const contenido = Buffer.concat([
      Buffer.from('2 J\n', 'latin1'),
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.alloc(200, 0x20),
    ]);
    expect(tipoRealDe(contenido)).toBe('application/pdf');
  });

  it('no acepta un pdf cuya firma aparece despues del margen', () => {
    const contenido = Buffer.concat([
      Buffer.alloc(MARGEN_ENCABEZADO_PDF + 8, 0x20),
      Buffer.from('%PDF-1.7\n', 'latin1'),
    ]);
    expect(tipoRealDe(contenido)).toBeNull();
  });
});
