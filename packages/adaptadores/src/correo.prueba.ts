import { afterEach, describe, expect, it } from 'vitest';

import { configuracionCorreo } from './correo.js';

const entornoOriginal = { ...process.env };

afterEach(() => {
  process.env = { ...entornoOriginal };
});

describe('configuracion de correo', () => {
  it('usa Mailpit local cuando no hay SMTP configurado en desarrollo', () => {
    delete process.env['NODE_ENV'];
    process.env['CORREO_ANFITRION'] = '';
    process.env['CORREO_PUERTO'] = '';

    expect(configuracionCorreo()).toMatchObject({
      anfitrion: 'localhost',
      puerto: 1025,
      seguro: false,
    });
  });

  it('no inventa un SMTP en produccion', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORREO_ANFITRION'] = '';

    expect(configuracionCorreo()).toBeNull();
  });

  it('respeta un SMTP configurado explicitamente', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORREO_ANFITRION'] = 'smtp.example.com';
    process.env['CORREO_PUERTO'] = '465';
    process.env['CORREO_USUARIO'] = 'usuario';
    process.env['CORREO_CLAVE'] = 'secreto';

    expect(configuracionCorreo()).toMatchObject({
      anfitrion: 'smtp.example.com',
      puerto: 465,
      seguro: true,
      usuario: 'usuario',
      clave: 'secreto',
    });
  });

  it('rechaza un puerto SMTP invalido', () => {
    delete process.env['NODE_ENV'];
    process.env['CORREO_ANFITRION'] = 'localhost';
    process.env['CORREO_PUERTO'] = 'abc';

    expect(() => configuracionCorreo()).toThrow(/Puerto SMTP invalido/);
  });
});
