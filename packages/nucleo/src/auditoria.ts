import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type { TipoEvento } from '@nextdocs/contratos';

export interface Actor {
  tipo: 'USUARIO' | 'SISTEMA' | 'API' | 'EXTERNO';
  id: string | null;
}

export const SISTEMA: Actor = { tipo: 'SISTEMA', id: null };

export interface EntradaAuditoria {
  inquilinoId: string;
  tipoAgregado: string;
  agregadoId: string;
  accion: string;
  actor: Actor;
  origen: string;
  correlacionId?: string | null;
  causacionId?: string | null;
  antes?: unknown;
  despues?: unknown;
  metadatos?: Record<string, unknown>;
}

export async function auditar(cliente: PoolClient, entrada: EntradaAuditoria): Promise<void> {
  await cliente.query(
    `INSERT INTO evento_auditoria
       (inquilino_id, tipo_agregado, agregado_id, accion, tipo_actor, actor_id, origen,
        correlacion_id, causacion_id, antes, despues, metadatos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      entrada.inquilinoId,
      entrada.tipoAgregado,
      entrada.agregadoId,
      entrada.accion,
      entrada.actor.tipo,
      entrada.actor.id,
      entrada.origen,
      entrada.correlacionId ?? null,
      entrada.causacionId ?? null,
      entrada.antes === undefined ? null : JSON.stringify(entrada.antes),
      entrada.despues === undefined ? null : JSON.stringify(entrada.despues),
      entrada.metadatos === undefined ? null : JSON.stringify(entrada.metadatos),
    ],
  );
}

export interface EntradaEvento {
  inquilinoId: string;
  tipoAgregado: string;
  agregadoId: string;
  tipoEvento: TipoEvento;
  datos: Record<string, unknown>;
  correlacionId?: string | null;
  causacionId?: string | null;
}

export async function encolarEvento(
  cliente: PoolClient,
  entrada: EntradaEvento,
): Promise<string> {
  const eventoId = randomUUID();
  await cliente.query(
    `INSERT INTO evento_salida
       (id, inquilino_id, tipo_agregado, agregado_id, tipo_evento, version_evento,
        correlacion_id, causacion_id, contenido)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
    [
      eventoId,
      entrada.inquilinoId,
      entrada.tipoAgregado,
      entrada.agregadoId,
      entrada.tipoEvento,
      entrada.correlacionId ?? null,
      entrada.causacionId ?? null,
      JSON.stringify(entrada.datos),
    ],
  );
  return eventoId;
}
