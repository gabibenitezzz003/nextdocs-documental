import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AlmacenamientoEnMemoria, MotorSimulado, limpiarGuiones, registrarGuion } from '@nextdocs/adaptadores';
import { cerrar, conexion, enTransaccion } from '@nextdocs/db';
import { exigirBaseDePruebas, migrar, usarBaseDePruebas } from '@nextdocs/db';
import { DNI, FACTURA, REMITO, VTV, emparejar, type ObjetoNegocio, type ValorExtraido } from '@nextdocs/dominio';
import { createHash, randomUUID } from 'node:crypto';

import { FallaTransitoria, procesarDocumento } from './procesamiento.js';
import { hallazgosDeConstatacion, verificarContraArca } from './fiscal.js';
import { leCorresponde } from './distribucion.js';
import { asuntoDeCorreo, htmlDeCorreo, textoDeCorreo } from './plantillaCorreo.js';
import {
  buscarObjetosEnFollow,
  choferComoObjeto,
  vehiculoComoObjeto,
} from './catalogoFollow.js';
import {
  EMISOR_GENERICO,
  aplicarCorrecciones,
  claveDeEmisor,
  correccionesDe,
  pistasDeExtraccion,
  registrarCorreccion,
} from './aprendizaje.js';
import { recibirDocumento } from './recepcion.js';
import { esReintentable, esperaDeReintento, firmar } from './entrega.js';

const INQUILINO = '11111111-1111-1111-1111-111111111111';
const OTRO_INQUILINO = '33333333-3333-3333-3333-333333333333';

const almacenamiento = new AlmacenamientoEnMemoria();
const motor = new MotorSimulado();
const encolados: { nombre: string; clave: string }[] = [];

const dependenciasRecepcion = {
  almacenamiento,
  encolar: async (nombre: string, clave: string) => {
    encolados.push({ nombre, clave });
  },
};

let catalogo: ObjetoNegocio[] = [];

const dependenciasProceso = {
  almacenamiento,
  motor,
  buscarObjetos: async () => catalogo,
};

function pdf(marca: string): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marca), Buffer.alloc(1024, 0x20)]);
}

function huella(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}

const CAMPOS_COMPLETOS = {
  numero: { valor: '0004-00008932', confianza: 0.97 },
  fechaEmision: { valor: new Date().toLocaleDateString('es-AR'), confianza: 0.96 },
  cuitEmisor: { valor: '20-12345678-6', confianza: 0.98 },
  razonSocialEmisor: { valor: 'BODEGA SAN MARTIN SA', confianza: 0.95 },
  razonSocialDestinatario: { valor: 'CEPAS ARGENTINAS SA', confianza: 0.94 },
  domicilioEntrega: { valor: 'San Martin 1450, Godoy Cruz', confianza: 0.93 },
  conformado: { valor: true, confianza: 0.95 },
  nroPedido: { valor: '80264630', confianza: 0.93 },
};

async function cargar(nombre: string, contenido: Buffer, extra: Record<string, unknown> = {}) {
  return recibirDocumento({
    inquilinoId: INQUILINO,
    datos: {
      origen: 'API',
      nombreArchivo: nombre,
      tipoMime: 'application/pdf',
      contenidoBase64: contenido.toString('base64'),
      referenciaExterna: null,
      plantilla: 'REMITO',
      ...extra,
    },
  }, dependenciasRecepcion);
}

