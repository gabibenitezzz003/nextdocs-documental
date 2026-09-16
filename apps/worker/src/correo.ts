import { almacenamientoDeEntorno, correoConfigurado } from '@nextdocs/adaptadores';
import { despacharEnvios, type ResultadoDespacho } from '@nextdocs/nucleo';

const SIN_CORREO: ResultadoDespacho = { revisados: 0, enviados: 0, fallidos: 0 };

export async function despacharCorreos(): Promise<ResultadoDespacho> {
  if (!correoConfigurado()) return SIN_CORREO;
  return despacharEnvios(almacenamientoDeEntorno());
}
