import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { conexion, enTransaccion } from '@nextdocs/db';
import { exigirTransicion, normalizarCuit, type EstadoDocumento } from '@nextdocs/dominio';

import { SISTEMA, auditar, encolarEvento, type Actor } from './auditoria.js';
import { EMISOR_GENERICO, registrarCorreccion } from './aprendizaje.js';

export interface PedidoRevision {
  inquilinoId: string;
  documentoId: string;
  decision: 'CORREGIR' | 'APROBAR' | 'RECHAZAR';
  claveCampo?: string | null;
  valor?: unknown;
  motivo?: string | null;
  actor?: Actor;
  correlacionId?: string | null;
}

export interface ResultadoRevision {
  documentoId: string;
  estado: EstadoDocumento;
  revisionId: string;
  instantaneaId: string | null;
}

interface FilaDocumento {
  id: string;
  inquilino_id: string;
  estado: EstadoDocumento;
  version: number;
  plantilla_codigo: string | null;
  confianza: string | null;
  sujeto_tipo: string | null;
  sujeto_id: string | null;
}

export class DocumentoInexistente extends Error {
  readonly codigo = 'DOCUMENTO_NO_ENCONTRADO';

  constructor(id: string) {
    super(`No existe el documento ${id}.`);
    this.name = 'DocumentoInexistente';
  }
}

export class RevisionInvalida extends Error {
  readonly codigo: string;

  constructor(codigo: string, detalle: string) {
    super(detalle);
    this.codigo = codigo;
    this.name = 'RevisionInvalida';
  }
}

export async function documentoDelInquilino(
  inquilinoId: string,
  documentoId: string,
): Promise<FilaDocumento> {
  const { rows } = await conexion().query<FilaDocumento>(
    `SELECT id, inquilino_id, estado, version, plantilla_codigo, confianza, sujeto_tipo, sujeto_id
       FROM documento WHERE id = $1 AND inquilino_id = $2`,
    [documentoId, inquilinoId],
  );
  const fila = rows[0];
  if (!fila) throw new DocumentoInexistente(documentoId);
  return fila;
}

async function ultimaCorrida(
  documentoId: string,
): Promise<{ id: string; validacionId: string | null } | null> {
  const { rows } = await conexion().query<{ id: string; validacion_id: string | null }>(
    `SELECT c.id,
            (SELECT v.id FROM corrida_validacion v
              WHERE v.documento_id = c.documento_id
              ORDER BY v.terminado_en DESC LIMIT 1) AS validacion_id
       FROM corrida_extraccion c
      WHERE c.documento_id = $1
      ORDER BY c.creado_en DESC LIMIT 1`,
    [documentoId],
  );
  const fila = rows[0];
  return fila ? { id: fila.id, validacionId: fila.validacion_id } : null;
}

async function cerrarExcepciones(
  cliente: PoolClient,
  documentoId: string,
  resolucion: string,
  actor: Actor,
): Promise<void> {
  await cliente.query(
    `UPDATE excepcion
        SET estado = 'RESUELTA', resolucion = $2, resuelto_en = now(), responsable_id = $3
      WHERE documento_id = $1 AND estado = 'ABIERTA'`,
    [documentoId, resolucion, actor.tipo === 'USUARIO' ? actor.id : null],
  );
}