describe('pipeline documental de punta a punta', () => {
  beforeAll(async () => {
    await usarBaseDePruebas();
    exigirBaseDePruebas();
    await migrar();
    await conexion().query('TRUNCATE inquilino CASCADE');
    await conexion().query(
      'INSERT INTO inquilino (id, nombre) VALUES ($1, $2), ($3, $4)',
      [INQUILINO, 'Demo Logistics', OTRO_INQUILINO, 'Otro'],
    );
    await conexion().query(
      `INSERT INTO plantilla_documental
         (inquilino_id, codigo, nombre, version, estado, umbral_auto_aprobacion, politica_fisica, definicion, publicado_en)
       VALUES ($1, 'REMITO', 'Remito conformado', 1, 'PUBLICADA', 0.92, 'REQUERIDO', $2, now())`,
      [INQUILINO, JSON.stringify(REMITO)],
    );
  });

  beforeEach(async () => {
    limpiarGuiones();
    encolados.length = 0;
    catalogo = [{ tipo: 'PEDIDO', id: 'ped-1', nroPedido: '80264630', etiqueta: 'Pedido 80264630' }];
    await conexion().query('DELETE FROM documento WHERE inquilino_id = $1', [INQUILINO]);
    await conexion().query('DELETE FROM evento_salida WHERE inquilino_id = $1', [INQUILINO]);
  });

  afterAll(async () => {
    await conexion().query('TRUNCATE inquilino CASCADE');
    await cerrar();
  });

  it('un remito limpio recorre todo y termina aprobado con instantanea', async () => {
    const contenido = pdf('feliz');
    registrarGuion(huella(contenido), {
      clasificacion: { tipo: 'REMITO', confianza: 0.97 },
      campos: CAMPOS_COMPLETOS,
    });

    const carga = await cargar('remito.pdf', contenido);
    expect(carga.aceptado).toBe(true);
    expect(encolados).toHaveLength(1);

    const resultado = await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    expect(resultado.estado).toBe('APROBADO');
    expect(resultado.instantaneaId).not.toBeNull();
    expect(resultado.excepcionId).toBeNull();
    expect(resultado.confianza).toBeGreaterThan(0.92);
  });

  it('la instantanea queda sellada e inmutable', async () => {
    const contenido = pdf('sello');
    registrarGuion(huella(contenido), {
      clasificacion: { tipo: 'REMITO', confianza: 0.97 },
      campos: CAMPOS_COMPLETOS,
    });
    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const { rows } = await conexion().query<{ sello: string }>(
      'SELECT sello FROM instantanea_aprobacion WHERE documento_id = $1',
      [carga.documentoId],
    );
    expect(rows[0]?.sello).toMatch(/^[a-f0-9]{64}$/);

    await expect(conexion().query(
      `INSERT INTO instantanea_aprobacion (inquilino_id, documento_id, documento_version, sello, contenido)
       VALUES ($1, $2, 1, 'otro', '{}'::jsonb)`,
      [INQUILINO, carga.documentoId],
    )).rejects.toThrow();
  });

  it('el mismo archivo dos veces no crea dos documentos', async () => {
    const contenido = pdf('repetido');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const primera = await cargar('remito.pdf', contenido);
    const segunda = await cargar('otro-nombre.pdf', contenido);

    expect(primera.aceptado).toBe(true);
    expect(segunda.aceptado).toBe(false);
    expect(segunda.motivo).toBe('DUPLICADO');
    expect(segunda.duplicadoDe).toBe(primera.documentoId);
  });

  it('la clave de idempotencia devuelve el mismo documento sin duplicar', async () => {
    const contenido = pdf('idem');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const pedido = {
      inquilinoId: INQUILINO,
      claveIdempotencia: 'abc-123',
      datos: {
        origen: 'API' as const,
        nombreArchivo: 'remito.pdf',
        tipoMime: 'application/pdf',
        contenidoBase64: contenido.toString('base64'),
        referenciaExterna: null,
        plantilla: 'REMITO',
      },
    };

    const primera = await recibirDocumento(pedido, dependenciasRecepcion);
    const segunda = await recibirDocumento(pedido, dependenciasRecepcion);

    expect(segunda.aceptado).toBe(true);
    expect(segunda.documentoId).toBe(primera.documentoId);
    expect(encolados).toHaveLength(1);
  });

  it('un archivo que miente sobre su tipo no entra al pipeline', async () => {
    const zip = Buffer.concat([Buffer.from('PK'), Buffer.alloc(2048)]);
    const carga = await cargar('inocente.pdf', zip);

    expect(carga.aceptado).toBe(false);
    expect(carga.motivo).toBe('ARCHIVO_RECHAZADO');
    expect(carga.documentoId).toBeNull();
    expect(almacenamiento.cantidad).toBeGreaterThanOrEqual(0);
    expect(encolados).toHaveLength(0);
  });

  it('la confianza baja lo manda a observado con excepcion explicada', async () => {
    const contenido = pdf('dudoso');
    registrarGuion(huella(contenido), {
      clasificacion: { tipo: 'REMITO', confianza: 0.9 },
      campos: {
        ...CAMPOS_COMPLETOS,
        cuitEmisor: { valor: '20-12345678-6', confianza: 0.5 },
        conformado: { valor: true, confianza: 0.4 },
      },
    });

    const carga = await cargar('remito.pdf', contenido);
    const resultado = await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    expect(resultado.estado).toBe('OBSERVADO');
    expect(resultado.excepcionId).not.toBeNull();

    const { rows } = await conexion().query<{ accion_sugerida: string; vence_en: Date }>(
      'SELECT accion_sugerida, vence_en FROM excepcion WHERE documento_id = $1',
      [carga.documentoId],
    );
    expect(rows[0]?.accion_sugerida).toBeTruthy();
    expect(rows[0]?.vence_en).toBeInstanceOf(Date);
  });

  it('dos candidatos parecidos no se resuelven solos', async () => {
    const contenido = pdf('ambiguo');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });
    catalogo = [
      { tipo: 'PEDIDO', id: 'ped-1', nroPedido: '80264630' },
      { tipo: 'PEDIDO', id: 'ped-2', nroPedido: '80264630' },
    ];

    const carga = await cargar('remito.pdf', contenido);
    const resultado = await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    expect(resultado.estado).toBe('OBSERVADO');

    const { rows } = await conexion().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM candidato_emparejamiento
       WHERE documento_id = $1 AND estado = 'PROPUESTO'`,
      [carga.documentoId],
    );
    expect(Number(rows[0]?.total)).toBe(2);
  });

  it('si el proveedor de IA se cae el documento no se pierde', async () => {
    const contenido = pdf('caido');
    registrarGuion(huella(contenido), { falla: 'PROVEEDOR_CAIDO' });

    const carga = await cargar('remito.pdf', contenido);
    const resultado = await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    expect(resultado.estado).toBe('OBSERVADO');
    expect(resultado.motivo).toBe('PROVEEDOR_CAIDO');

    const { rows } = await conexion().query<{ estado: string }>(
      'SELECT estado FROM documento WHERE id = $1',
      [carga.documentoId],
    );
    expect(rows[0]?.estado).toBe('OBSERVADO');
    await expect(almacenamiento.leer(`${INQUILINO}/${carga.documentoId}/original.pdf`)).resolves.toBeInstanceOf(Buffer);
  });

  it('una caida pasajera del proveedor pide reintento en vez de dar el documento por perdido', async () => {
    const contenido = pdf('pasajera');
    registrarGuion(huella(contenido), { falla: 'PROVEEDOR_CAIDO' });

    const carga = await cargar('remito.pdf', contenido);

    await expect(
      procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso, {
        intento: 1,
        intentosMaximos: 6,
      }),
    ).rejects.toBeInstanceOf(FallaTransitoria);

    const { rows } = await conexion().query<{ estado: string }>(
      'SELECT estado FROM documento WHERE id = $1',
      [carga.documentoId],
    );
    expect(rows[0]?.estado).toBe('PROCESANDO');
  });

  it('agotados los reintentos la caida pasajera si queda observada', async () => {
    const contenido = pdf('agotada');
    registrarGuion(huella(contenido), { falla: 'PROVEEDOR_CAIDO' });

    const carga = await cargar('remito.pdf', contenido);
    const correlacion = randomUUID();

    await expect(
      procesarDocumento(carga.documentoId as string, correlacion, dependenciasProceso, {
        intento: 1,
        intentosMaximos: 2,
      }),
    ).rejects.toBeInstanceOf(FallaTransitoria);

    const resultado = await procesarDocumento(carga.documentoId as string, correlacion, dependenciasProceso, {
      intento: 2,
      intentosMaximos: 2,
    });

    expect(resultado.estado).toBe('OBSERVADO');
    expect(resultado.motivo).toBe('PROVEEDOR_CAIDO');

    const { rows } = await conexion().query<{ accion: string }>(
      `SELECT accion FROM evento_auditoria
        WHERE agregado_id = $1 AND accion = 'REINTENTO_PROCESAMIENTO'`,
      [carga.documentoId],
    );
    expect(rows).toHaveLength(1);
  });

  it('un error permanente del proveedor no gasta reintentos', async () => {
    const contenido = pdf('ilegible');
    registrarGuion(huella(contenido), { falla: 'SALIDA_ILEGIBLE' });

    const carga = await cargar('remito.pdf', contenido);
    const resultado = await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso, {
      intento: 1,
      intentosMaximos: 6,
    });

    expect(resultado.estado).toBe('OBSERVADO');
    expect(resultado.motivo).toBe('SALIDA_NO_PARSEABLE');
  });

  it('cada paso deja auditoria con correlacion', async () => {
    const contenido = pdf('auditado');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const { rows } = await conexion().query<{ accion: string }>(
      `SELECT accion FROM evento_auditoria
       WHERE agregado_id = $1 ORDER BY creado_en ASC`,
      [carga.documentoId],
    );
    const acciones = rows.map((r) => r.accion);
    expect(acciones).toContain('RECIBIDO');
    expect(acciones).toContain('ESTADO_PROCESANDO');
    expect(acciones).toContain('ESTADO_EXTRAIDO');
    expect(acciones).toContain('ESTADO_VALIDADO');
    expect(acciones).toContain('ESTADO_APROBADO');
  });

  it('el estado, la auditoria y el evento salen en la misma transaccion', async () => {
    const contenido = pdf('transaccional');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const eventos = await conexion().query<{ tipo_evento: string }>(
      'SELECT tipo_evento FROM evento_salida WHERE agregado_id = $1 ORDER BY creado_en',
      [carga.documentoId],
    );
    const tipos = eventos.rows.map((r) => r.tipo_evento);
    expect(tipos).toContain('documento.recibido');
    expect(tipos).toContain('documento.aprobado');
  });

  it('el remito exige seguimiento del original fisico', async () => {
    const contenido = pdf('fisico');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const { rows } = await conexion().query<{ requerido: boolean; estado: string }>(
      'SELECT requerido, estado FROM documento_fisico WHERE documento_id = $1',
      [carga.documentoId],
    );
    expect(rows[0]?.requerido).toBe(true);
    expect(rows[0]?.estado).toBe('REQUERIDO');
  });

  it('la evidencia queda guardada campo por campo', async () => {
    const contenido = pdf('evidencia');
    registrarGuion(huella(contenido), { campos: CAMPOS_COMPLETOS });

    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const { rows } = await conexion().query<{ clave: string; pagina: number; texto_fuente: string }>(
      `SELECT v.clave, v.pagina, v.texto_fuente
       FROM valor_extraido v
       JOIN corrida_extraccion c ON c.id = v.corrida_id
       WHERE c.documento_id = $1 AND v.pagina IS NOT NULL`,
      [carga.documentoId],
    );
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]?.texto_fuente).toBeTruthy();
  });

  it('un campo sin evidencia queda topeado y se nota en la base', async () => {
    const contenido = pdf('sin-evidencia');
    registrarGuion(huella(contenido), {
      campos: {
        ...CAMPOS_COMPLETOS,
        numero: { valor: '0004-00008932', confianza: 0.99, conEvidencia: false },
      },
    });

    const carga = await cargar('remito.pdf', contenido);
    await procesarDocumento(carga.documentoId as string, randomUUID(), dependenciasProceso);

    const { rows } = await conexion().query<{ confianza: string }>(
      `SELECT v.confianza FROM valor_extraido v
       JOIN corrida_extraccion c ON c.id = v.corrida_id
       WHERE c.documento_id = $1 AND v.clave = 'numero'`,
      [carga.documentoId],
    );
    expect(Number(rows[0]?.confianza)).toBeLessThanOrEqual(0.7);
  });
});

describe('entrega de eventos', () => {
  it('el backoff crece con cada intento', () => {
    expect(esperaDeReintento(3)).toBeGreaterThan(esperaDeReintento(1));
  });

  it('los 5xx se reintentan y los 4xx no', () => {
    expect(esReintentable(500)).toBe(true);
    expect(esReintentable(429)).toBe(true);
    expect(esReintentable(0)).toBe(true);
    expect(esReintentable(400)).toBe(false);
    expect(esReintentable(404)).toBe(false);
  });

  it('la firma cambia si cambia el cuerpo', () => {
    const a = firmar('secreto', '100', '{"a":1}');
    const b = firmar('secreto', '100', '{"a":2}');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('constatacion fiscal contra arca', () => {
  const facturaBase = {
    numero: { valorNormalizado: '0001-00001234', valorLeido: 'A 0001-00001234', confianza: 0.97 },
    tipoComprobante: { valorNormalizado: 'Factura A', valorLeido: 'Factura A', confianza: 0.96 },
    fechaEmision: { valorNormalizado: '2026-03-17', valorLeido: '17/03/2026', confianza: 0.95 },
    cuitEmisor: { valorNormalizado: '30-71234567-8', valorLeido: '30-71234567-8', confianza: 0.98 },
    total: { valorNormalizado: 68830000, valorLeido: '68.830.000,00', confianza: 0.97 },
    cae: { valorNormalizado: '75123456789012', valorLeido: '75123456789012', confianza: 0.96 },
  } as unknown as Record<string, ValorExtraido>;

  it('no toca arca si la plantilla no lo pide', async () => {
    const salida = await verificarContraArca(REMITO, facturaBase);
    expect(salida.intentada).toBe(false);
    expect(salida.hallazgos).toHaveLength(0);
  });

  it('avisa que no pudo verificar cuando no hay credenciales', async () => {
    const salida = await verificarContraArca(FACTURA, facturaBase);
    expect(salida.intentada).toBe(false);
    expect(salida.hallazgos[0]?.codigo).toBe('CAE_NO_VERIFICABLE');
    expect(salida.hallazgos[0]?.severidad).toBe('advertencia');
  });

  it('con credenciales pero sin cae no llama a arca y explica por que', async () => {
    process.env['ARCA_CUIT'] = '20123456786';
    process.env['ARCA_CERTIFICADO'] = 'certificado-de-prueba';
    process.env['ARCA_CLAVE_PRIVADA'] = 'clave-de-prueba';

    try {
      const sinCae = { ...facturaBase, cae: { valorNormalizado: null, valorLeido: null, confianza: 0 } };
      const salida = await verificarContraArca(FACTURA, sinCae as Record<string, ValorExtraido>);
      expect(salida.motivoSinVerificar).toMatch(/CAE/);
      expect(salida.hallazgos[0]?.campos).toContain('cae');
    } finally {
      delete process.env['ARCA_CUIT'];
      delete process.env['ARCA_CERTIFICADO'];
      delete process.env['ARCA_CLAVE_PRIVADA'];
    }
  });

  it('con credenciales pero con numero ilegible tampoco llama a arca', async () => {
    process.env['ARCA_CUIT'] = '20123456786';
    process.env['ARCA_CERTIFICADO'] = 'certificado-de-prueba';
    process.env['ARCA_CLAVE_PRIVADA'] = 'clave-de-prueba';

    try {
      const roto = { ...facturaBase, numero: { valorNormalizado: 'ilegible', valorLeido: 'ilegible', confianza: 0.2 } };
      const salida = await verificarContraArca(FACTURA, roto as Record<string, ValorExtraido>);
      expect(salida.motivoSinVerificar).toMatch(/punto de venta/);
    } finally {
      delete process.env['ARCA_CUIT'];
      delete process.env['ARCA_CERTIFICADO'];
      delete process.env['ARCA_CLAVE_PRIVADA'];
    }
  });

  it('un comprobante aprobado no deja hallazgos', () => {
    expect(hallazgosDeConstatacion({
      resultado: 'A', observaciones: [], errores: [], fechaProceso: null,
    })).toHaveLength(0);
  });

  it('un rechazo de arca es critico y bloquea la aprobacion', () => {
    const hallazgos = hallazgosDeConstatacion({
      resultado: 'R',
      observaciones: [],
      errores: [{ codigo: 601, mensaje: 'CAE inexistente' }],
      fechaProceso: null,
    });

    expect(hallazgos[0]?.codigo).toBe('CAE_RECHAZADO');
    expect(hallazgos[0]?.severidad).toBe('critico');
    expect(hallazgos[0]?.mensaje).toContain('CAE inexistente');
  });

  it('una observacion de arca es error y explica el motivo', () => {
    const hallazgos = hallazgosDeConstatacion({
      resultado: 'O',
      observaciones: [{ codigo: 102, mensaje: 'El importe total no coincide' }],
      errores: [],
      fechaProceso: null,
    });

    expect(hallazgos[0]?.codigo).toBe('CAE_OBSERVADO');
    expect(hallazgos[0]?.severidad).toBe('error');
    expect(hallazgos[0]?.mensaje).toContain('importe total');
  });
});

describe('aprender de las correcciones humanas', () => {
  const emisor = '30712345678';

  beforeAll(async () => {
    await usarBaseDePruebas();
    exigirBaseDePruebas();
    await migrar();
    await conexion().query(
      `INSERT INTO inquilino (id, nombre) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [INQUILINO, 'Demo Logistics'],
    );
  });

  afterAll(async () => {
    await conexion().query('TRUNCATE inquilino CASCADE');
    await cerrar();
  });

  beforeEach(async () => {
    await conexion().query('DELETE FROM correccion_aprendida WHERE inquilino_id = $1', [INQUILINO]);
  });

  const leido = (valorLeido: string, valorNormalizado: unknown): ValorExtraido =>
    ({ valorLeido, valorNormalizado, confianza: 0.8, evidencia: null }) as unknown as ValorExtraido;

  it('la clave del emisor sale del cuit y si no de la razon social', () => {
    expect(claveDeEmisor({ cuitEmisor: leido('30-71234567-8', '30-71234567-8') })).toBe(emisor);
    expect(claveDeEmisor({ razonSocialEmisor: leido('Bodega San Martin', 'Bodega San Martin') }))
      .toBe('BODEGASANMARTIN');
    expect(claveDeEmisor({})).toBe(EMISOR_GENERICO);
  });

  it('no repite una correccion vista una sola vez', () => {
    const salida = aplicarCorrecciones(
      { razonSocialEmisor: leido('BODEGA SAN MARTN SA', 'BODEGA SAN MARTN SA') },
      [{ claveCampo: 'razonSocialEmisor', valorLeido: 'BODEGA SAN MARTN SA', valorCorregido: 'BODEGA SAN MARTIN SA', veces: 1 }],
    );
    expect(salida.aplicadas).toBe(0);
  });

  it('aplica la correccion cuando ya se repitio y lo deja anotado', () => {
    const salida = aplicarCorrecciones(
      { razonSocialEmisor: leido('BODEGA SAN MARTN SA', 'BODEGA SAN MARTN SA') },
      [{ claveCampo: 'razonSocialEmisor', valorLeido: 'BODEGA SAN MARTN SA', valorCorregido: 'BODEGA SAN MARTIN SA', veces: 3 }],
    );

    expect(salida.aplicadas).toBe(1);
    expect(salida.valores['razonSocialEmisor']?.valorNormalizado).toBe('BODEGA SAN MARTIN SA');
    expect(salida.hallazgos[0]?.codigo).toBe('CORREGIDO_POR_APRENDIZAJE');
    expect(salida.hallazgos[0]?.severidad).toBe('info');
  });

  it('no toca el campo si esta vez el documento dice otra cosa', () => {
    const salida = aplicarCorrecciones(
      { razonSocialEmisor: leido('OTRA BODEGA SRL', 'OTRA BODEGA SRL') },
      [{ claveCampo: 'razonSocialEmisor', valorLeido: 'BODEGA SAN MARTN SA', valorCorregido: 'BODEGA SAN MARTIN SA', veces: 5 }],
    );
    expect(salida.aplicadas).toBe(0);
    expect(salida.valores['razonSocialEmisor']?.valorNormalizado).toBe('OTRA BODEGA SRL');
  });

  it('guarda la correccion y la cuenta cuando se repite', async () => {
    await enTransaccion(async (cliente) => {
      for (const vez of [1, 2, 3]) {
        await registrarCorreccion(cliente, {
          inquilinoId: INQUILINO,
          plantillaCodigo: 'FACTURA',
          emisorClave: emisor,
          claveCampo: 'razonSocialEmisor',
          valorLeido: 'BODEGA SAN MARTN SA',
          valorCorregido: `BODEGA SAN MARTIN SA ${vez > 1 ? '' : ''}`.trim(),
          documentoId: null as unknown as string,
        });
      }
    });

    const guardadas = await correccionesDe(INQUILINO, 'FACTURA', emisor);
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]?.veces).toBe(3);
  });

  it('no aprende nada si el humano confirma el mismo valor', async () => {
    await enTransaccion(async (cliente) => {
      await registrarCorreccion(cliente, {
        inquilinoId: INQUILINO,
        plantillaCodigo: 'FACTURA',
        emisorClave: emisor,
        claveCampo: 'total',
        valorLeido: '68830000',
        valorCorregido: '68830000',
        documentoId: null as unknown as string,
      });
    });

    expect(await correccionesDe(INQUILINO, 'FACTURA', emisor)).toHaveLength(0);
  });

  it('las pistas del prompt solo mencionan campos de la plantilla', () => {
    const pistas = pistasDeExtraccion(FACTURA, [
      { claveCampo: 'razonSocialEmisor', valorLeido: 'BODEGA SAN MARTN SA', valorCorregido: 'BODEGA SAN MARTIN SA', veces: 4 },
      { claveCampo: 'campoQueNoExiste', valorLeido: 'x', valorCorregido: 'y', veces: 9 },
    ]);

    expect(pistas).toHaveLength(1);
    expect(pistas[0]).toContain('razonSocialEmisor');
    expect(pistas[0]).toContain('BODEGA SAN MARTIN SA');
  });
});

