import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import forge from 'node-forge';

import {
  ENTORNOS_ARCA,
  armarSobreConstatacion,
  armarTicketDeRequerimiento,
  arcaConfigurado,
  codigoDeComprobante,
  comoFechaArca,
  configuracionArca,
  constatarComprobante,
  estadoDeArca,
  firmarTicket,
  leerRespuestaConstatacion,
  limpiarTickets,
  partirComprobante,
  type ComprobanteAConstatar,
} from './arca.js';

const entornoOriginal = { ...process.env };

function certificadoDePrueba(): { certificado: string; clavePrivada: string } {
  const claves = forge.pki.rsa.generateKeyPair(2048);
  const certificado = forge.pki.createCertificate();

  certificado.publicKey = claves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date();
  certificado.validity.notAfter = new Date(Date.now() + 86400_000);

  const sujeto = [
    { name: 'commonName', value: 'docvance-prueba' },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'DocVance' },
  ];

  certificado.setSubject(sujeto);
  certificado.setIssuer(sujeto);
  certificado.sign(claves.privateKey, forge.md.sha256.create());

  return {
    certificado: forge.pki.certificateToPem(certificado),
    clavePrivada: forge.pki.privateKeyToPem(claves.privateKey),
  };
}

describe('codigos de comprobante de arca', () => {
  it('traduce los nombres que escribe la gente', () => {
    expect(codigoDeComprobante('Factura A')).toBe(1);
    expect(codigoDeComprobante('FACTURA B')).toBe(6);
    expect(codigoDeComprobante('factura c')).toBe(11);
    expect(codigoDeComprobante('Nota de Crédito A')).toBe(3);
    expect(codigoDeComprobante('NOTA DE DEBITO B')).toBe(7);
  });

  it('acepta el codigo numerico tal cual', () => {
    expect(codigoDeComprobante('1')).toBe(1);
    expect(codigoDeComprobante(201)).toBe(201);
  });

  it('no adivina cuando falta la letra', () => {
    expect(codigoDeComprobante('Factura')).toBeNull();
    expect(codigoDeComprobante('remito')).toBeNull();
    expect(codigoDeComprobante('')).toBeNull();
    expect(codigoDeComprobante(null)).toBeNull();
  });
});

describe('numero de comprobante', () => {
  it('separa punto de venta y correlativo', () => {
    expect(partirComprobante('0001-00001234')).toEqual({ puntoVenta: 1, numero: 1234 });
    expect(partirComprobante('A 0001-00001234')).toEqual({ puntoVenta: 1, numero: 1234 });
    expect(partirComprobante('4-8932')).toEqual({ puntoVenta: 4, numero: 8932 });
  });

  it('rechaza lo que no tiene forma de comprobante', () => {
    expect(partirComprobante('12345678')).toBeNull();
    expect(partirComprobante('0000-00000000')).toBeNull();
    expect(partirComprobante('sin numero')).toBeNull();
  });
});

describe('fecha para arca', () => {
  it('acepta los tres formatos que vienen de los documentos', () => {
    expect(comoFechaArca('2026-03-17')).toBe('20260317');
    expect(comoFechaArca('17/03/2026')).toBe('20260317');
    expect(comoFechaArca('20260317')).toBe('20260317');
  });

  it('devuelve null si no puede interpretarla', () => {
    expect(comoFechaArca('marzo de 2026')).toBeNull();
    expect(comoFechaArca(null)).toBeNull();
  });
});

describe('ticket de requerimiento', () => {
  it('pide el servicio con una ventana de vigencia valida', () => {
    const ahora = new Date('2026-08-20T12:00:00.000Z');
    const tra = armarTicketDeRequerimiento('wscdc', ahora);

    expect(tra).toContain('<service>wscdc</service>');
    expect(tra).toContain(`<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`);

    const generacion = tra.match(/<generationTime>(.*?)<\/generationTime>/)?.[1] ?? '';
    const expiracion = tra.match(/<expirationTime>(.*?)<\/expirationTime>/)?.[1] ?? '';

    expect(new Date(generacion).getTime()).toBeLessThan(ahora.getTime());
    expect(new Date(expiracion).getTime()).toBeGreaterThan(ahora.getTime());
  });

  it('firma el ticket en cms y devuelve base64', () => {
    const { certificado, clavePrivada } = certificadoDePrueba();
    const firmado = firmarTicket(armarTicketDeRequerimiento('wscdc'), certificado, clavePrivada);

    expect(firmado.length).toBeGreaterThan(500);
    expect(firmado).toMatch(/^[A-Za-z0-9+/=]+$/);

    const asn1 = forge.asn1.fromDer(forge.util.decode64(firmado));
    const p7 = forge.pkcs7.messageFromAsn1(asn1);
    expect(p7.type).toBe(forge.pki.oids.signedData);
  });
});

