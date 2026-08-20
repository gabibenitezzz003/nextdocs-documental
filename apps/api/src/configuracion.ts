export interface Configuracion {
  puerto: number;
  anfitrion: string;
  origenesPermitidos: string[];
  entorno: string;
}

export function configuracion(): Configuracion {
  const origenes = process.env['API_ORIGENES'] ?? 'http://localhost:4001';
  return {
    puerto: Number(process.env['API_PUERTO'] ?? 4000),
    anfitrion: process.env['API_ANFITRION'] ?? '0.0.0.0',
    origenesPermitidos: origenes.split(',').map((o) => o.trim()).filter(Boolean),
    entorno: process.env['NODE_ENV'] ?? 'development',
  };
}
