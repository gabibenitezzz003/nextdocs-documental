import type { Job } from 'bullmq';

import {
  almacenamientoDeEntorno,
  encolar,
  motorDeEntorno,
  type Almacenamiento,
  type MotorDocumental,
} from '@nextdocs/adaptadores';
import {
  buscarObjetosCombinado,
  procesarDocumento,
  type DependenciasProcesamiento,
  type ResultadoProcesamiento,
} from '@nextdocs/nucleo';

export interface TrabajoProcesamiento {
  documentoId: string;
  inquilinoId: string;
  correlacionId: string;
  intento: number;
}

let almacenamiento: Almacenamiento | null = null;
let motor: MotorDocumental | null = null;

function dependencias(): DependenciasProcesamiento {
  if (!almacenamiento) almacenamiento = almacenamientoDeEntorno();
  if (!motor) motor = motorDeEntorno();
  return { almacenamiento, motor, buscarObjetos: buscarObjetosCombinado, encolar };
}

export async function procesar(trabajo: Job<TrabajoProcesamiento>): Promise<ResultadoProcesamiento> {
  const { documentoId, correlacionId } = trabajo.data;
  return procesarDocumento(documentoId, correlacionId, dependencias(), {
    intento: trabajo.attemptsMade + 1,
    intentosMaximos: trabajo.opts.attempts ?? 1,
  });
}
