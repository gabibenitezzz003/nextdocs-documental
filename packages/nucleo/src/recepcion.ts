import { createHash, randomUUID } from 'node:crypto';

import type { Almacenamiento } from '@nextdocs/adaptadores';
import {
  NOMBRE_COLA_PROCESAMIENTO,
  claveAlmacen,
  inspeccionar,
  type CargarDocumento,
  type RespuestaCarga,
} from '@nextdocs/contratos';
import { enTransaccion } from '@nextdocs/db';

import { SISTEMA, auditar, encolarEvento, type Actor } from './auditoria.js';

export interface DependenciasRecepcion {
  almacenamiento: Almacenamiento;
  encolar: (nombre: string, clave: string, datos: Record<string, unknown>) => Promise<void>;
}

export interface PedidoRecepcion {
  inquilinoId: string;
  datos: CargarDocumento;
  actor?: Actor;
  claveIdempotencia?: string | null;
  correlacionId?: string | null;
}

export async function recibirDocumento(
  pedido: PedidoRecepcion,
  dependencias: DependenciasRecepcion,
): Promise<RespuestaCarga> {
  const { inquilinoId, datos } = pedido;
  const actor = pedido.actor ?? SISTEMA;
  const correlacionId = pedido.correlacionId ?? randomUUID();

  const crudo = datos.contenidoBase64.replace(/^data:[^;]+;base64,/, '');
  let contenido: Buffer;
  try {
    contenido = Buffer.from(crudo, 'base64');
  } catch {
    return {
      aceptado: false,
      documentoId: null,
      estado: null,
      motivo: 'ARCHIVO_RECHAZADO',
      rechazos: [{ codigo: 'BASE64_INVALIDO', mensaje: 'El contenido no es base64 valido.' }],
    };
  }

  const inspeccion = inspeccionar(datos.nombreArchivo, datos.tipoMime, contenido);

  if (!inspeccion.aceptado || !inspeccion.tipoReal) {
    return {
      aceptado: false,
      documentoId: null,
      estado: null,
      motivo: 'ARCHIVO_RECHAZADO',
      rechazos: inspeccion.rechazos,
    };
  }

  const huella = createHash('sha256').update(contenido).digest('hex');
  const documentoId = randomUUID();
  const clave = claveAlmacen(inquilinoId, documentoId, inspeccion.tipoReal);

  await dependencias.almacenamiento.guardar(clave, contenido, inspeccion.tipoReal);

  const resultado = await enTransaccion(async (cliente) => {
    if (pedido.claveIdempotencia) {
      const previa = await cliente.query<{ recurso_id: string }>(
        'SELECT recurso_id FROM clave_idempotencia WHERE inquilino_id = $1 AND clave = $2',
        [inquilinoId, pedido.claveIdempotencia],
      );
      const yaEstaba = previa.rows[0];
      if (yaEstaba) {
        return { documentoId: yaEstaba.recurso_id, duplicado: true, porClave: true };
      }
    }

    const repetido = await cliente.query<{ id: string }>(
      'SELECT id FROM documento WHERE inquilino_id = $1 AND huella = $2',
      [inquilinoId, huella],
    );
    const previo = repetido.rows[0];
    if (previo) {
      return { documentoId: previo.id, duplicado: true, porClave: false };
    }

    await cliente.query(
      `INSERT INTO documento
         (id, inquilino_id, origen, referencia_externa, huella, tipo_mime, nombre_archivo,
          estado, plantilla_codigo, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'RECIBIDO', $8, $9)`,
      [
        documentoId,
        inquilinoId,
        datos.origen,
        datos.referenciaExterna ?? null,
        huella,
        inspeccion.tipoReal,
        inspeccion.nombreSeguro,
        datos.plantilla ?? null,
        actor.tipo === 'USUARIO' ? actor.id : null,
      ],
    );

    await cliente.query(
      `INSERT INTO archivo_documento
         (inquilino_id, documento_id, clave_almacen, version, suma, tamano_bytes)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [inquilinoId, documentoId, clave, huella, inspeccion.tamanoBytes],
    );

    if (pedido.claveIdempotencia) {
      await cliente.query(
        `INSERT INTO clave_idempotencia (inquilino_id, clave, recurso, recurso_id)
         VALUES ($1, $2, 'documento', $3)`,
        [inquilinoId, pedido.claveIdempotencia, documentoId],
      );
    }

    await auditar(cliente, {
      inquilinoId,
      tipoAgregado: 'documento',
      agregadoId: documentoId,
      accion: 'RECIBIDO',
      actor,
      origen: datos.origen,
      correlacionId,
      despues: {
        huella,
        nombreArchivo: inspeccion.nombreSeguro,
        tipoMime: inspeccion.tipoReal,
        tamanoBytes: inspeccion.tamanoBytes,
      },
    });

    await encolarEvento(cliente, {
      inquilinoId,
      tipoAgregado: 'documento',
      agregadoId: documentoId,
      tipoEvento: 'documento.recibido',
      correlacionId,
      datos: {
        origen: datos.origen,
        referenciaExterna: datos.referenciaExterna ?? null,
        huella,
        nombreArchivo: inspeccion.nombreSeguro,
      },
    });

    return { documentoId, duplicado: false, porClave: false };
  });

  if (resultado.duplicado) {
    return {
      aceptado: resultado.porClave,
      documentoId: resultado.documentoId,
      estado: resultado.porClave ? 'RECIBIDO' : null,
      motivo: resultado.porClave ? undefined : 'DUPLICADO',
      duplicadoDe: resultado.documentoId,
    };
  }

  await dependencias.encolar(NOMBRE_COLA_PROCESAMIENTO, documentoId, {
    documentoId,
    inquilinoId,
    correlacionId,
    intento: 1,
  });

  return { aceptado: true, documentoId, estado: 'RECIBIDO' };
}
