import { cerrar } from '@nextdocs/db';
import { cerrarColas, cerrarRedis } from '@nextdocs/adaptadores';

import { configuracion } from './configuracion.js';
import { armarServidor } from './servidor.js';

const ajustes = configuracion();
const servidor = await armarServidor();

async function apagar(senal: string): Promise<void> {
  servidor.log.info({ senal }, 'apagando la api');
  await servidor.close();
  await cerrarColas();
  await cerrarRedis();
  await cerrar();
  process.exit(0);
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    void apagar(senal);
  });
}

try {
  await servidor.listen({ port: ajustes.puerto, host: ajustes.anfitrion });
  servidor.log.info(`documentacion en http://localhost:${ajustes.puerto}/documentacion`);
} catch (error) {
  servidor.log.error(error);
  process.exit(1);
}
