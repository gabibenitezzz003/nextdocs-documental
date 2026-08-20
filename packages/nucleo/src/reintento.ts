import type { MotorDocumental } from '@docvance/adaptadores';
import {
  procesarCampos,
  type CampoPlantilla,
  type Plantilla,
  type ResultadoProcesado,
} from '@docvance/dominio';

export const MAXIMO_CAMPOS_REINTENTO = 6;

export function camposParaReintentar(
  plantilla: Plantilla,
  procesado: ResultadoProcesado,
): CampoPlantilla[] {
  const flojos = new Set(procesado.observados.map((c) => c.clave));

  return plantilla.campos
    .filter((campo) => campo.critico || campo.requerido)
    .filter((campo) => flojos.has(campo.clave))
    .slice(0, MAXIMO_CAMPOS_REINTENTO);
}

export interface ResultadoSegundaPasada {
  procesado: ResultadoProcesado;
  intentada: boolean;
  recuperados: string[];
}

export async function segundaPasada(
  motor: MotorDocumental,
  entrada: { contenido: Buffer; tipoMime: string; plantilla: Plantilla; pistas: string[] },
  procesado: ResultadoProcesado,
): Promise<ResultadoSegundaPasada> {
  const faltantes = camposParaReintentar(entrada.plantilla, procesado);
  if (!faltantes.length) return { procesado, intentada: false, recuperados: [] };

  const plantillaEnfocada: Plantilla = {
    ...entrada.plantilla,
    campos: faltantes,
    ...(entrada.plantilla.tabla ? {} : {}),
  };
  delete (plantillaEnfocada as { tabla?: unknown }).tabla;

  const pistas = [
    ...entrada.pistas,
    `Esta es una segunda lectura del mismo documento. En la primera no se pudieron leer con seguridad estos campos: ${faltantes.map((c) => c.clave).join(', ')}.`,
    'Miralos con mas detenimiento, incluso si estan en sellos, margenes, pies de pagina o texto girado.',
    'Si de verdad no estan en el documento, devolve null. No inventes.',
  ];

  let segunda;
  try {
    segunda = await motor.extraer({
      contenido: entrada.contenido,
      tipoMime: entrada.tipoMime,
      plantilla: plantillaEnfocada,
      pistas,
    });
  } catch {
    return { procesado, intentada: true, recuperados: [] };
  }

  const reprocesado = procesarCampos(plantillaEnfocada, segunda.campos);
  const recuperados: string[] = [];
  const valores = { ...procesado.valores };

  for (const campo of faltantes) {
    const nuevo = reprocesado.valores[campo.clave];
    const previo = valores[campo.clave];
    if (!nuevo) continue;
    if (nuevo.valorNormalizado === null || nuevo.valorNormalizado === undefined) continue;
    if (previo && previo.confianza >= nuevo.confianza) continue;

    valores[campo.clave] = nuevo;
    recuperados.push(campo.clave);
  }

  if (!recuperados.length) return { procesado, intentada: true, recuperados: [] };

  return {
    procesado: recalcular(entrada.plantilla, procesado, valores),
    intentada: true,
    recuperados,
  };
}

function recalcular(
  plantilla: Plantilla,
  original: ResultadoProcesado,
  valores: ResultadoProcesado['valores'],
): ResultadoProcesado {
  const observados = original.observados.filter((campo) => {
    const valor = valores[campo.clave];
    if (!valor) return true;
    const definicion = plantilla.campos.find((c) => c.clave === campo.clave);
    if (!definicion) return true;
    if (valor.valorNormalizado === null || valor.valorNormalizado === undefined) return true;
    return valor.confianza < definicion.umbral;
  });

  const confianzas = Object.values(valores).map((v) => v.confianza);
  const confianza = confianzas.length
    ? Math.round((confianzas.reduce((a, b) => a + b, 0) / confianzas.length) * 1000) / 1000
    : 0;

  return { ...original, valores, observados, confianza };
}
