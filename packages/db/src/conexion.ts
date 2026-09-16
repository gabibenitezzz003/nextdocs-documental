import { Pool } from 'pg';

let piscina: Pool | null = null;

export function urlPostgres(): string {
  const url = process.env['POSTGRES_URL'];
  if (!url) throw new Error('Falta la variable POSTGRES_URL.');
  return url;
}

export function conexion(): Pool {
  if (!piscina) {
    const ssl = process.env['POSTGRES_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined;
    piscina = new Pool({
      connectionString: urlPostgres(),
      ssl,
      max: Number(process.env['POSTGRES_MAX_CONEXIONES'] ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return piscina;
}

export async function cerrar(): Promise<void> {
  if (piscina) {
    await piscina.end();
    piscina = null;
  }
}

export async function enTransaccion<T>(tarea: (cliente: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const cliente = await conexion().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await tarea(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
