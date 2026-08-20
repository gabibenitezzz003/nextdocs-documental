import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  correoConfigurado,
  enviarCorreo,
  type Adjunto,
  type Almacenamiento,
  type ErrorCorreo,
} from '@docvance/adaptadores';
import { conexion, enTransaccion } from '@docvance/db';

import { SISTEMA, auditar } from './auditoria.js';
import {
  asuntoDeCorreo,
  htmlDeCorreo,
  textoDeCorreo,
  type ContenidoCorreo,
} from './plantillaCorreo.js';

export const MAXIMO_DATOS_EN_CORREO = 10;
export const MAXIMO_ADJUNTO_BYTES = 8 * 1024 * 1024;
export const MAXIMO_INTENTOS_ENVIO = 5;

export interface Destinatario {
  id: string;
  nombre: string;
  correo: string;
  familias: string[];
  plantillas: string[];
  situaciones: string[];
}

export function leCorresponde(
  destinatario: Destinatario,
  documento: { familia: string | null; plantilla: string | null; situacion: string },
): boolean {
  if (!destinatario.situaciones.includes(documento.situacion)) return false;

  const porFamilia = !destinatario.familias.length
    || (documento.familia !== null && destinatario.familias.includes(documento.familia));

  const porPlantilla = !destinatario.plantillas.length
    || (documento.plantilla !== null && destinatario.plantillas.includes(documento.plantilla));

  if (destinatario.familias.length && destinatario.plantillas.length) {
    return porFamilia || porPlantilla;
  }

  return porFamilia && porPlantilla;
}

export async function destinatariosDe(
  inquilinoId: string,
  documento: { familia: string | null; plantilla: string | null; situacion: string },
): Promise<Destinatario[]> {
  const { rows } = await conexion().query<{
    id: string;
    nombre: string;
    correo: string;
    familias: string[];
    plantillas: string[];
    situaciones: string[];
  }>(
    `SELECT id, nombre, correo, familias, plantillas, situaciones
       FROM destinatario_documental
      WHERE inquilino_id = $1 AND activo`,
    [inquilinoId],
  );

  return rows.filter((destinatario) => leCorresponde(destinatario, documento));
}

export async function programarEnvios(
  cliente: PoolClient,
  entrada: {
    inquilinoId: string;
    documentoId: string;
    familia: string | null;
    plantilla: string | null;
    situacion: string;
    asunto: string;
  },
): Promise<number> {
  const destinatarios = await destinatariosDe(entrada.inquilinoId, entrada);
  if (!destinatarios.length) return 0;

  for (const destinatario of destinatarios) {
    await cliente.query(
      `INSERT INTO envio_documental
         (id, inquilino_id, documento_id, destinatario, asunto, motivo)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (documento_id, destinatario, motivo) DO NOTHING`,
      [
        randomUUID(),
        entrada.inquilinoId,
        entrada.documentoId,
        destinatario.correo,
        entrada.asunto,
        entrada.situacion,
      ],
    );
  }

  return destinatarios.length;
}

interface FilaEnvio {
  id: string;
  inquilino_id: string;
  documento_id: string;
  destinatario: string;
  motivo: string;
  intentos: number;
  nombre_archivo: string;
  tipo_mime: string;
  plantilla_codigo: string | null;
  estado: string;
  confianza: string | null;
  sujeto_tipo: string | null;
  sujeto_id: string | null;
  clave_almacen: string;
}

export async function enviosPendientes(limite = 20): Promise<FilaEnvio[]> {
  const { rows } = await conexion().query<FilaEnvio>(
    `SELECT e.id, e.inquilino_id, e.documento_id, e.destinatario, e.motivo, e.intentos,
            d.nombre_archivo, d.tipo_mime, d.plantilla_codigo, d.estado, d.confianza,
            d.sujeto_tipo, d.sujeto_id, a.clave_almacen
       FROM envio_documental e
       JOIN documento d ON d.id = e.documento_id
       JOIN archivo_documento a ON a.documento_id = d.id AND a.version = 1
      WHERE e.estado = 'PENDIENTE' AND e.intentos < $1
      ORDER BY e.creado_en ASC
      LIMIT $2`,
    [MAXIMO_INTENTOS_ENVIO, limite],
  );
  return rows;
}

