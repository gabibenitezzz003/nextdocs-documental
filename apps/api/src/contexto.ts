import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { conexion } from '@nextdocs/db';
import type { Actor } from '@nextdocs/nucleo';

import { ErrorApi } from './problemas.js';

export type Rol = 'ADMIN_INQUILINO' | 'OPERADOR' | 'REVISOR' | 'INTEGRACION' | 'SOLO_LECTURA';

export interface ContextoInquilino {
  inquilinoId: string;
  rol: Rol;
  actor: Actor;
  claveApiId: string | null;
  usuarioId: string | null;
}

const PERMISOS: Record<Rol, string[]> = {
  ADMIN_INQUILINO: ['leer', 'cargar', 'revisar', 'aprobar', 'administrar'],
  OPERADOR: ['leer', 'cargar', 'revisar'],
  REVISOR: ['leer', 'revisar', 'aprobar'],
  INTEGRACION: ['leer', 'cargar'],
  SOLO_LECTURA: ['leer'],
};

interface FilaClave {
  id: string;
  inquilino_id: string;
  rol: Rol;
}

interface FilaUsuario {
  id: string;
  inquilino_id: string;
  rol: Rol;
}

const RUTAS_ABIERTAS = new Set([
  '/salud',
  '/listo',
  '/openapi.json',
  '/documentacion',
  '/api/v1/simulador/erp',
  '/api/v1/simulador/whatsapp',
  '/api/v1/admin/inquilinos',
]);

function credencialDe(pedido: FastifyRequest): string | null {
  const cabecera = pedido.headers.authorization;
  if (typeof cabecera === 'string' && cabecera.toLowerCase().startsWith('bearer ')) {
    return cabecera.slice(7).trim();
  }
  const clave = pedido.headers['x-clave-api'];
  if (typeof clave === 'string' && clave.trim()) return clave.trim();
  return null;
}

async function porClaveApi(credencial: string): Promise<ContextoInquilino | null> {
  const huella = createHash('sha256').update(credencial).digest('hex');
  const { rows } = await conexion().query<FilaClave>(
    `SELECT id, inquilino_id, rol FROM clave_api WHERE huella = $1 AND activa`,
    [huella],
  );

  const fila = rows[0];
  if (!fila) return null;

  await conexion().query('UPDATE clave_api SET usada_en = now() WHERE id = $1', [fila.id]);

  return {
    inquilinoId: fila.inquilino_id,
    rol: fila.rol,
    actor: { tipo: 'API', id: fila.id },
    claveApiId: fila.id,
    usuarioId: null,
  };
}

async function porUsuario(credencial: string): Promise<ContextoInquilino | null> {
  if (!credencial.startsWith('usuario:')) return null;

  const email = credencial.slice(8).trim().toLowerCase();
  const { rows } = await conexion().query<FilaUsuario>(
    'SELECT id, inquilino_id, rol FROM usuario WHERE lower(email) = $1 AND activo',
    [email],
  );

  const fila = rows[0];
  if (!fila) return null;

  return {
    inquilinoId: fila.inquilino_id,
    rol: fila.rol,
    actor: { tipo: 'USUARIO', id: fila.id },
    claveApiId: null,
    usuarioId: fila.id,
  };
}

export function exigirPermiso(contexto: ContextoInquilino, permiso: string): void {
  const habilitados = PERMISOS[contexto.rol] ?? [];
  if (!habilitados.includes(permiso)) {
    throw new ErrorApi('SIN_PERMISO', `El rol ${contexto.rol} no puede ${permiso}.`);
  }
}

export function registrarContexto(servidor: FastifyInstance): void {
  servidor.addHook('onRequest', async (pedido: FastifyRequest, _respuesta: FastifyReply) => {
    if (RUTAS_ABIERTAS.has(pedido.url.split('?')[0] ?? '')) return;

    const credencial = credencialDe(pedido);
    if (!credencial) {
      throw new ErrorApi('NO_AUTENTICADO', 'Mandá la clave en Authorization: Bearer o en X-Clave-Api.');
    }

    const contexto = (await porUsuario(credencial)) ?? (await porClaveApi(credencial));
    if (!contexto) {
      throw new ErrorApi('NO_AUTENTICADO', 'La credencial no es valida o esta dada de baja.');
    }

    pedido.contexto = contexto;
  });
}