describe('traer objetos desde follow', () => {
  it('traduce un chofer de follow a los nombres que usa la plantilla', () => {
    const objeto = choferComoObjeto({
      id: 'chf-1',
      nombre: 'Juan Gabriel',
      apellido: 'Benitez',
      documento: '36963003',
      legajo: 'L-44',
      estado: 'ACTIVO',
    });

    expect(objeto.tipo).toBe('CHOFER');
    expect(objeto['numeroDocumento']).toBe('36963003');
    expect(objeto.etiqueta).toBe('Benitez, Juan Gabriel');
    expect(objeto['origen']).toBe('follow');
  });

  it('follow llama dominio a lo que la plantilla llama patente', () => {
    const objeto = vehiculoComoObjeto({
      id: 'veh-1',
      dominio: 'ab 123 cd',
      modelo: 'Actros',
      marca: { nombre: 'Mercedes' },
    });

    expect(objeto.tipo).toBe('VEHICULO');
    expect(objeto['patente']).toBe('AB123CD');
    expect(objeto.etiqueta).toContain('Mercedes Actros');
  });

  it('un chofer de follow empareja con un dni por numero de documento', () => {
    const chofer = choferComoObjeto({ id: 'chf-1', apellido: 'Benitez', documento: '36963003' });

    const salida = emparejar(
      DNI,
      {
        numeroDocumento: {
          valorLeido: '36.963.003',
          valorNormalizado: '36963003',
          confianza: 0.99,
          evidencia: null,
        },
      } as unknown as Record<string, ValorExtraido>,
      [chofer],
    );

    expect(salida.resolucion).toBe('CONFIRMADO_AUTOMATICO');
    expect(salida.sujeto?.id).toBe('chf-1');
  });

  it('una vtv empareja con el vehiculo por patente', () => {
    const vehiculo = vehiculoComoObjeto({ id: 'veh-1', dominio: 'AB123CD' });

    const salida = emparejar(
      VTV,
      {
        patente: {
          valorLeido: 'AB 123 CD',
          valorNormalizado: 'AB123CD',
          confianza: 0.97,
          evidencia: null,
        },
      } as unknown as Record<string, ValorExtraido>,
      [vehiculo],
    );

    expect(salida.resolucion).toBe('CONFIRMADO_AUTOMATICO');
    expect(salida.sujeto?.id).toBe('veh-1');
  });

  it('sin follow configurado no busca nada y no rompe', async () => {
    delete process.env['FOLLOW_URL'];
    delete process.env['FOLLOW_TOKEN'];
    expect(await buscarObjetosEnFollow({ numeroDocumento: '36963003' })).toHaveLength(0);
  });

  it('no le pregunta a follow si no hay ningun termino util', async () => {
    process.env['FOLLOW_URL'] = 'http://localhost:8080';
    process.env['FOLLOW_TOKEN'] = 'token-de-prueba';

    try {
      expect(await buscarObjetosEnFollow({ razonSocialEmisor: 'Bodega' })).toHaveLength(0);
      expect(await buscarObjetosEnFollow({ numeroDocumento: '12' })).toHaveLength(0);
    } finally {
      delete process.env['FOLLOW_URL'];
      delete process.env['FOLLOW_TOKEN'];
    }
  });
});

