import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { conexion, enTransaccion } from '@nextdocs/db';
import { PLANTILLAS_BASE } from '@nextdocs/dominio';
import { SISTEMA, auditar } from '@nextdocs/nucleo';

import { exigirPermiso } from '../contexto.js';
import { ErrorApi, noEncontrado } from '../problemas.js';

const esquemaCodigo = z.object({ codigo: z.string().min(2).max(40) });

const esquemaAjuste = z.object({
  umbralAutoAprobacion: z.number().min(0.5).max(1).optional(),
  politicaFisica: z.enum(['NO_REQUERIDO', 'REQUERIDO']).optional(),
  diasAvisoVencimiento: z.number().int().min(1).max(365).optional(),
  campos: z
    .array(z.object({
      clave: z.string().min(1).max(80),
      requerido: z.boolean().optional(),
      critico: z.boolean().optional(),
      umbral: z.number().min(0).max(1).optional(),
    }))
    .max(60)
    .optional(),
});

const esquemaEstado = z.object({
  estado: z.enum(['PUBLICADA', 'DEPRECADA']),
});

interface FilaPlantilla {
  id: string;
  codigo: string;
  version: number;
  estado: string;
  definicion: Record<string, unknown>;
}

async function buscarPlantilla(
  inquilinoId: string,
  codigo: string,
): Promise<FilaPlantilla | null> {
  const { rows } = await conexion().query<FilaPlantilla>(
    `SELECT id, codigo, version, estado, definicion
       FROM plantilla_documental
      WHERE inquilino_id = $1 AND codigo = $2
      ORDER BY version DESC LIMIT 1`,
    [inquilinoId, codigo.toUpperCase()],
  );
  return rows[0] ?? null;
}

