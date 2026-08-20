import { createHash } from 'node:crypto';

import { REMITO, FACTURA } from '@docvance/dominio';

import { cerrar, enTransaccion } from './conexion.js';

const INQUILINO_DEMO = '11111111-1111-1111-1111-111111111111';

export const CLAVE_API_DEMO = 'dvk_demo_4f2a9c7b1e6d8035a1c4b9e2f7d60831';

const OBJETOS = [
  {
    tipo: 'PEDIDO',
    claveExterna: 'PED-100234',
    etiqueta: 'Pedido PED-100234 de Supermercados del Sur',
    atributos: {
      nroPedido: 'PED-100234',
      numero: '0004-00001234',
      cuitDestinatario: '30-71044444-2',
      razonSocialDestinatario: 'Supermercados del Sur SA',
      bultos: 12,
    },
  },
  {
    tipo: 'PEDIDO',
    claveExterna: 'PED-100235',
    etiqueta: 'Pedido PED-100235 de Distribuidora Norte',
    atributos: {
      nroPedido: 'PED-100235',
      numero: '0004-00001235',
      cuitDestinatario: '30-70999888-1',
      razonSocialDestinatario: 'Distribuidora Norte SRL',
      bultos: 8,
    },
  },
  {
    tipo: 'CLIENTE',
    claveExterna: 'CLI-0001',
    etiqueta: 'Supermercados del Sur SA',
    atributos: {
      cuitDestinatario: '30-71044444-2',
      razonSocialDestinatario: 'Supermercados del Sur SA',
    },
  },
  {
    tipo: 'VEHICULO',
    claveExterna: 'AB123CD',
    etiqueta: 'Camion AB123CD',
    atributos: { patente: 'AB123CD' },
  },
  {
    tipo: 'ORDEN_COMPRA',
    claveExterna: 'OC-55021',
    etiqueta: 'Orden de compra OC-55021',
    atributos: {
      nroOrdenCompra: 'OC-55021',
      cuitEmisor: '30-68888777-9',
      total: 184500,
    },
  },
  {
    tipo: 'PROVEEDOR',
    claveExterna: 'PRV-0009',
    etiqueta: 'Insumos Industriales SA',
    atributos: { cuitEmisor: '30-68888777-9' },
  },
];

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

    for (const objeto of OBJETOS) {
      await cliente.query(
        `INSERT INTO objeto_negocio (inquilino_id, tipo, clave_externa, etiqueta, atributos)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (inquilino_id, tipo, clave_externa)
         DO UPDATE SET etiqueta = EXCLUDED.etiqueta,
                       atributos = EXCLUDED.atributos,
                       estado = 'ABIERTO',
                       actualizado_en = now()`,
        [INQUILINO_DEMO, objeto.tipo, objeto.claveExterna, objeto.etiqueta, JSON.stringify(objeto.atributos)],
      );
    }

    await cliente.query(
      `INSERT INTO clave_api (inquilino_id, nombre, prefijo, huella, rol)
       VALUES ($1, $2, $3, $4, 'ADMIN_INQUILINO')
       ON CONFLICT (huella) DO UPDATE SET activa = true`,
      [
        INQUILINO_DEMO,
        'Clave de demostracion',
        CLAVE_API_DEMO.slice(0, 12),
        createHash('sha256').update(CLAVE_API_DEMO).digest('hex'),
      ],
    );

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

  process.stdout.write('sembrado: inquilino Demo Logistics, 3 usuarios, 2 plantillas y 6 objetos de negocio\n');
  process.stdout.write(`clave de api: ${CLAVE_API_DEMO}\n`);
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