describe('a quien le toca cada documento', () => {
  const base = { id: 'd1', nombre: 'Deposito', correo: 'd@e.test' };

  it('sin filtros recibe todo lo que este en sus situaciones', () => {
    const destinatario = { ...base, familias: [], plantillas: [], situaciones: ['APROBADO'] };
    expect(leCorresponde(destinatario, { familia: 'LOGISTICO', plantilla: 'REMITO', situacion: 'APROBADO' })).toBe(true);
    expect(leCorresponde(destinatario, { familia: 'FISCAL', plantilla: 'FACTURA', situacion: 'APROBADO' })).toBe(true);
  });

  it('la situacion manda por encima de todo', () => {
    const destinatario = { ...base, familias: [], plantillas: [], situaciones: ['APROBADO'] };
    expect(leCorresponde(destinatario, { familia: 'LOGISTICO', plantilla: 'REMITO', situacion: 'OBSERVADO' })).toBe(false);
  });

  it('filtra por familia', () => {
    const destinatario = { ...base, familias: ['LOGISTICO'], plantillas: [], situaciones: ['APROBADO'] };
    expect(leCorresponde(destinatario, { familia: 'LOGISTICO', plantilla: 'REMITO', situacion: 'APROBADO' })).toBe(true);
    expect(leCorresponde(destinatario, { familia: 'FISCAL', plantilla: 'FACTURA', situacion: 'APROBADO' })).toBe(false);
  });

  it('filtra por plantilla puntual', () => {
    const destinatario = { ...base, familias: [], plantillas: ['VTV'], situaciones: ['VENCIDO'] };
    expect(leCorresponde(destinatario, { familia: 'VEHICULAR', plantilla: 'VTV', situacion: 'VENCIDO' })).toBe(true);
    expect(leCorresponde(destinatario, { familia: 'VEHICULAR', plantilla: 'SEGURO_VEHICULAR', situacion: 'VENCIDO' })).toBe(false);
  });

  it('con familia y plantilla juntas alcanza con cumplir una', () => {
    const destinatario = { ...base, familias: ['LOGISTICO'], plantillas: ['FACTURA'], situaciones: ['APROBADO'] };
    expect(leCorresponde(destinatario, { familia: 'LOGISTICO', plantilla: 'REMITO', situacion: 'APROBADO' })).toBe(true);
    expect(leCorresponde(destinatario, { familia: 'FISCAL', plantilla: 'FACTURA', situacion: 'APROBADO' })).toBe(true);
    expect(leCorresponde(destinatario, { familia: 'IDENTIDAD', plantilla: 'DNI', situacion: 'APROBADO' })).toBe(false);
  });

  it('un documento sin clasificar no cuela por filtro de familia', () => {
    const destinatario = { ...base, familias: ['LOGISTICO'], plantillas: [], situaciones: ['OBSERVADO'] };
    expect(leCorresponde(destinatario, { familia: null, plantilla: null, situacion: 'OBSERVADO' })).toBe(false);
  });
});