async function armarInstantanea(
  cliente: PoolClient,
  documento: FilaDocumento,
  actor: Actor,
): Promise<string> {
  const corrida = await ultimaCorrida(documento.id);

  const { rows: valores } = await conexion().query<{
    clave: string;
    valor_normalizado: unknown;
    confianza: string;
  }>(
    `SELECT clave, valor_normalizado, confianza FROM valor_extraido
      WHERE corrida_id = $1 ORDER BY clave`,
    [corrida?.id ?? randomUUID()],
  );

  const instantaneaId = randomUUID();
  const contenido = {
    documentoId: documento.id,
    plantilla: documento.plantilla_codigo,
    corridaId: corrida?.id ?? null,
    valores: Object.fromEntries(
      valores.map((v) => [
        v.clave,
        { valorNormalizado: v.valor_normalizado, confianza: Number(v.confianza) },
      ]),
    ),
    sujeto: documento.sujeto_id ? { tipo: documento.sujeto_tipo, id: documento.sujeto_id } : null,
    confianza: documento.confianza === null ? null : Number(documento.confianza),
    aprobadoPor: actor.id,
    aprobadoEn: new Date().toISOString(),
  };

  await cliente.query(
    `INSERT INTO instantanea_aprobacion
       (id, inquilino_id, documento_id, documento_version, corrida_extraccion_id,
        corrida_validacion_id, aprobado_por, sello, contenido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      instantaneaId,
      documento.inquilino_id,
      documento.id,
      documento.version,
      corrida?.id ?? null,
      corrida?.validacionId ?? null,
      actor.tipo === 'USUARIO' ? actor.id : null,
      createHash('sha256').update(JSON.stringify(contenido)).digest('hex'),
      JSON.stringify(contenido),
    ],
  );

  return instantaneaId;
}

async function corregirCampo(
  cliente: PoolClient,
  documento: FilaDocumento,
  clave: string,
  valor: unknown,
): Promise<unknown> {
  const corrida = await ultimaCorrida(documento.id);
  if (!corrida) {
    throw new RevisionInvalida('REVISION_REQUERIDA', 'El documento todavia no tiene extraccion.');
  }

  const { rows } = await conexion().query<{ valor_normalizado: unknown; valor_leido: unknown }>(
    'SELECT valor_normalizado, valor_leido FROM valor_extraido WHERE corrida_id = $1 AND clave = $2',
    [corrida.id, clave],
  );

  const anterior = rows[0]?.valor_normalizado ?? null;

  const { rows: emisores } = await conexion().query<{ valor_normalizado: unknown }>(
    `SELECT valor_normalizado FROM valor_extraido
      WHERE corrida_id = $1 AND clave = 'cuitEmisor'`,
    [corrida.id],
  );

  await registrarCorreccion(cliente, {
    inquilinoId: documento.inquilino_id,
    plantillaCodigo: documento.plantilla_codigo ?? 'DESCONOCIDO',
    emisorClave: normalizarCuit(emisores[0]?.valor_normalizado) ?? EMISOR_GENERICO,
    claveCampo: clave,
    valorLeido: rows[0]?.valor_leido ?? anterior,
    valorCorregido: valor,
    documentoId: documento.id,
  });

  await cliente.query(
    `INSERT INTO valor_extraido
       (inquilino_id, corrida_id, clave, valor_leido, valor_normalizado, confianza, texto_fuente)
     VALUES ($1, $2, $3, $4, $5, 1, 'correccion manual')
     ON CONFLICT (corrida_id, clave)
     DO UPDATE SET valor_normalizado = EXCLUDED.valor_normalizado,
                   confianza = 1,
                   texto_fuente = EXCLUDED.texto_fuente`,
    [
      documento.inquilino_id,
      corrida.id,
      clave,
      JSON.stringify(valor ?? null),
      JSON.stringify(valor ?? null),
    ],
  );

  return anterior;
}

export async function revisarDocumento(pedido: PedidoRevision): Promise<ResultadoRevision> {
  const actor = pedido.actor ?? SISTEMA;
  const correlacionId = pedido.correlacionId ?? randomUUID();
  const documento = await documentoDelInquilino(pedido.inquilinoId, pedido.documentoId);

  if (documento.estado === 'CERRADO' || documento.estado === 'RECHAZADO') {
    throw new RevisionInvalida('TRANSICION_INVALIDA', `El documento ya esta ${documento.estado}.`);
  }

  const revisionId = randomUUID();
  let instantaneaId: string | null = null;
  let estadoFinal: EstadoDocumento = documento.estado;

  await enTransaccion(async (cliente) => {
    let antes: unknown = null;
    let despues: unknown = null;

    if (pedido.decision === 'CORREGIR') {
      if (!pedido.claveCampo) {
        throw new RevisionInvalida('VALIDACION_FALLIDA', 'Para corregir hay que indicar el campo.');
      }
      antes = await corregirCampo(cliente, documento, pedido.claveCampo, pedido.valor);
      despues = pedido.valor ?? null;
    }

    if (pedido.decision === 'APROBAR') {
      exigirTransicion(documento.estado, 'APROBADO');
      await cliente.query(
        'UPDATE documento SET estado = $1, actualizado_en = now() WHERE id = $2',
        ['APROBADO', documento.id],
      );
      estadoFinal = 'APROBADO';
      instantaneaId = await armarInstantanea(cliente, documento, actor);
      await cerrarExcepciones(cliente, documento.id, pedido.motivo ?? 'Aprobado en revision manual.', actor);
      antes = { estado: documento.estado };
      despues = { estado: 'APROBADO', instantaneaId };
    }

    if (pedido.decision === 'RECHAZAR') {
      exigirTransicion(documento.estado, 'RECHAZADO');
      await cliente.query(
        'UPDATE documento SET estado = $1, actualizado_en = now() WHERE id = $2',
        ['RECHAZADO', documento.id],
      );
      estadoFinal = 'RECHAZADO';
      await cerrarExcepciones(cliente, documento.id, pedido.motivo ?? 'Rechazado en revision manual.', actor);
      antes = { estado: documento.estado };
      despues = { estado: 'RECHAZADO' };

      const { rows: hijosPendientes } = await cliente.query<{ id: string; estado: string }>(
        `UPDATE documento
            SET estado = 'RECHAZADO', actualizado_en = now()
          WHERE documento_padre_id = $1 AND estado <> ALL($2::text[])
          RETURNING id, estado`,
        [documento.id, ['APROBADO', 'RECHAZADO', 'CERRADO', 'DIVIDIDO']],
      );

      for (const hijo of hijosPendientes) {
        await cerrarExcepciones(cliente, hijo.id, pedido.motivo ?? 'Rechazado con el documento padre.', actor);
        await auditar(cliente, {
          inquilinoId: documento.inquilino_id,
          tipoAgregado: 'documento',
          agregadoId: hijo.id,
          accion: 'REVISION_RECHAZAR',
          actor,
          origen: 'API',
          correlacionId,
          antes: { estado: hijo.estado },
          despues: { estado: 'RECHAZADO', documentoPadreId: documento.id },
        });
        await encolarEvento(cliente, {
          inquilinoId: documento.inquilino_id,
          tipoAgregado: 'documento',
          agregadoId: hijo.id,
          tipoEvento: 'documento.rechazado',
          correlacionId,
          datos: { motivo: pedido.motivo ?? null, rechazadoPor: actor.id, documentoPadreId: documento.id },
        });
      }
    }

    await cliente.query(
      `INSERT INTO revision_documento
         (id, inquilino_id, documento_id, clave_campo, revisor_id, decision, motivo, antes, despues)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        revisionId,
        documento.inquilino_id,
        documento.id,
        pedido.claveCampo ?? null,
        actor.tipo === 'USUARIO' ? actor.id : null,
        pedido.decision,
        pedido.motivo ?? null,
        JSON.stringify(antes),
        JSON.stringify(despues),
      ],
    );

    await auditar(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      accion: `REVISION_${pedido.decision}`,
      actor,
      origen: 'API',
      correlacionId,
      antes,
      despues,
      metadatos: { claveCampo: pedido.claveCampo ?? null, revisionId },
    });

    await encolarEvento(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      tipoEvento: 'revision.completada',
      correlacionId,
      datos: {
        decision: pedido.decision,
        claveCampo: pedido.claveCampo ?? null,
        revisorId: actor.id,
        estado: estadoFinal,
      },
    });

    if (estadoFinal === 'APROBADO') {
      await encolarEvento(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: documento.id,
        tipoEvento: 'documento.aprobado',
        correlacionId,
        datos: {
          plantilla: documento.plantilla_codigo,
          instantaneaId,
          aprobadoPor: actor.id,
          manual: true,
        },
      });
    }

    if (estadoFinal === 'RECHAZADO') {
      await encolarEvento(cliente, {
        inquilinoId: documento.inquilino_id,
        tipoAgregado: 'documento',
        agregadoId: documento.id,
        tipoEvento: 'documento.rechazado',
        correlacionId,
        datos: { motivo: pedido.motivo ?? null, rechazadoPor: actor.id },
      });
    }
  });

  return { documentoId: documento.id, estado: estadoFinal, revisionId, instantaneaId };
}

