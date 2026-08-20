import {
  almacenamientoDeEntorno,
  encolar,
  type Almacenamiento,
} from '@docvance/adaptadores';

export interface Dependencias {
  almacenamiento: Almacenamiento;
  encolar: typeof encolar;
}

let unicas: Dependencias | null = null;

export function dependencias(): Dependencias {
  if (!unicas) {
    unicas = { almacenamiento: almacenamientoDeEntorno(), encolar };
  }
  return unicas;
}

export function usarDependencias(propias: Dependencias): void {
  unicas = propias;
}
