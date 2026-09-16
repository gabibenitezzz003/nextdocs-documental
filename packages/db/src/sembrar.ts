import { createHash } from 'node:crypto';

import { PLANTILLAS_BASE } from '@nextdocs/dominio';

import { cerrar, enTransaccion } from './conexion.js';

const INQUILINO_DEMO = '11111111-1111-1111-1111-111111111111';

const CLAVE_API_DEMO_POR_DEFECTO = 'ndk_demo_4f2a9c7b1e6d8035a1c4b9e2f7d60831';

export function claveApiDemo(): string {
  const configurada = process.env['NEXTDOCS_DOCUMENTAL_API_KEY']?.trim();
  return configurada || CLAVE_API_DEMO_POR_DEFECTO;
}

const VIGENCIAS_DEMO = [
  { plantilla: 'VTV', familia: 'VEHICULAR', archivo: 'vtv-AB123CD.pdf', dias: -45, sujeto: 'AB123CD' },
  { plantilla: 'VTV', familia: 'VEHICULAR', archivo: 'vtv-MJK889.pdf', dias: 12, sujeto: 'MJK889' },
  { plantilla: 'SEGURO_VEHICULAR', familia: 'VEHICULAR', archivo: 'poliza-AB123CD.pdf', dias: -8, sujeto: 'AB123CD' },
  { plantilla: 'SEGURO_VEHICULAR', familia: 'VEHICULAR', archivo: 'poliza-MJK889.pdf', dias: 96, sujeto: 'MJK889' },
  { plantilla: 'LICENCIA_CONDUCIR', familia: 'IDENTIDAD', archivo: 'licencia-ferreyra.pdf', dias: 21, sujeto: '23957446' },
  { plantilla: 'LICENCIA_CONDUCIR', familia: 'IDENTIDAD', archivo: 'licencia-cabrera.pdf', dias: 240, sujeto: '29557946' },
  { plantilla: 'CEDULA_VEHICULAR', familia: 'VEHICULAR', archivo: 'cedula-AB123CD.pdf', dias: 410, sujeto: 'AB123CD' },
  { plantilla: 'DNI', familia: 'IDENTIDAD', archivo: 'dni-prado.jpg', dias: -120, sujeto: '20369335201' },
];

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
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'El sembrado crea usuarios y una clave de api conocida. No corre en produccion.',
    );
  }

  const claveApi = claveApiDemo();

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

    for (const plantilla of Object.values(PLANTILLAS_BASE)) {
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
        'Clave de desarrollo local',
        claveApi.slice(0, 12),
        createHash('sha256').update(claveApi).digest('hex'),
      ],
    );

    const conVigenciasDemo = process.env['SEMBRAR_VIGENCIAS_DEMO'] !== 'false';

    for (const vigencia of conVigenciasDemo ? VIGENCIAS_DEMO : []) {
      await cliente.query(
        `INSERT INTO documento
           (inquilino_id, origen, huella, tipo_mime, nombre_archivo, estado, plantilla_codigo,
            familia, vence_en, confianza, sujeto_tipo, sujeto_id)
         SELECT $1, 'DEMOSTRACION', $2, $3, $4, 'APROBADO', $5, $6,
                CURRENT_DATE + ($7)::integer, 0.96, $8, $9
          WHERE NOT EXISTS (
            SELECT 1 FROM documento WHERE inquilino_id = $1 AND huella = $2
          )`,
        [
          INQUILINO_DEMO,
          createHash('sha256').update(`demo:${vigencia.archivo}`).digest('hex'),
          vigencia.archivo.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
          vigencia.archivo,
          vigencia.plantilla,
          vigencia.familia,
          vigencia.dias,
          vigencia.familia === 'IDENTIDAD' ? 'CHOFER' : 'VEHICULO',
          vigencia.sujeto,
        ],
      );
    }

    await cliente.query(
      `INSERT INTO suscripcion_webhook (inquilino_id, url, secreto, tipos_evento)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (inquilino_id, url) DO UPDATE SET tipos_evento = EXCLUDED.tipos_evento`,
      [
        INQUILINO_DEMO,
        'http://localhost:4000/api/v1/simulador/erp',
        'secreto-demo',
        ['documento.aprobado', 'documento.observado'],
      ],
    );
  });

  process.stdout.write(`sembrado: inquilino Demo Logistics, 3 usuarios, ${Object.keys(PLANTILLAS_BASE).length} plantillas y 6 objetos de negocio\n`);
  process.stdout.write(`clave de api: ${claveApi}\n`);
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