export interface PedidoConfirmarEmparejamiento {
  inquilinoId: string;
  documentoId: string;
  candidatoId: string;
  motivo?: string | null;
  actor?: Actor;
  correlacionId?: string | null;
}

export async function confirmarEmparejamiento(
  pedido: PedidoConfirmarEmparejamiento,
): Promise<{ documentoId: string; sujetoTipo: string; sujetoId: string | null }> {
  const actor = pedido.actor ?? SISTEMA;
  const correlacionId = pedido.correlacionId ?? randomUUID();
  const documento = await documentoDelInquilino(pedido.inquilinoId, pedido.documentoId);

  const { rows } = await conexion().query<{ id: string; tipo_objeto: string; objeto_id: string | null }>(
    `SELECT id, tipo_objeto, objeto_id FROM candidato_emparejamiento
      WHERE id = $1 AND documento_id = $2 AND inquilino_id = $3`,
    [pedido.candidatoId, documento.id, documento.inquilino_id],
  );

  const candidato = rows[0];
  if (!candidato) {
    throw new RevisionInvalida('EMPAREJAMIENTO_AMBIGUO', 'Ese candidato no pertenece al documento.');
  }

  await enTransaccion(async (cliente) => {
    await cliente.query(
      `UPDATE candidato_emparejamiento
          SET estado = CASE WHEN id = $1 THEN 'CONFIRMADO_MANUAL' ELSE 'DESCARTADO' END
        WHERE documento_id = $2`,
      [candidato.id, documento.id],
    );

    await cliente.query(
      'UPDATE documento SET sujeto_tipo = $1, sujeto_id = $2, actualizado_en = now() WHERE id = $3',
      [candidato.tipo_objeto, candidato.objeto_id, documento.id],
    );

    await auditar(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      accion: 'EMPAREJAMIENTO_CONFIRMADO',
      actor,
      origen: 'API',
      correlacionId,
      antes: { sujetoTipo: documento.sujeto_tipo, sujetoId: documento.sujeto_id },
      despues: { sujetoTipo: candidato.tipo_objeto, sujetoId: candidato.objeto_id },
      metadatos: { candidatoId: candidato.id, motivo: pedido.motivo ?? null },
    });

    await encolarEvento(cliente, {
      inquilinoId: documento.inquilino_id,
      tipoAgregado: 'documento',
      agregadoId: documento.id,
      tipoEvento: 'documento.emparejado',
      correlacionId,
      datos: {
        tipoObjeto: candidato.tipo_objeto,
        objetoId: candidato.objeto_id,
        metodo: 'MANUAL',
        confirmadoPor: actor.id,
      },
    });
  });

  return {
    documentoId: documento.id,
    sujetoTipo: candidato.tipo_objeto,
    sujetoId: candidato.objeto_id,
  };
}

