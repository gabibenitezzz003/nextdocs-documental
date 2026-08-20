import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { Almacenamiento, MotorDocumental } from '@docvance/adaptadores';
import { ErrorMotorDocumental, esFallaTransitoria } from '@docvance/adaptadores';
import { conexion, enTransaccion } from '@docvance/db';
import {
  PLANTILLAS_BASE,
  decidir,
  emparejar,
  exigirTransicion,
  horasDeSla,
  plantillaDe,
  procesarCampos,
  severidadDeExcepcion,
  validar,
  type EstadoDocumento,
  type ObjetoNegocio,
  type Plantilla,
} from '@docvance/dominio';

import { SISTEMA, auditar, encolarEvento } from './auditoria.js';
import { verificarContraArca } from './fiscal.js';
import { segundaPasada } from './reintento.js';
import { dividirSiHaceFalta } from './segmentacion.js';
import {
  EMISOR_GENERICO,
  aplicarCorrecciones,
  claveDeEmisor,
  correccionesDe,
  pistasDeExtraccion,
} from './aprendizaje.js';

export const CONFIANZA_MINIMA_CLASIFICACION = 0.6;

export interface DependenciasProcesamiento {
  almacenamiento: Almacenamiento;
  motor: MotorDocumental;
  buscarObjetos: (inquilinoId: string, valores: Record<string, unknown>) => Promise<ObjetoNegocio[]>;
  encolar?: (nombre: string, clave: string, datos: Record<string, unknown>) => Promise<void>;
}

interface FilaDocumento {
  id: string;
  inquilino_id: string;
  estado: EstadoDocumento;
  tipo_mime: string;
  nombre_archivo: string;
  plantilla_codigo: string | null;
  clave_almacen: string;
  documento_padre_id: string | null;
}

export interface OpcionesProcesamiento {
  intento?: number;
  intentosMaximos?: number;
}

export class FallaTransitoria extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'FallaTransitoria';
    this.codigo = codigo;
  }
}

export interface ResultadoProcesamiento {
  documentoId: string;
  estado: EstadoDocumento;
  confianza: number | null;
  excepcionId: string | null;
  instantaneaId: string | null;
  motivo: string | null;
}

async function plantillaPublicada(inquilinoId: string, codigo: string): Promise<Plantilla | null> {
  const { rows } = await conexion().query<{ definicion: Plantilla }>(
    `SELECT definicion FROM plantilla_documental
     WHERE inquilino_id = $1 AND codigo = $2 AND estado = 'PUBLICADA'
     ORDER BY version DESC LIMIT 1`,
    [inquilinoId, codigo],
  );
  return rows[0]?.definicion ?? plantillaDe(codigo);
}

async function tiposDisponibles(inquilinoId: string): Promise<string[]> {
  const { rows } = await conexion().query<{ codigo: string }>(
    `SELECT DISTINCT codigo FROM plantilla_documental
      WHERE inquilino_id = $1 AND estado = 'PUBLICADA'`,
    [inquilinoId],
  );

  const publicados = rows.map((r) => r.codigo);
  return publicados.length ? publicados : Object.keys(PLANTILLAS_BASE);
}

async function observarPorFalla(
  documento: FilaDocumento,
  correlacionId: string,
  codigo: string,
  detalle: string,
): Promise<ResultadoProcesamiento> {
  const excepcionId = randomUUID();

  await enTransaccion(async (cliente) => {
    await cambiarEstado(cliente, documento, 'OBSERVADO', correlacionId, { codigo, detalle });

    await cliente.query(
      `INSERT INTO excepcion
         (id, inquilino_id, documento_id, codigo_motivo, severidad, prioridad, motivos,
          accion_sugerida, vence_en)
       VALUES ($1, $2, $3, $4, 'error', 'ALTA', $5, $6, now() + interval '4 hours')`,
      [
        excepcionId,
        documento.inquilino_id,
        documento.id,
        codigo,
        JSON.stringify([{ codigo, severidad: 'error', detalle }]),
        'Reprocesar el documento o cargar los datos a mano.',
      ],
    );

    await encolarEvento(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      tipoEvento: 'documento.observado',
      correlacionId,
      datos: { codigoMotivo: codigo, severidad: 'error', excepcionId },
    });
  });

  return {
    documentoId: documento.id,
    estado: 'OBSERVADO',
    confianza: null,
    excepcionId,
    instantaneaId: null,
    motivo: codigo,
  };
}

