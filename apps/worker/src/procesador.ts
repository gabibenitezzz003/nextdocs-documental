import type { Job } from 'bullmq';

import {
  almacenamientoDeEntorno,
  motorDeEntorno,
  type Almacenamiento,
  type MotorDocumental,
} from '@docvance/adaptadores';
import {
  buscarObjetosCombinado,
  procesarDocumento,
  type ResultadoProcesamiento,
} from '@docvance/nucleo';

export interface TrabajoProcesamiento {
  documentoId: string;
  inquilinoId: string;
  correlacionId: string;
  intento: number;
}

let almacenamiento: Almacenamiento | null = null;
let motor: MotorDocumental | null = null;

function dependencias(): { almacenamiento: Almacenamiento; motor: MotorDocumental; buscarObjetos: typeof buscarObjetosCombinado } {
  if (!almacenamiento) almacenamiento = almacenamientoDeEntorno();
  if (!motor) motor = motorDeEntorno();
  return { almacenamiento, motor, buscarObjetos: buscarObjetosCombinado };
}

export async function procesar(trabajo: Job<TrabajoProcesamiento>): Promise<ResultadoProcesamiento> {
  const { documentoId, correlacionId } = trabajo.data;
  return procesarDocumento(documentoId, correlacionId, dependencias(), {
    intento: trabajo.attemptsMade + 1,
    intentosMaximos: trabajo.opts.attempts ?? 1,
  });
}
