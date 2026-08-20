import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cerrar, conexion } from './conexion.js';
import { migrar } from './migrar.js';
import { exigirBaseDePruebas, usarBaseDePruebas } from './pruebas.js';

const INQUILINO_A = '11111111-1111-1111-1111-111111111111';
const INQUILINO_B = '22222222-2222-2222-2222-222222222222';

async function limpiar(): Promise<void> {
  await conexion().query('TRUNCATE inquilino CASCADE');
}

describe('migraciones y garantias del esquema', () => {
  beforeAll(async () => {
    await usarBaseDePruebas();
    exigirBaseDePruebas();
    await migrar();
    await limpiar();
    await conexion().query(
      'INSERT INTO inquilino (id, nombre) VALUES ($1, $2), ($3, $4)',
      [INQUILINO_A, 'Inquilino A', INQUILINO_B, 'Inquilino B'],
    );
  });

  afterAll(async () => {
    await limpiar();
    await cerrar();
  });

  it('correr las migraciones dos veces no rompe nada', async () => {
    const segunda = await migrar();
    expect(segunda).toHaveLength(0);
  });

  it('el mismo archivo no entra dos veces en el mismo inquilino', async () => {
    await conexion().query(
      `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo)
       VALUES ($1, 'API', 'huella-repetida', 'application/pdf', 'remito.pdf')`,
      [INQUILINO_A],
    );

    await expect(
      conexion().query(
        `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo)
         VALUES ($1, 'API', 'huella-repetida', 'application/pdf', 'copia.pdf')`,
        [INQUILINO_A],
      ),
    ).rejects.toThrow(/documento_huella_unica/);
  });

  it('dos inquilinos pueden tener el mismo archivo sin pisarse', async () => {
    const { rowCount } = await conexion().query(
      `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo)
       VALUES ($1, 'API', 'huella-repetida', 'application/pdf', 'de-otro.pdf')`,
      [INQUILINO_B],
    );
    expect(rowCount).toBe(1);
  });

  it('la referencia externa es unica solo cuando existe', async () => {
    await conexion().query(
      `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo, referencia_externa)
       VALUES ($1, 'API', 'huella-ref-1', 'application/pdf', 'a.pdf', 'REF-1')`,
      [INQUILINO_A],
    );

    await expect(
      conexion().query(
        `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo, referencia_externa)
         VALUES ($1, 'API', 'huella-ref-2', 'application/pdf', 'b.pdf', 'REF-1')`,
        [INQUILINO_A],
      ),
    ).rejects.toThrow(/documento_referencia_unica/);

    const sinReferencia = await conexion().query(
      `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo)
       VALUES ($1, 'API', 'huella-ref-3', 'application/pdf', 'c.pdf'),
              ($1, 'API', 'huella-ref-4', 'application/pdf', 'd.pdf')`,
      [INQUILINO_A],
    );
    expect(sinReferencia.rowCount).toBe(2);
  });

  it('no se puede sellar dos veces la misma version del documento', async () => {
    const { rows } = await conexion().query<{ id: string }>(
      `INSERT INTO documento (inquilino_id, origen, huella, tipo_mime, nombre_archivo)
       VALUES ($1, 'API', 'huella-instantanea', 'application/pdf', 'e.pdf')
       RETURNING id`,
      [INQUILINO_A],
    );
    const documentoId = rows[0]?.id as string;

    await conexion().query(
      `INSERT INTO instantanea_aprobacion (inquilino_id, documento_id, documento_version, sello, contenido)
       VALUES ($1, $2, 1, 'sello-a', '{}'::jsonb)`,
      [INQUILINO_A, documentoId],
    );

    await expect(
      conexion().query(
        `INSERT INTO instantanea_aprobacion (inquilino_id, documento_id, documento_version, sello, contenido)
         VALUES ($1, $2, 1, 'sello-b', '{}'::jsonb)`,
        [INQUILINO_A, documentoId],
      ),
    ).rejects.toThrow();
  });

  it('borrar el inquilino arrastra sus documentos', async () => {
    await conexion().query('DELETE FROM inquilino WHERE id = $1', [INQUILINO_B]);
    const { rows } = await conexion().query<{ total: string }>(
      'SELECT count(*)::text AS total FROM documento WHERE inquilino_id = $1',
      [INQUILINO_B],
    );
    expect(rows[0]?.total).toBe('0');

    await conexion().query('INSERT INTO inquilino (id, nombre) VALUES ($1, $2)',
      [INQUILINO_B, 'Inquilino B']);
  });
});