async function armarContenido(envio: FilaEnvio): Promise<ContenidoCorreo> {
  const { rows: valores } = await conexion().query<{ clave: string; valor_normalizado: unknown }>(
    `SELECT v.clave, v.valor_normalizado
       FROM valor_extraido v
       JOIN corrida_extraccion c ON c.id = v.corrida_id
      WHERE c.documento_id = $1 AND v.presencia = 'PRESENTE'
      ORDER BY v.confianza DESC
      LIMIT $2`,
    [envio.documento_id, MAXIMO_DATOS_EN_CORREO],
  );

  const { rows: validaciones } = await conexion().query<{ hallazgos: unknown }>(
    `SELECT hallazgos FROM corrida_validacion
      WHERE documento_id = $1 ORDER BY terminado_en DESC LIMIT 1`,
    [envio.documento_id],
  );

  const hallazgos = Array.isArray(validaciones[0]?.hallazgos)
    ? (validaciones[0]?.hallazgos as { codigo: string; severidad: string; mensaje: string }[])
    : [];

  const titulos: Record<string, string> = {
    APROBADO: 'Documento aprobado',
    OBSERVADO: 'Documento para revisar',
    RECHAZADO: 'Documento rechazado',
    VENCIDO: 'Documento vencido',
    POR_VENCER: 'Documento por vencer',
  };

  const bajadas: Record<string, string> = {
    APROBADO: 'Se leyo, se valido y quedo listo para procesar.',
    OBSERVADO: 'Se leyo pero necesita que alguien lo mire antes de seguir.',
    RECHAZADO: 'Se rechazo y no continua el circuito.',
    VENCIDO: 'La vigencia de este documento ya paso.',
    POR_VENCER: 'La vigencia de este documento esta por terminar.',
  };

  const base = process.env['IA_DOCS_URL_PUBLICA'] ?? null;

  return {
    titulo: titulos[envio.motivo] ?? 'Documento procesado',
    bajada: bajadas[envio.motivo] ?? 'Novedad sobre un documento.',
    documento: envio.nombre_archivo,
    tipo: envio.plantilla_codigo ?? 'Sin clasificar',
    estado: envio.motivo,
    confianza: envio.confianza === null ? null : `${Math.round(Number(envio.confianza) * 100)}%`,
    datos: valores.map((v) => ({
      etiqueta: v.clave,
      valor: v.valor_normalizado === null ? '-' : String(v.valor_normalizado),
    })),
    hallazgos: hallazgos
      .filter((h) => h.severidad !== 'info')
      .slice(0, 6)
      .map((h) => ({ codigo: h.codigo, severidad: h.severidad, mensaje: h.mensaje })),
    asociadoA: envio.sujeto_id ? `${envio.sujeto_tipo} ${envio.sujeto_id}` : null,
    enlace: base ? `${base.replace(/\/+$/, '')}/carga/ia-docs` : null,
    piePersonalizado: null,
  };
}

export interface ResultadoDespacho {
  revisados: number;
  enviados: number;
  fallidos: number;
}

export async function despacharEnvios(
  almacenamiento: Almacenamiento,
  limite = 20,
): Promise<ResultadoDespacho> {
  if (!correoConfigurado()) return { revisados: 0, enviados: 0, fallidos: 0 };

  const pendientes = await enviosPendientes(limite);
  let enviados = 0;
  let fallidos = 0;

  for (const envio of pendientes) {
    try {
      const contenido = await armarContenido(envio);

      const adjuntos: Adjunto[] = [];
      try {
        const original = await almacenamiento.leer(envio.clave_almacen);
        if (original.length <= MAXIMO_ADJUNTO_BYTES) {
          adjuntos.push({
            nombre: envio.nombre_archivo,
            contenido: original,
            tipoMime: envio.tipo_mime,
          });
        }
      } catch {
        adjuntos.length = 0;
      }

      await enviarCorreo({
        para: envio.destinatario,
        asunto: asuntoDeCorreo(contenido),
        html: htmlDeCorreo(contenido),
        texto: textoDeCorreo(contenido),
        adjuntos,
      });

      await enTransaccion(async (cliente) => {
        await cliente.query(
          `UPDATE envio_documental
              SET estado = 'ENVIADO', enviado_en = now(), intentos = intentos + 1
            WHERE id = $1`,
          [envio.id],
        );

        await auditar(cliente, {
          inquilinoId: envio.inquilino_id,
          tipoAgregado: 'documento',
          agregadoId: envio.documento_id,
          accion: 'CORREO_ENVIADO',
          actor: SISTEMA,
          origen: 'DISTRIBUCION',
          despues: {
            destinatario: envio.destinatario,
            motivo: envio.motivo,
            conAdjunto: adjuntos.length > 0,
          },
        });
      });

      enviados += 1;
    } catch (error) {
      const e = error as ErrorCorreo;
      const agotado = envio.intentos + 1 >= MAXIMO_INTENTOS_ENVIO;

      await conexion().query(
        `UPDATE envio_documental
            SET estado = $1, intentos = intentos + 1, ultimo_error = $2
          WHERE id = $3`,
        [agotado ? 'FALLIDO' : 'PENDIENTE', e.message.slice(0, 400), envio.id],
      );

      fallidos += 1;
    }
  }

  return { revisados: pendientes.length, enviados, fallidos };
}