async function cambiarEstado(
  cliente: PoolClient,
  documento: FilaDocumento,
  nuevo: EstadoDocumento,
  correlacionId: string,
  metadatos?: Record<string, unknown>,
): Promise<void> {
  exigirTransicion(documento.estado, nuevo);

  await cliente.query(
    'UPDATE documento SET estado = $1, actualizado_en = now() WHERE id = $2',
    [nuevo, documento.id],
  );

  await auditar(cliente, {
    inquilinoId: documento.inquilino_id,
    tipoAgregado: 'documento',
    agregadoId: documento.id,
    accion: `ESTADO_${nuevo}`,
    actor: SISTEMA,
    origen: 'PIPELINE',
    correlacionId,
    antes: { estado: documento.estado },
    despues: { estado: nuevo },
    ...(metadatos ? { metadatos } : {}),
  });

  documento.estado = nuevo;
}

export async function procesarDocumento(
  documentoId: string,
  correlacionId: string,
  dependencias: DependenciasProcesamiento,
  opciones: OpcionesProcesamiento = {},
): Promise<ResultadoProcesamiento> {
  const intento = opciones.intento ?? 1;
  const intentosMaximos = opciones.intentosMaximos ?? 1;

  function quedanReintentos(codigo: string | undefined): boolean {
    return esFallaTransitoria(codigo) && intento < intentosMaximos;
  }

  const { rows } = await conexion().query<FilaDocumento>(
    `SELECT d.id, d.inquilino_id, d.estado, d.tipo_mime, d.nombre_archivo, d.plantilla_codigo,
            d.documento_padre_id, a.clave_almacen
     FROM documento d
     JOIN archivo_documento a ON a.documento_id = d.id AND a.version = 1
     WHERE d.id = $1`,
    [documentoId],
  );

  const documento = rows[0];
  if (!documento) throw new Error(`No existe el documento ${documentoId}.`);

  if (documento.estado === 'OBSERVADO') {
    await conexion().query(
      `UPDATE excepcion SET estado = 'DESCARTADA', resolucion = 'Reintento del documento.',
              resuelto_en = now()
        WHERE documento_id = $1 AND estado = 'ABIERTA'`,
      [documento.id],
    );
  }

  await enTransaccion(async (cliente) => {
    if (documento.estado === 'PROCESANDO') {
      await auditar(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: documento.id,
        accion: 'REINTENTO_PROCESAMIENTO',
        actor: SISTEMA,
        origen: 'PIPELINE',
        correlacionId,
        metadatos: { intento, intentosMaximos },
      });
      return;
    }
    await cambiarEstado(cliente, documento, 'PROCESANDO', correlacionId);
  });

  const contenido = await dependencias.almacenamiento.leer(documento.clave_almacen);
  const posibles = await tiposDisponibles(documento.inquilino_id);

  if (dependencias.encolar) {
    const division = await dividirSiHaceFalta(
      documento,
      contenido,
      correlacionId,
      {
        almacenamiento: dependencias.almacenamiento,
        motor: dependencias.motor,
        encolar: dependencias.encolar,
      },
      posibles,
    );

    if (division.dividido) {
      documento.estado = 'DIVIDIDO';
      return {
        documentoId: documento.id,
        estado: 'DIVIDIDO',
        confianza: null,
        excepcionId: null,
        instantaneaId: null,
        motivo: `Se dividio en ${division.hijos.length} documentos.`,
      };
    }
  }

  const iniciadoEn = new Date();

  let clasificacion;
  try {
    clasificacion = await dependencias.motor.clasificar({
      contenido,
      tipoMime: documento.tipo_mime,
      nombreArchivo: documento.nombre_archivo,
      plantillasPosibles: posibles,
    });
  } catch (error) {
    const e = error as ErrorMotorDocumental;
    if (quedanReintentos(e.codigo)) throw new FallaTransitoria(e.codigo, e.message);
    return observarPorFalla(documento, correlacionId, e.codigo ?? 'CLASIFICACION_FALLIDA', e.message);
  }

  const codigoPlantilla = plantillaDe(clasificacion.tipo)
    ? clasificacion.tipo
    : documento.plantilla_codigo;

  if (!codigoPlantilla) {
    return observarPorFalla(
      documento,
      correlacionId,
      'TIPO_NO_RECONOCIDO',
      `El documento no corresponde a ningun tipo conocido. El clasificador dijo ${clasificacion.tipo}${clasificacion.motivo ? `: ${clasificacion.motivo}` : '.'}`,
    );
  }

  if (clasificacion.confianza < CONFIANZA_MINIMA_CLASIFICACION && !documento.plantilla_codigo) {
    return observarPorFalla(
      documento,
      correlacionId,
      'TIPO_INCIERTO',
      `El clasificador propuso ${codigoPlantilla} con confianza ${clasificacion.confianza}, por debajo de ${CONFIANZA_MINIMA_CLASIFICACION}.`,
    );
  }

  const plantilla = await plantillaPublicada(documento.inquilino_id, codigoPlantilla);
  if (!plantilla) {
    return observarPorFalla(documento, correlacionId, 'PLANTILLA_NO_PUBLICADA',
      `No hay plantilla publicada para ${codigoPlantilla}.`);
  }

  const pistasGenerales = pistasDeExtraccion(
    plantilla,
    await correccionesDe(documento.inquilino_id, plantilla.codigo, EMISOR_GENERICO),
  );

  let extraccion;
  try {
    extraccion = await dependencias.motor.extraer({
      contenido,
      tipoMime: documento.tipo_mime,
      plantilla,
      pistas: pistasGenerales,
    });
  } catch (error) {
    const e = error as ErrorMotorDocumental;
    if (quedanReintentos(e.codigo)) throw new FallaTransitoria(e.codigo, e.message);
    return observarPorFalla(documento, correlacionId, e.codigo ?? 'EXTRACCION_FALLIDA', e.message);
  }

  const primera = procesarCampos(plantilla, extraccion.campos);

  const reintento = await segundaPasada(
    dependencias.motor,
    { contenido, tipoMime: documento.tipo_mime, plantilla, pistas: pistasGenerales },
    primera,
  );

  const procesado = reintento.procesado;
  const terminadoEn = new Date();

  const emisorClave = claveDeEmisor(procesado.valores);
  const aprendizaje = aplicarCorrecciones(
    procesado.valores,
    await correccionesDe(documento.inquilino_id, plantilla.codigo, emisorClave),
  );
  procesado.valores = aprendizaje.valores;

  const catalogo = await dependencias.buscarObjetos(
    documento.inquilino_id,
    Object.fromEntries(
      Object.entries(procesado.valores).map(([k, v]) => [k, v.valorNormalizado]),
    ),
  );

  const emparejamiento = emparejar(plantilla, procesado.valores, catalogo);

  const validacion = validar({
    plantilla,
    valores: procesado.valores,
    observaciones: extraccion.observaciones,
    emparejamiento,
  });

  const fiscal = await verificarContraArca(plantilla, procesado.valores);

  const hallazgos = [
    ...procesado.hallazgos,
    ...emparejamiento.hallazgos,
    ...validacion.hallazgos,
    ...fiscal.hallazgos,
    ...aprendizaje.hallazgos,
  ];

  const decision = decidir({
    plantilla,
    confianza: procesado.confianza,
    observados: procesado.observados,
    hallazgos,
    emparejamiento,
  });

  const corridaId = randomUUID();
  const validacionId = randomUUID();
  let excepcionId: string | null = null;
  let instantaneaId: string | null = null;

  await enTransaccion(async (cliente) => {
    await cliente.query(
      `INSERT INTO corrida_extraccion
         (id, inquilino_id, documento_id, plantilla_codigo, plantilla_version, proveedor, modelo,
          version_prompt, version_esquema, estado, iniciado_en, terminado_en, milisegundos, uso)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'COMPLETADA', $10, $11, $12, $13)`,
      [
        corridaId, documento.inquilino_id, documento.id, plantilla.codigo, plantilla.version,
        extraccion.uso.proveedor, extraccion.uso.modelo,
        `docvance.extraccion.v1.${plantilla.codigo}.${plantilla.version}`,
        'docvance.esquema.v1', iniciadoEn, terminadoEn,
        terminadoEn.getTime() - iniciadoEn.getTime(), JSON.stringify(extraccion.uso),
      ],
    );

    for (const [clave, valor] of Object.entries(procesado.valores)) {
      await cliente.query(
        `INSERT INTO valor_extraido
           (inquilino_id, corrida_id, clave, valor_leido, valor_normalizado, confianza,
            pagina, recorte, texto_fuente, presencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          documento.inquilino_id, corridaId, clave,
          JSON.stringify(valor.valorLeido ?? null),
          JSON.stringify(valor.valorNormalizado ?? null),
          valor.confianza,
          valor.evidencia?.pagina ?? null,
          valor.evidencia?.recorte ? JSON.stringify(valor.evidencia.recorte) : null,
          valor.evidencia?.textoFuente ?? null,
          valor.presencia,
        ],
      );
    }

    for (const [orden, item] of extraccion.items.entries()) {
      await cliente.query(
        `INSERT INTO item_extraido (inquilino_id, corrida_id, orden, contenido)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (corrida_id, orden) DO UPDATE SET contenido = EXCLUDED.contenido`,
        [documento.inquilino_id, corridaId, orden, JSON.stringify(item)],
      );
    }

    await cambiarEstado(cliente, documento, 'EXTRAIDO', correlacionId);

    for (const candidato of emparejamiento.candidatos) {
      await cliente.query(
        `INSERT INTO candidato_emparejamiento
           (inquilino_id, documento_id, tipo_objeto, objeto_id, puntaje, metodo, estado, razones)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          documento.inquilino_id, documento.id, candidato.tipoObjeto, candidato.objetoId,
          candidato.puntaje, candidato.metodo,
          emparejamiento.sujeto?.id === candidato.objetoId ? 'CONFIRMADO' : 'PROPUESTO',
          JSON.stringify(candidato.razones),
        ],
      );
    }

    await cliente.query(
      `INSERT INTO corrida_validacion
         (id, inquilino_id, documento_id, version_reglas, resultado, hallazgos, iniciado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        validacionId, documento.inquilino_id, documento.id,
        `${plantilla.codigo}.${plantilla.version}`,
        hallazgos.some((h) => h.severidad === 'error' || h.severidad === 'critico')
          ? 'CON_ERRORES'
          : validacion.resultado,
        JSON.stringify(hallazgos), iniciadoEn,
      ],
    );

    await cambiarEstado(cliente, documento, 'VALIDADO', correlacionId);

    await cliente.query(
      `UPDATE documento
       SET confianza = $1, plantilla_codigo = $2, sujeto_tipo = $3, sujeto_id = $4
       WHERE id = $5`,
      [
        procesado.confianza, plantilla.codigo,
        emparejamiento.sujeto?.tipo ?? null, emparejamiento.sujeto?.id ?? null, documento.id,
      ],
    );

    await cliente.query(
      `INSERT INTO documento_fisico (inquilino_id, documento_id, requerido, estado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (documento_id) DO UPDATE SET requerido = EXCLUDED.requerido, estado = EXCLUDED.estado`,
      [
        documento.inquilino_id, documento.id,
        plantilla.politicaFisica === 'REQUERIDO',
        plantilla.politicaFisica === 'REQUERIDO' ? 'REQUERIDO' : 'NO_REQUERIDO',
      ],
    );

    if (decision.aprobable) {
      await cambiarEstado(cliente, documento, 'APROBADO', correlacionId);

      instantaneaId = randomUUID();
      const contenidoInstantanea = {
        documentoId: documento.id,
        plantilla: `${plantilla.codigo}.${plantilla.version}`,
        corridaId,
        valores: procesado.valores,
        items: extraccion.items,
        sujeto: emparejamiento.sujeto,
        validacion: validacion.resultado,
        confianza: procesado.confianza,
        aprobadoEn: new Date().toISOString(),
      };

      await cliente.query(
        `INSERT INTO instantanea_aprobacion
           (id, inquilino_id, documento_id, documento_version, corrida_extraccion_id,
            corrida_validacion_id, sello, contenido)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
        [
          instantaneaId, documento.inquilino_id, documento.id, corridaId, validacionId,
          createHash('sha256').update(JSON.stringify(contenidoInstantanea)).digest('hex'),
          JSON.stringify(contenidoInstantanea),
        ],
      );

      await encolarEvento(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: documento.id,
        tipoEvento: 'documento.aprobado',
        correlacionId,
        causacionId: corridaId,
        datos: { aprobadoPor: 'SISTEMA', instantaneaId, confianza: procesado.confianza },
      });
    } else {
      await cambiarEstado(cliente, documento, 'OBSERVADO', correlacionId);

      excepcionId = randomUUID();
      const severidad = severidadDeExcepcion(decision.motivos);
      const primero = decision.motivos[0];

      await cliente.query(
        `INSERT INTO excepcion
           (id, inquilino_id, documento_id, codigo_motivo, severidad, prioridad, motivos,
            accion_sugerida, vence_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' hours')::interval)`,
        [
          excepcionId, documento.inquilino_id, documento.id,
          primero?.codigo ?? 'REVISION_REQUERIDA', severidad,
          severidad === 'error' ? 'ALTA' : 'MEDIA',
          JSON.stringify(decision.motivos),
          primero ? accionDe(primero.codigo) : 'Revisar en el centro de excepciones.',
          String(horasDeSla(severidad)),
        ],
      );

      await encolarEvento(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: documento.id,
        tipoEvento: 'documento.observado',
        correlacionId,
        causacionId: corridaId,
        datos: {
          codigoMotivo: primero?.codigo ?? 'REVISION_REQUERIDA',
          severidad,
          excepcionId,
          motivos: decision.motivos,
        },
      });
    }
  });

  return {
    documentoId: documento.id,
    estado: decision.estado,
    confianza: procesado.confianza,
    excepcionId,
    instantaneaId,
    motivo: decision.motivos[0]?.codigo ?? null,
  };
}

function accionDe(codigo: string): string {
  const acciones: Record<string, string> = {
    CONFIANZA_GLOBAL_BAJA: 'Revisar los campos marcados y corregir lo que este mal leido.',
    CAMPOS_CRITICOS_OBSERVADOS: 'Completar o corregir los campos criticos senalados.',
    REGLAS_CON_ERROR: 'Revisar los hallazgos de validacion antes de aprobar.',
    EMPAREJAMIENTO_NO_RESUELTO: 'Elegir a mano el objeto de negocio correcto entre los candidatos.',
  };
  return acciones[codigo] ?? 'Revisar el documento en el centro de excepciones.';
}
