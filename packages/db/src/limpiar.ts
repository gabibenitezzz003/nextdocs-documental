import { cerrar, conexion, enTransaccion } from './conexion.js';

const TABLAS_OPERATIVAS = [
  'envio_documental',
  'correccion_aprendida',
  'entrega_webhook',
  'evento_salida',
  'evento_auditoria',
  'clave_idempotencia',
  'documento',
];

export interface ResumenLimpieza {
  borradas: Record<string, number>;
  objetosDeNegocio: number;
  destinatarios: number;
}

export async function limpiar(opciones: {
  incluirCatalogo?: boolean;
  incluirDestinatarios?: boolean;
} = {}): Promise<ResumenLimpieza> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Limpiar borra documentos y auditoria. No corre en produccion.');
  }

  const borradas: Record<string, number> = {};
  let objetosDeNegocio = 0;
  let destinatarios = 0;

  await enTransaccion(async (cliente) => {
    for (const tabla of TABLAS_OPERATIVAS) {
      const { rowCount } = await cliente.query(`DELETE FROM ${tabla}`);
      borradas[tabla] = rowCount ?? 0;
    }

    if (opciones.incluirCatalogo) {
      const { rowCount } = await cliente.query('DELETE FROM objeto_negocio');
      objetosDeNegocio = rowCount ?? 0;
    }

    if (opciones.incluirDestinatarios) {
      const { rowCount } = await cliente.query('DELETE FROM destinatario_documental');
      destinatarios = rowCount ?? 0;
    }
  });

  return { borradas, objetosDeNegocio, destinatarios };
}

const ejecutadoDirecto = process.argv[1]?.includes('limpiar');

if (ejecutadoDirecto) {
  const incluirCatalogo = process.argv.includes('--catalogo');
  const incluirDestinatarios = process.argv.includes('--destinatarios');

  limpiar({ incluirCatalogo, incluirDestinatarios })
    .then(async (resumen) => {
      const total = Object.values(resumen.borradas).reduce((a, b) => a + b, 0);
      process.stdout.write(`borrados ${total} registros operativos\n`);

      for (const [tabla, cantidad] of Object.entries(resumen.borradas)) {
        if (cantidad) process.stdout.write(`  ${tabla}: ${cantidad}\n`);
      }

      if (incluirCatalogo) {
        process.stdout.write(`  objeto_negocio: ${resumen.objetosDeNegocio}\n`);
      }
      if (incluirDestinatarios) {
        process.stdout.write(`  destinatario_documental: ${resumen.destinatarios}\n`);
      }

      process.stdout.write('quedan el inquilino, los usuarios, las plantillas y la clave de api\n');

      const { rows } = await conexion().query<{ clave_almacen: string }>(
        'SELECT clave_almacen FROM archivo_documento LIMIT 1',
      );
      if (!rows.length) {
        process.stdout.write(
          'los originales quedaron huerfanos en MinIO, se limpian con pnpm infra:limpiar\n',
        );
      }

      await cerrar();
      process.exit(0);
    })
    .catch(async (error: Error) => {
      process.stderr.write(`${error.message}\n`);
      await cerrar();
      process.exit(1);
    });
}
