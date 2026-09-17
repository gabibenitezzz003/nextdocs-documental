import { cerrar } from './conexion.js';
import { provisionarInquilino } from './provisionar.js';

async function main(): Promise<void> {
  const inquilinoId = process.env['ALTA_INQUILINO_ID']?.trim();
  const nombre = process.env['ALTA_INQUILINO_NOMBRE']?.trim();
  const claveApi = process.env['NEXTDOCS_DOCUMENTAL_API_KEY']?.trim();

  if (!inquilinoId || !nombre || !claveApi) {
    throw new Error(
      'Falta ALTA_INQUILINO_ID, ALTA_INQUILINO_NOMBRE o NEXTDOCS_DOCUMENTAL_API_KEY.',
    );
  }

  await provisionarInquilino(inquilinoId, nombre, claveApi);

  console.log(`inquilino ${nombre} (${inquilinoId}) listo`);
}

await main().finally(() => cerrar());
