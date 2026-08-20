import { AlmacenamientoEnMemoria, AlmacenamientoS3, type Almacenamiento } from './almacenamiento.js';
import { MotorGemini } from './motorGemini.js';
import { MotorSimulado } from './motorSimulado.js';
import type { MotorDocumental } from './inteligencia.js';

export function motorDeEntorno(): MotorDocumental {
  const elegido = (process.env['PROVEEDOR_IA'] ?? 'simulado').toLowerCase();
  if (elegido === 'gemini') return new MotorGemini();
  if (elegido === 'simulado') return new MotorSimulado();
  throw new Error(`Proveedor de IA desconocido: ${elegido}`);
}

export function almacenamientoDeEntorno(): Almacenamiento {
  if ((process.env['ALMACENAMIENTO'] ?? 's3').toLowerCase() === 'memoria') {
    return new AlmacenamientoEnMemoria();
  }
  return new AlmacenamientoS3();
}
