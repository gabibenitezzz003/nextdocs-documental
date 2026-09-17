import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cerrar,
  conexion,
  exigirBaseDePruebas,
  migrar,
  usarBaseDePruebas,
} from '@nextdocs/db';

import { armarServidor } from '../servidor.js';

const CLAVE_PLATAFORMA = 'admin_de_pruebas_0123456789abcdef';
const URL_DESTINO = 'http://workflow:8091/api/v1/documental/eventos/aaaa';

const SECRETO_A = 'secreto_de_pruebas_000000000000001';
const SECRETO_B = 'secreto_de_pruebas_000000000000002';

describe('rutas de administracion', () => {
  let servidor: Awaited<ReturnType<typeof armarServidor>>;
  let claveApi = '';

  beforeAll(async () => {
    process.env['ADMIN_CLAVE'] = CLAVE_PLATAFORMA;
    await usarBaseDePruebas();
    exigirBaseDePruebas();
    await migrar();
    await conexion().query('TRUNCATE inquilino CASCADE');
    servidor = await armarServidor();
  });

  afterAll(async () => {
    await servidor?.close();
    await conexion().query('TRUNCATE inquilino CASCADE');
    await cerrar();
  });

  it('rechaza la suscripcion sin credencial de plataforma', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/suscripciones',
      payload: { url: URL_DESTINO },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('rechaza una credencial de plataforma incorrecta', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/suscripciones',
      headers: { authorization: 'Bearer clave_incorrecta_xxxxxxxx' },
      payload: { url: URL_DESTINO },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('provisiona un inquilino y devuelve su clave', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/inquilinos',
      headers: { authorization: `Bearer ${CLAVE_PLATAFORMA}` },
      payload: {
        inquilinoId: '33333333-3333-3333-3333-333333333333',
        nombre: 'Inquilino de prueba',
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json();
    expect(cuerpo.clave).toMatch(/^ndk_/);
    claveApi = cuerpo.clave;
  });

  it('resuelve el inquilino por la clave de api y crea la suscripcion', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/suscripciones',
      headers: { authorization: `Bearer ${CLAVE_PLATAFORMA}` },
      payload: {
        claveApi,
        url: URL_DESTINO,
        secreto: SECRETO_A,
        tiposEvento: ['documento.aprobado'],
      },
    });
    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json();
    expect(cuerpo.inquilinoId).toBe('33333333-3333-3333-3333-333333333333');

    const { rows } = await conexion().query(
      'SELECT secreto, tipos_evento, estado FROM suscripcion_webhook WHERE id = $1',
      [cuerpo.id],
    );
    expect(rows[0]?.secreto).toBe(SECRETO_A);
    expect(rows[0]?.tipos_evento).toEqual(['documento.aprobado']);
    expect(rows[0]?.estado).toBe('ACTIVA');
  });

  it('repetir el alta con la misma url actualiza en vez de duplicar', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/suscripciones',
      headers: { authorization: `Bearer ${CLAVE_PLATAFORMA}` },
      payload: {
        claveApi,
        url: URL_DESTINO,
        secreto: SECRETO_B,
        tiposEvento: [],
      },
    });
    expect(respuesta.statusCode).toBe(201);

    const { rows } = await conexion().query(
      'SELECT id, secreto FROM suscripcion_webhook WHERE url = $1',
      [URL_DESTINO],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.secreto).toBe(SECRETO_B);
  });

  it('rechaza una suscripcion sin inquilino resoluble', async () => {
    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/v1/admin/suscripciones',
      headers: { authorization: `Bearer ${CLAVE_PLATAFORMA}` },
      payload: { url: 'http://workflow:8091/otra', secreto: SECRETO_A },
    });
    expect(respuesta.statusCode).toBe(422);
  });

  it('elimina la suscripcion por inquilino y url', async () => {
    const respuesta = await servidor.inject({
      method: 'DELETE',
      url: '/api/v1/admin/suscripciones',
      headers: { authorization: `Bearer ${CLAVE_PLATAFORMA}` },
      payload: {
        inquilinoId: '33333333-3333-3333-3333-333333333333',
        url: URL_DESTINO,
      },
    });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().eliminadas).toBe(1);
  });
});
