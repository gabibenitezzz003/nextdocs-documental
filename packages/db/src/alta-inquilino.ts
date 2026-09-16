import { createHash } from 'node:crypto';

import { PLANTILLAS_BASE } from '@nextdocs/dominio';

import { cerrar, enTransaccion } from './conexion.js';

async function main(): Promise<void> {
  const inquilinoId = process.env['ALTA_INQUILINO_ID']?.trim();
  const nombre = process.env['ALTA_INQUILINO_NOMBRE']?.trim();
  const claveApi = process.env['NEXTDOCS_DOCUMENTAL_API_KEY']?.trim();

  if (!inquilinoId || !nombre || !claveApi) {
    throw new Error(
      'Falta ALTA_INQUILINO_ID, ALTA_INQUILINO_NOMBRE o NEXTDOCS_DOCUMENTAL_API_KEY.',
    );
  }

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

  const cantidadPlantillas = Object.keys(PLANTILLAS_BASE).length;
  console.log(`inquilino ${nombre} (${inquilinoId}) listo con ${cantidadPlantillas} plantillas base`);
}

await main().finally(() => cerrar());
