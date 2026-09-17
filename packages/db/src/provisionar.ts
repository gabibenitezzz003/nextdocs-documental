import { createHash } from 'node:crypto';

import { PLANTILLAS_BASE } from '@nextdocs/dominio';

import { enTransaccion } from './conexion.js';

export async function provisionarInquilino(
  inquilinoId: string,
  nombre: string,
  claveApi: string,
): Promise<void> {
  await enTransaccion(async (cliente) => {
    await cliente.query(
      `INSERT INTO inquilino (id, nombre, plan)
       VALUES ($1, $2, 'BUSINESS')
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [inquilinoId, nombre],
    );

    for (const plantilla of Object.values(PLANTILLAS_BASE)) {
      await cliente.query(
        `INSERT INTO plantilla_documental
           (inquilino_id, codigo, nombre, version, estado, umbral_auto_aprobacion,
            politica_fisica, definicion, publicado_en)
         VALUES ($1, $2, $3, $4, 'PUBLICADA', $5, $6, $7, now())
         ON CONFLICT (inquilino_id, codigo, version)
         DO UPDATE SET definicion = EXCLUDED.definicion, nombre = EXCLUDED.nombre`,
        [
          inquilinoId,
          plantilla.codigo,
          plantilla.nombre,
          plantilla.version,
          plantilla.umbralAutoAprobacion,
          plantilla.politicaFisica,
          JSON.stringify(plantilla),
        ],
      );
    }

    await cliente.query(
      `INSERT INTO clave_api (inquilino_id, nombre, prefijo, huella, rol)
       VALUES ($1, $2, $3, $4, 'ADMIN_INQUILINO')
       ON CONFLICT (huella) DO UPDATE SET activa = true`,
      [
        inquilinoId,
        `Clave administradora de ${nombre}`,
        claveApi.slice(0, 12),
        createHash('sha256').update(claveApi).digest('hex'),
      ],
    );
  });
}