export async function rutasDePlantillas(servidor: FastifyInstance): Promise<void> {
  servidor.get('/api/v1/plantillas/catalogo', async (pedido) => {
    exigirPermiso(pedido.contexto, 'leer');

    const { rows } = await conexion().query<{ codigo: string }>(
      'SELECT codigo FROM plantilla_documental WHERE inquilino_id = $1',
      [pedido.contexto.inquilinoId],
    );

    const propias = new Set(rows.map((r) => r.codigo));

    return {
      disponibles: Object.values(PLANTILLAS_BASE).map((plantilla) => ({
        codigo: plantilla.codigo,
        nombre: plantilla.nombre,
        familia: plantilla.familia,
        campos: plantilla.campos.length,
        instalada: propias.has(plantilla.codigo),
      })),
    };
  });

  servidor.patch('/api/v1/plantillas/:codigo', async (pedido) => {
    exigirPermiso(pedido.contexto, 'administrar');
    const { codigo } = esquemaCodigo.parse(pedido.params);
    const ajuste = esquemaAjuste.parse(pedido.body);

    const plantilla = await buscarPlantilla(pedido.contexto.inquilinoId, codigo);
    if (!plantilla) throw noEncontrado(`No existe la plantilla ${codigo}.`);

    if (plantilla.estado === 'DEPRECADA') {
      throw new ErrorApi('TRANSICION_INVALIDA', 'Una plantilla deprecada no se edita.');
    }

    const definicion = { ...plantilla.definicion };
    const antes = {
      umbralAutoAprobacion: definicion['umbralAutoAprobacion'],
      politicaFisica: definicion['politicaFisica'],
      diasAvisoVencimiento: definicion['diasAvisoVencimiento'],
    };

    if (ajuste.umbralAutoAprobacion !== undefined) {
      definicion['umbralAutoAprobacion'] = ajuste.umbralAutoAprobacion;
    }
    if (ajuste.politicaFisica !== undefined) {
      definicion['politicaFisica'] = ajuste.politicaFisica;
    }
    if (ajuste.diasAvisoVencimiento !== undefined) {
      definicion['diasAvisoVencimiento'] = ajuste.diasAvisoVencimiento;
    }

    if (ajuste.campos?.length) {
      const campos = [...((definicion['campos'] as Record<string, unknown>[]) ?? [])];
      for (const cambio of ajuste.campos) {
        const indice = campos.findIndex((c) => c['clave'] === cambio.clave);
        if (indice < 0) continue;
        const campo = { ...campos[indice] };
        if (cambio.requerido !== undefined) campo['requerido'] = cambio.requerido;
        if (cambio.critico !== undefined) campo['critico'] = cambio.critico;
        if (cambio.umbral !== undefined) campo['umbral'] = cambio.umbral;
        campos[indice] = campo;
      }
      definicion['campos'] = campos;
    }

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE plantilla_documental
            SET definicion = $1,
                umbral_auto_aprobacion = $2,
                politica_fisica = $3
          WHERE id = $4`,
        [
          JSON.stringify(definicion),
          definicion['umbralAutoAprobacion'],
          definicion['politicaFisica'],
          plantilla.id,
        ],
      );

      await auditar(cliente, {
        inquilinoId: pedido.contexto.inquilinoId,
        tipoAgregado: 'plantilla',
        agregadoId: plantilla.id,
        accion: 'PLANTILLA_AJUSTADA',
        actor: pedido.contexto.actor ?? SISTEMA,
        origen: 'API',
        correlacionId: pedido.correlacionId,
        antes,
        despues: {
          umbralAutoAprobacion: definicion['umbralAutoAprobacion'],
          politicaFisica: definicion['politicaFisica'],
          diasAvisoVencimiento: definicion['diasAvisoVencimiento'],
          camposTocados: ajuste.campos?.map((c) => c.clave) ?? [],
        },
      });
    });

    return { codigo: plantilla.codigo, version: plantilla.version, definicion };
  });

  servidor.put('/api/v1/plantillas/:codigo/estado', async (pedido) => {
    exigirPermiso(pedido.contexto, 'administrar');
    const { codigo } = esquemaCodigo.parse(pedido.params);
    const { estado } = esquemaEstado.parse(pedido.body);

    const plantilla = await buscarPlantilla(pedido.contexto.inquilinoId, codigo);
    if (!plantilla) throw noEncontrado(`No existe la plantilla ${codigo}.`);

    if (plantilla.estado === estado) {
      return { codigo: plantilla.codigo, estado, sinCambios: true };
    }

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE plantilla_documental
            SET estado = $1, publicado_en = CASE WHEN $1 = 'PUBLICADA' THEN now() ELSE publicado_en END
          WHERE id = $2`,
        [estado, plantilla.id],
      );

      await auditar(cliente, {
        inquilinoId: pedido.contexto.inquilinoId,
        tipoAgregado: 'plantilla',
        agregadoId: plantilla.id,
        accion: `PLANTILLA_${estado}`,
        actor: pedido.contexto.actor ?? SISTEMA,
        origen: 'API',
        correlacionId: pedido.correlacionId,
        antes: { estado: plantilla.estado },
        despues: { estado },
      });
    });

    return { codigo: plantilla.codigo, estado, sinCambios: false };
  });

  servidor.post('/api/v1/plantillas/:codigo/instalar', async (pedido, respuesta) => {
    exigirPermiso(pedido.contexto, 'administrar');
    const { codigo } = esquemaCodigo.parse(pedido.params);

    const base = PLANTILLAS_BASE[codigo.toUpperCase()];
    if (!base) throw noEncontrado(`No hay una plantilla base llamada ${codigo}.`);

    const { rows } = await conexion().query<{ id: string }>(
      `INSERT INTO plantilla_documental
         (inquilino_id, codigo, nombre, version, estado, umbral_auto_aprobacion,
          politica_fisica, definicion, publicado_en)
       VALUES ($1, $2, $3, $4, 'PUBLICADA', $5, $6, $7, now())
       ON CONFLICT (inquilino_id, codigo, version)
       DO UPDATE SET estado = 'PUBLICADA', definicion = EXCLUDED.definicion
       RETURNING id`,
      [
        pedido.contexto.inquilinoId,
        base.codigo,
        base.nombre,
        base.version,
        base.umbralAutoAprobacion,
        base.politicaFisica,
        JSON.stringify(base),
      ],
    );

    respuesta.status(201);
    return { codigo: base.codigo, id: rows[0]?.id ?? null, estado: 'PUBLICADA' };
  });
}
