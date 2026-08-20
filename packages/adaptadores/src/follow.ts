export const LIMITE_BUSQUEDA_FOLLOW = 10;
export const ESPERA_FOLLOW_MS = 8_000;

export interface ConfiguracionFollow {
  url: string;
  token: string;
}

export function configuracionFollow(): ConfiguracionFollow | null {
  const url = process.env['FOLLOW_URL'];
  const token = process.env['FOLLOW_TOKEN'];
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export function followConfigurado(): boolean {
  return configuracionFollow() !== null;
}

export class ErrorFollow extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFollow';
    this.codigo = codigo;
  }
}

interface PaginaFollow<T> {
  content?: T[];
}

async function consultar<T>(
  ruta: string,
  parametros: Record<string, string>,
  configuracion: ConfiguracionFollow,
): Promise<T[]> {
  const url = new URL(`${configuracion.url}${ruta}`);
  for (const [clave, valor] of Object.entries(parametros)) {
    url.searchParams.set(clave, valor);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      headers: { Authorization: configuracion.token, accept: 'application/json' },
      signal: AbortSignal.timeout(ESPERA_FOLLOW_MS),
    });
  } catch (error) {
    throw new ErrorFollow('FOLLOW_INALCANZABLE', (error as Error).message);
  }

  if (!respuesta.ok) {
    throw new ErrorFollow('FOLLOW_CON_ERROR', `${respuesta.status} en ${ruta}`);
  }

  const cuerpo = (await respuesta.json()) as PaginaFollow<T> | T[];
  if (Array.isArray(cuerpo)) return cuerpo;
  return cuerpo.content ?? [];
}

export interface ChoferFollow {
  id: string;
  nombre?: string;
  apellido?: string;
  documento?: string;
  legajo?: string;
  estado?: string;
  telefono?: string;
}

export interface VehiculoFollow {
  id: string;
  dominio?: string;
  modelo?: string;
  anioFabricacion?: string;
  marca?: { nombre?: string };
}

export interface PedidoFollow {
  id: string;
  numeroVisible?: string;
  nroPedido?: string;
  clienteNombre?: string;
  clienteCuit?: string;
  totalBultos?: number;
}

export async function buscarChoferesEnFollow(
  termino: string,
  configuracion = configuracionFollow(),
): Promise<ChoferFollow[]> {
  if (!configuracion) return [];
  return consultar<ChoferFollow>(
    '/api/chofer/listado',
    { searchParam: termino, size: String(LIMITE_BUSQUEDA_FOLLOW) },
    configuracion,
  );
}

export async function buscarVehiculosEnFollow(
  termino: string,
  configuracion = configuracionFollow(),
): Promise<VehiculoFollow[]> {
  if (!configuracion) return [];
  return consultar<VehiculoFollow>(
    '/api/vehiculo/listado',
    { searchParam: termino, size: String(LIMITE_BUSQUEDA_FOLLOW) },
    configuracion,
  );
}

export async function buscarPedidosEnFollow(
  termino: string,
  configuracion = configuracionFollow(),
): Promise<PedidoFollow[]> {
  if (!configuracion) return [];
  return consultar<PedidoFollow>(
    '/api/pedido-seguimiento/listado',
    { search: termino, size: String(LIMITE_BUSQUEDA_FOLLOW) },
    configuracion,
  );
}