export interface PedidoResolverExcepcion {
  inquilinoId: string;
  excepcionId: string;
  decision: 'RESUELTA' | 'DESCARTADA' | 'ESCALADA';
  resolucion: string;
  actor?: Actor;
  correlacionId?: string | null;
}

export async function resolverExcepcion(
  pedido: PedidoResolverExcepcion,
): Promise<{ excepcionId: string; estado: string }> {
  const actor = pedido.actor ?? SISTEMA;
  const correlacionId = pedido.correlacionId ?? randomUUID();

  const { rows } = await conexion().query<{ id: string; documento_id: string; estado: string }>(
    'SELECT id, documento_id, estado FROM excepcion WHERE id = $1 AND inquilino_id = $2',
    [pedido.excepcionId, pedido.inquilinoId],
  );

  const excepcion = rows[0];
  if (!excepcion) throw new DocumentoInexistente(pedido.excepcionId);

  await enTransaccion(async (cliente) => {
    await cliente.query(
      `UPDATE excepcion
          SET estado = $1,
              resolucion = $2,
              resuelto_en = CASE WHEN $1 = 'ESCALADA' THEN NULL ELSE now() END,
              responsable_id = $3
        WHERE id = $4`,
      [pedido.decision, pedido.resolucion, actor.tipo === 'USUARIO' ? actor.id : null, excepcion.id],
    );

    await auditar(cliente, {
      inquilinoId: pedido.inquilinoId,
      tipoAgregado: 'excepcion',
      agregadoId: excepcion.id,
      accion: `EXCEPCION_${pedido.decision}`,
      actor,
      origen: 'API',
      correlacionId,
      antes: { estado: excepcion.estado },
      despues: { estado: pedido.decision, resolucion: pedido.resolucion },
      metadatos: { documentoId: excepcion.documento_id },
    });
  });

  return { excepcionId: excepcion.id, estado: pedido.decision };
}