describe('configuracion de arca', () => {
  beforeEach(() => {
    delete process.env['ARCA_CUIT'];
    delete process.env['ARCA_CERTIFICADO'];
    delete process.env['ARCA_CLAVE_PRIVADA'];
  });

  afterEach(() => {
    process.env = { ...entornoOriginal };
    limpiarTickets();
  });

  it('no se considera configurado si falta el certificado', () => {
    process.env['ARCA_CUIT'] = '20123456786';
    expect(configuracionArca()).toBeNull();
    expect(arcaConfigurado()).toBe(false);
  });

  it('queda en homologacion salvo que se pida produccion', () => {
    process.env['ARCA_CUIT'] = '20-12345678-6';
    process.env['ARCA_CERTIFICADO'] = 'cert';
    process.env['ARCA_CLAVE_PRIVADA'] = 'clave';

    expect(configuracionArca()?.entorno).toBe('homologacion');
    expect(configuracionArca()?.cuit).toBe('20123456786');

    process.env['ARCA_ENTORNO'] = 'produccion';
    expect(configuracionArca()?.entorno).toBe('produccion');
  });

  it('avisa en vez de fallar raro cuando no hay credenciales', async () => {
    await expect(
      constatarComprobante({} as ComprobanteAConstatar, null),
    ).rejects.toThrow(/ARCA/);
  });
});

describe('sobre de constatacion', () => {
  const comprobante: ComprobanteAConstatar = {
    modo: 'CAE',
    cuitEmisor: '30712345678',
    puntoVenta: 1,
    tipoComprobante: 1,
    numero: 1234,
    fecha: '20260317',
    importeTotal: 68830000,
    codigoAutorizacion: '75123456789012',
    tipoDocumentoReceptor: '80',
    numeroDocumentoReceptor: '30710444442',
  };

  const ticket = { token: 'tok', sign: 'sig', expiraEn: new Date(Date.now() + 3600_000) };

  it('lleva la autenticacion y todos los datos del comprobante', () => {
    const sobre = armarSobreConstatacion(ticket, '20123456786', comprobante);

    expect(sobre).toContain('<Token>tok</Token>');
    expect(sobre).toContain('<Cuit>20123456786</Cuit>');
    expect(sobre).toContain('<CbteModo>CAE</CbteModo>');
    expect(sobre).toContain('<CuitEmisor>30712345678</CuitEmisor>');
    expect(sobre).toContain('<PtoVta>1</PtoVta>');
    expect(sobre).toContain('<CbteNro>1234</CbteNro>');
    expect(sobre).toContain('<CbteFch>20260317</CbteFch>');
    expect(sobre).toContain('<CodAutorizacion>75123456789012</CodAutorizacion>');
    expect(sobre).toContain('<DocNroReceptor>30710444442</DocNroReceptor>');
  });

  it('omite el receptor cuando no se conoce', () => {
    const sinReceptor = { ...comprobante };
    delete sinReceptor.numeroDocumentoReceptor;
    const sobre = armarSobreConstatacion(ticket, '20123456786', sinReceptor);
    expect(sobre).not.toContain('DocNroReceptor');
  });

  it('escapa los valores para no romper el xml', () => {
    const sobre = armarSobreConstatacion(
      { ...ticket, token: 'a<b&c' },
      '20123456786',
      comprobante,
    );
    expect(sobre).toContain('<Token>a&lt;b&amp;c</Token>');
  });
});

describe('respuesta de constatacion', () => {
  it('lee un comprobante aprobado', () => {
    const xml = `<CmpResponse><Resultado>A</Resultado><FchProceso>20260820120000</FchProceso>
      <Observaciones /></CmpResponse>`;
    const leido = leerRespuestaConstatacion(xml);

    expect(leido.resultado).toBe('A');
    expect(leido.fechaProceso).toBe('20260820120000');
    expect(leido.observaciones).toHaveLength(0);
  });

  it('lee las observaciones con su codigo', () => {
    const xml = `<CmpResponse><Resultado>O</Resultado><Observaciones>
      <Obs><Code>102</Code><Msg>El importe total no coincide</Msg></Obs>
      </Observaciones></CmpResponse>`;
    const leido = leerRespuestaConstatacion(xml);

    expect(leido.resultado).toBe('O');
    expect(leido.observaciones).toEqual([
      { codigo: 102, mensaje: 'El importe total no coincide' },
    ]);
  });

  it('trata como rechazado cualquier resultado que no entienda', () => {
    expect(leerRespuestaConstatacion('<CmpResponse></CmpResponse>').resultado).toBe('R');
  });

  it('lee los errores del servicio', () => {
    const xml = `<CmpResponse><Resultado>R</Resultado><Errors>
      <Err><Code>600</Code><Msg>CUIT no autorizado</Msg></Err></Errors></CmpResponse>`;
    expect(leerRespuestaConstatacion(xml).errores).toEqual([
      { codigo: 600, mensaje: 'CUIT no autorizado' },
    ]);
  });
});

describe('arca de verdad', () => {
  it('tiene las direcciones de los dos entornos', () => {
    expect(ENTORNOS_ARCA.homologacion.wscdc).toContain('wswhomo');
    expect(ENTORNOS_ARCA.produccion.wscdc).toContain('servicios1');
  });

  it.skipIf(!process.env['PROBAR_ARCA'])(
    'el servicio de homologacion responde que esta en pie',
    async () => {
      const estado = await estadoDeArca('homologacion');
      expect(estado.aplicacion).toBe('OK');
      expect(estado.base).toBe('OK');
      expect(estado.autenticacion).toBe('OK');
    },
    30_000,
  );
});
