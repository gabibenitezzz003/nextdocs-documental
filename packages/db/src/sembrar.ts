import { REMITO, FACTURA } from '@docvance/dominio';

import { cerrar, enTransaccion } from './conexion.js';

const INQUILINO_DEMO = '11111111-1111-1111-1111-111111111111';

const USUARIOS = [
  { email: 'admin@demo.local', nombre: 'Ana Administradora', rol: 'ADMIN_INQUILINO' },
  { email: 'operador@demo.local', nombre: 'Bruno Operador', rol: 'OPERADOR' },
  { email: 'revisor@demo.local', nombre: 'Carla Revisora', rol: 'REVISOR' },
];

export async function sembrar(): Promise<void> {
  await enTransaccion(async (cliente) => {
    await cliente.query(
      `INSERT INTO inquilino (id, nombre, plan)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [INQUILINO_DEMO, 'Demo Logistics', 'BUSINESS'],
    );

    for (const usuario of USUARIOS) {
      await cliente.query(
        `INSERT INTO usuario (inquilino_id, email, nombre, rol)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (inquilino_id, email) DO UPDATE SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol`,
        [INQUILINO_DEMO, usuario.email, usuario.nombre, usuario.rol],
      );
    }

    for (const plantilla of [REMITO, FACTURA]) {
      await cliente.query(
        `INSERT INTO plantilla_documental
           (inquilino_id, codigo, nombre, version, estado, umbral_auto_aprobacion,
            politica_fisica, definicion, publicado_en)
         VALUES ($1, $2, $3, $4, 'PUBLICADA', $5, $6, $7, now())
         ON CONFLICT (inquilino_id, codigo, version)
         DO UPDATE SET definicion = EXCLUDED.definicion, nombre = EXCLUDED.nombre`,
        [
          INQUILINO_DEMO,
          plantilla.codigo,
          plantilla.nombre,
          plantilla.version,
          plantilla.umbralAutoAprobacion,
          plantilla.politicaFisica,
          JSON.stringify(plantilla),
        ],
      );
    }

    await cliente.query(
      `INSERT INTO suscripcion_webhook (inquilino_id, url, secreto, tipos_evento)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        INQUILINO_DEMO,
        'http://localhost:4000/api/v1/simulador/erp',
        'secreto-demo',
        ['documento.aprobado', 'documento.observado'],
      ],
    );
  });

  process.stdout.write('sembrado: inquilino Demo Logistics con 3 usuarios y 2 plantillas\n');
}

const ejecutadoDirecto = process.argv[1]?.includes('sembrar');

if (ejecutadoDirecto) {
  sembrar()
    .then(async () => {
      await cerrar();
      process.exit(0);
    })
    .catch(async (error: Error) => {
      process.stderr.write(`${error.message}\n`);
      await cerrar();
      process.exit(1);
    });
}
