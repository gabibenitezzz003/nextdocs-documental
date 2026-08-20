import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AlmacenamientoEnMemoria, MotorSimulado, limpiarGuiones, registrarGuion } from '@docvance/adaptadores';
import { cerrar, conexion, enTransaccion } from '@docvance/db';
import { exigirBaseDePruebas, migrar, usarBaseDePruebas } from '@docvance/db';
import { FACTURA, REMITO, type ObjetoNegocio, type ValorExtraido } from '@docvance/dominio';
import { createHash, randomUUID } from 'node:crypto';

import { FallaTransitoria, procesarDocumento } from './procesamiento.js';
import { hallazgosDeConstatacion, verificarContraArca } from './fiscal.js';
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