describe('plantilla del correo', () => {
  const contenido = {
    titulo: 'Documento aprobado',
    bajada: 'Se leyo y quedo listo.',
    documento: 'remito.pdf',
    tipo: 'REMITO',
    estado: 'APROBADO',
    confianza: '98%',
    datos: [{ etiqueta: 'numero', valor: '0001-00000072' }],
    hallazgos: [{ codigo: 'FECHA_MUY_ANTIGUA', severidad: 'advertencia', mensaje: 'Tiene mas de 90 dias.' }],
    asociadoA: 'PEDIDO PED-100234',
    enlace: 'https://localhost:3000/carga/ia-docs',
    piePersonalizado: null,
  };

  it('el asunto identifica el documento', () => {
    expect(asuntoDeCorreo(contenido)).toBe('Documento aprobado - remito.pdf');
  });

  it('la version en texto plano trae todo lo importante', () => {
    const texto = textoDeCorreo(contenido);
    expect(texto).toContain('0001-00000072');
    expect(texto).toContain('PEDIDO PED-100234');
    expect(texto).toContain('Tiene mas de 90 dias');
  });

  it('el html no rompe con datos que traen simbolos', () => {
    const html = htmlDeCorreo({
      ...contenido,
      documento: 'remito <script>alert(1)</script>.pdf',
      datos: [{ etiqueta: 'razon', valor: 'Bodega & Hijos "SA"' }],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Bodega &amp; Hijos');
  });

  it('sin hallazgos no dibuja el bloque de revisar', () => {
    expect(htmlDeCorreo({ ...contenido, hallazgos: [] })).not.toContain('Para revisar');
  });

  it('sin enlace no dibuja el boton', () => {
    expect(htmlDeCorreo({ ...contenido, enlace: null })).not.toContain('Ver el documento');
  });
});

describe('segmentacion de lotes multipagina', () => {
  const PDF_3_PAGINAS = Buffer.from(
    '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',
    'base64',
  );

  const encoladosDivision: { nombre: string; clave: string; datos: Record<string, unknown> }[] = [];

  const motorConSegmentos = (segmentos: { desde: number; hasta: number; tipo: string | null }[]) => ({
    clasificar: motor.clasificar.bind(motor),
    extraer: motor.extraer.bind(motor),
    segmentar: async () => ({ segmentos }),
  });

  const motorQueFalla = () => ({
    clasificar: motor.clasificar.bind(motor),
    extraer: motor.extraer.bind(motor),
    segmentar: async () => {
      throw new Error('El motor de segmentacion no respondio.');
    },
  });

  const dependenciasConDivision = (motorDivision: unknown) => ({
    almacenamiento,
    motor: motorDivision as typeof motor,
    buscarObjetos: async () => catalogo,
    encolar: async (nombre: string, clave: string, datos: Record<string, unknown>) => {
      encoladosDivision.push({ nombre, clave, datos });
    },
  });

  beforeAll(async () => {
    await usarBaseDePruebas();
    exigirBaseDePruebas();
    await migrar();
    await conexion().query(
      `INSERT INTO inquilino (id, nombre) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [INQUILINO, 'Demo Logistics'],
    );
  });

  afterAll(async () => {
    await conexion().query('TRUNCATE inquilino CASCADE');
    await cerrar();
  });

  beforeEach(async () => {
    limpiarGuiones();
    encolados.length = 0;
    encoladosDivision.length = 0;
    catalogo = [];
    await conexion().query('DELETE FROM documento WHERE inquilino_id = $1', [INQUILINO]);
    await conexion().query('DELETE FROM evento_salida WHERE inquilino_id = $1', [INQUILINO]);
  });

  it('un lote de 3 paginas se divide en hijos y el padre queda DIVIDIDO', async () => {
    const carga = await cargar('lote-remitos.pdf', PDF_3_PAGINAS, { plantilla: null });
    expect(carga.aceptado).toBe(true);

    const resultado = await procesarDocumento(
      carga.documentoId as string,
      randomUUID(),
      dependenciasConDivision(motorConSegmentos([
        { desde: 1, hasta: 1, tipo: 'REMITO' },
        { desde: 2, hasta: 2, tipo: 'REMITO' },
        { desde: 3, hasta: 3, tipo: 'REMITO' },
      ])),
    );

    expect(resultado.estado).toBe('DIVIDIDO');
    expect(encoladosDivision).toHaveLength(3);

    const { rows: hijos } = await conexion().query<{ estado: string; documento_padre_id: string }>(
      'SELECT estado, documento_padre_id FROM documento WHERE documento_padre_id = $1 ORDER BY pagina_desde',
      [carga.documentoId],
    );
    expect(hijos).toHaveLength(3);
    expect(hijos.every((h) => h.estado === 'RECIBIDO')).toBe(true);
  });

  it('reprocesar el padre no duplica los hijos', async () => {
    const carga = await cargar('lote-remitos.pdf', PDF_3_PAGINAS, { plantilla: null });
    const deps = dependenciasConDivision(motorConSegmentos([
      { desde: 1, hasta: 1, tipo: 'REMITO' },
      { desde: 2, hasta: 2, tipo: 'REMITO' },
      { desde: 3, hasta: 3, tipo: 'REMITO' },
    ]));

    await procesarDocumento(carga.documentoId as string, randomUUID(), deps);
    encoladosDivision.length = 0;

    const { rows: antes } = await conexion().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM documento WHERE documento_padre_id = $1',
      [carga.documentoId],
    );

    await conexion().query("UPDATE documento SET estado = 'PROCESANDO' WHERE id = $1", [carga.documentoId]);
    await procesarDocumento(carga.documentoId as string, randomUUID(), deps);

    const { rows: despues } = await conexion().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM documento WHERE documento_padre_id = $1',
      [carga.documentoId],
    );

    expect(despues[0]?.total).toBe(antes[0]?.total);
    expect(encoladosDivision).toHaveLength(0);
  });

  it('un segmento con huella ya registrada no crea otro documento', async () => {
    const { extraerPaginas } = await import('@nextdocs/adaptadores');
    const segmentoRepetido = await extraerPaginas(PDF_3_PAGINAS, 1, 1);
    const huellaRepetida = createHash('sha256').update(segmentoRepetido).digest('hex');

    const idExistente = randomUUID();
    await conexion().query(
      `INSERT INTO documento
         (id, inquilino_id, origen, huella, tipo_mime, nombre_archivo, estado)
       VALUES ($1, $2, 'API', $3, 'application/pdf', 'segmento-viejo.pdf', 'APROBADO')`,
      [idExistente, INQUILINO, huellaRepetida],
    );

    const carga = await cargar('lote-remitos.pdf', PDF_3_PAGINAS, { plantilla: null });
    const resultado = await procesarDocumento(
      carga.documentoId as string,
      randomUUID(),
      dependenciasConDivision(motorConSegmentos([
        { desde: 1, hasta: 1, tipo: 'REMITO' },
        { desde: 2, hasta: 2, tipo: 'REMITO' },
        { desde: 3, hasta: 3, tipo: 'REMITO' },
      ])),
    );

    expect(resultado.estado).toBe('DIVIDIDO');
    expect(encoladosDivision).toHaveLength(2);

    const { rows: hijos } = await conexion().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM documento WHERE documento_padre_id = $1',
      [carga.documentoId],
    );
    expect(Number(hijos[0]?.total)).toBe(2);
  });

  it('si el motor de segmentacion falla el padre queda OBSERVADO y no se divide por pagina', async () => {
    const carga = await cargar('lote-remitos.pdf', PDF_3_PAGINAS, { plantilla: null });

    const resultado = await procesarDocumento(
      carga.documentoId as string,
      randomUUID(),
      dependenciasConDivision(motorQueFalla()),
    );

    expect(resultado.estado).toBe('OBSERVADO');

    const { rows: hijos } = await conexion().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM documento WHERE documento_padre_id = $1',
      [carga.documentoId],
    );
    expect(Number(hijos[0]?.total)).toBe(0);
  });

  it('rechazar el padre dividido rechaza los hijos pendientes', async () => {
    const { revisarDocumento } = await import('./revision.js');
    const carga = await cargar('lote-remitos.pdf', PDF_3_PAGINAS, { plantilla: null });
    await procesarDocumento(
      carga.documentoId as string,
      randomUUID(),
      dependenciasConDivision(motorConSegmentos([
        { desde: 1, hasta: 1, tipo: 'REMITO' },
        { desde: 2, hasta: 3, tipo: 'REMITO' },
      ])),
    );

    const resultado = await revisarDocumento({
      inquilinoId: INQUILINO,
      documentoId: carga.documentoId as string,
      decision: 'RECHAZAR',
      motivo: 'lote cargado por error',
    });

    expect(resultado.estado).toBe('RECHAZADO');

    const { rows: pendientes } = await conexion().query<{ total: string }>(
      `SELECT count(*)::text AS total FROM documento
        WHERE documento_padre_id = $1 AND estado <> 'RECHAZADO'`,
      [carga.documentoId],
    );
    expect(Number(pendientes[0]?.total)).toBe(0);
  });
});
