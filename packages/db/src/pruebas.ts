import { Client } from 'pg';

const SUFIJO = '_pruebas';

export function nombreDeBase(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

export async function usarBaseDePruebas(): Promise<string> {
  const original = process.env['POSTGRES_URL'];
  if (!original) throw new Error('Falta la variable POSTGRES_URL.');

  const url = new URL(original);
  const nombre = nombreDeBase(original);

  if (nombre.endsWith(SUFIJO)) return original;

  const nombrePruebas = `${nombre}${SUFIJO}`;
  const administracion = new URL(original);
  administracion.pathname = '/postgres';

  const cliente = new Client({ connectionString: administracion.toString() });
  await cliente.connect();

  try {
    const { rows } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      nombrePruebas,
    ]);
    if (!rows.length) await cliente.query(`CREATE DATABASE "${nombrePruebas}"`);
  } finally {
    await cliente.end();
  }

  url.pathname = `/${nombrePruebas}`;
  process.env['POSTGRES_URL'] = url.toString();
  return url.toString();
}

export function exigirBaseDePruebas(): void {
  const url = process.env['POSTGRES_URL'];
  if (!url || !nombreDeBase(url).endsWith(SUFIJO)) {
    throw new Error(
      'Los tests de integracion borran tablas: solo corren contra una base terminada en _pruebas.',
    );
  }
}
