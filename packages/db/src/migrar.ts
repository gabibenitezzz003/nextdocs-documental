import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cerrar, conexion } from './conexion.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(AQUI, '..', 'migraciones');

async function asegurarRegistro(): Promise<void> {
  await conexion().query(`
    CREATE TABLE IF NOT EXISTS migracion_aplicada (
      nombre      text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function aplicadas(): Promise<Set<string>> {
  const { rows } = await conexion().query<{ nombre: string }>(
    'SELECT nombre FROM migracion_aplicada',
  );
  return new Set(rows.map((r) => r.nombre));
}

export async function migrar(): Promise<string[]> {
  await asegurarRegistro();
  const yaEstan = await aplicadas();

  const archivos = (await readdir(CARPETA))
    .filter((n) => n.endsWith('.sql'))
    .sort();

  const nuevas: string[] = [];

  for (const archivo of archivos) {
    if (yaEstan.has(archivo)) continue;

    const sql = await readFile(join(CARPETA, archivo), 'utf8');
    const cliente = await conexion().connect();

    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO migracion_aplicada (nombre) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      nuevas.push(archivo);
      process.stdout.write(`aplicada: ${archivo}\n`);
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw new Error(`Fallo la migracion ${archivo}: ${(error as Error).message}`);
    } finally {
      cliente.release();
    }
  }

  if (!nuevas.length) process.stdout.write('sin migraciones pendientes\n');
  return nuevas;
}

const ejecutadoDirecto = process.argv[1]?.includes('migrar');

if (ejecutadoDirecto) {
  migrar()
    .then(async () => {
      await cerrar();
      process.exit(0);
    })
    .catch(async (error: Error) => {
      process.stderr.write(`${error.message}\n`);
      await cerrar();
      process.exit(1);
    });
}
