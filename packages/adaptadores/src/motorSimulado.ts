import { createHash } from 'node:crypto';

import type {
  EntradaClasificacion,
  EntradaExtraccion,
  MotorDocumental,
  SalidaClasificacion,
  SalidaExtraccion,
} from './inteligencia.js';
import { ErrorMotorDocumental } from './inteligencia.js';

export interface GuionSimulado {
  clasificacion?: Partial<SalidaClasificacion>;
  campos?: Record<string, { valor: unknown; confianza: number; conEvidencia?: boolean }>;
  observaciones?: string[];
  items?: Record<string, unknown>[];
  falla?: 'SALIDA_ILEGIBLE' | 'PROVEEDOR_CAIDO';
}

const GUIONES = new Map<string, GuionSimulado>();

export function registrarGuion(huella: string, guion: GuionSimulado): void {
  GUIONES.set(huella, guion);
}

export function limpiarGuiones(): void {
  GUIONES.clear();
}

function huellaDe(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}

export class MotorSimulado implements MotorDocumental {
  async clasificar(entrada: EntradaClasificacion): Promise<SalidaClasificacion> {
    const guion = GUIONES.get(huellaDe(entrada.contenido));

    if (guion?.falla === 'PROVEEDOR_CAIDO') {
      throw new ErrorMotorDocumental('PROVEEDOR_CAIDO', 'El proveedor de IA no responde.');
    }

    if (guion?.clasificacion) {
      return {
        tipo: guion.clasificacion.tipo ?? 'REMITO',
        confianza: guion.clasificacion.confianza ?? 0.95,
        motivo: guion.clasificacion.motivo ?? 'guion de prueba',
      };
    }

    const porNombre = entrada.plantillasPosibles.find(
      (p) => entrada.nombreArchivo.toUpperCase().includes(p),
    );

    return {
      tipo: porNombre ?? entrada.plantillasPosibles[0] ?? 'DESCONOCIDO',
      confianza: porNombre ? 0.96 : 0.55,
      motivo: porNombre ? 'el nombre del archivo lo indica' : 'no hay senales claras',
    };
  }

  async extraer(entrada: EntradaExtraccion): Promise<SalidaExtraccion> {
    const guion = GUIONES.get(huellaDe(entrada.contenido));

    if (guion?.falla === 'PROVEEDOR_CAIDO') {
      throw new ErrorMotorDocumental('PROVEEDOR_CAIDO', 'El proveedor de IA no responde.');
    }

    if (guion?.falla === 'SALIDA_ILEGIBLE') {
      throw new ErrorMotorDocumental(
        'SALIDA_NO_PARSEABLE',
        'El modelo no devolvio un JSON interpretable.',
      );
    }

    const campos: Record<string, unknown> = {};

    for (const campo of entrada.plantilla.campos) {
      const guionado = guion?.campos?.[campo.clave];
      if (!guionado) continue;
      campos[campo.clave] = {
        valor: guionado.valor,
        confianza: guionado.confianza,
        evidencia: guionado.conEvidencia === false ? null : {
          pagina: 1,
          recorte: [0.1, 0.1, 0.4, 0.16],
          textoFuente: String(guionado.valor ?? '').slice(0, 120),
        },
      };
    }

    return {
      campos,
      items: guion?.items ?? [],
      observaciones: guion?.observaciones ?? [],
      uso: { proveedor: 'simulado', modelo: 'guion', entradas: 0, salidas: 0 },
    };
  }
}
