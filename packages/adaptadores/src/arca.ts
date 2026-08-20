import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import forge from 'node-forge';

export const SERVICIO_CONSTATACION = 'wscdc';

export const ENTORNOS_ARCA = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wscdc: 'https://wswhomo.afip.gov.ar/WSCDC/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wscdc: 'https://servicios1.afip.gov.ar/wscdc/service.asmx',
  },
} as const;

const SPACIO_WSCDC = 'http://servicios1.afip.gob.ar/wscdc/';

const CIFRADOS_ARCA = 'DEFAULT:@SECLEVEL=1';
const ESPERA_MS = 30_000;

export interface RespuestaSoap {
  estado: number;
  cuerpo: string;
}

export function pedirSoap(
  url: string,
  accion: string,
  sobre: string,
): Promise<RespuestaSoap> {
  const destino = new URL(url);

  return new Promise((resolver, rechazar) => {
    const pedido = request(
      {
        hostname: destino.hostname,
        port: destino.port || 443,
        path: `${destino.pathname}${destino.search}`,
        method: 'POST',
        ciphers: CIFRADOS_ARCA,
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          soapaction: accion,
          'content-length': Buffer.byteLength(sobre),
        },
      },
      (respuesta) => {
        const partes: Buffer[] = [];
        respuesta.on('data', (parte: Buffer) => partes.push(parte));
        respuesta.on('end', () => {
          resolver({
            estado: respuesta.statusCode ?? 0,
            cuerpo: Buffer.concat(partes).toString('utf8'),
          });
        });
      },
    );

    pedido.setTimeout(ESPERA_MS, () => {
      pedido.destroy(new Error(`ARCA no respondio en ${ESPERA_MS} ms.`));
    });

    pedido.on('error', rechazar);
    pedido.write(sobre);
    pedido.end();
  });
}

export const TIPOS_COMPROBANTE: Record<string, number> = {
  'FACTURA A': 1,
  'NOTA DE DEBITO A': 2,
  'NOTA DE CREDITO A': 3,
  'FACTURA B': 6,
  'NOTA DE DEBITO B': 7,
  'NOTA DE CREDITO B': 8,
  'FACTURA C': 11,
  'NOTA DE DEBITO C': 12,
  'NOTA DE CREDITO C': 13,
  'FACTURA M': 51,
  'NOTA DE DEBITO M': 52,
  'NOTA DE CREDITO M': 53,
  'FACTURA DE CREDITO ELECTRONICA MIPYME A': 201,
  'NOTA DE DEBITO ELECTRONICA MIPYME A': 202,
  'NOTA DE CREDITO ELECTRONICA MIPYME A': 203,
  'FACTURA DE CREDITO ELECTRONICA MIPYME B': 206,
  'NOTA DE DEBITO ELECTRONICA MIPYME B': 207,
  'NOTA DE CREDITO ELECTRONICA MIPYME B': 208,
  'FACTURA DE CREDITO ELECTRONICA MIPYME C': 211,
  'NOTA DE DEBITO ELECTRONICA MIPYME C': 212,
  'NOTA DE CREDITO ELECTRONICA MIPYME C': 213,
};

export function codigoDeComprobante(texto: unknown): number | null {
  const limpio = String(texto ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!limpio) return null;
  if (/^\d+$/.test(limpio)) return Number(limpio);
  if (TIPOS_COMPROBANTE[limpio]) return TIPOS_COMPROBANTE[limpio] ?? null;

  const letra = limpio.match(/\b([ABCM])\b/)?.[1];
  if (!letra) return null;

  if (limpio.includes('CREDITO')) return TIPOS_COMPROBANTE[`NOTA DE CREDITO ${letra}`] ?? null;
  if (limpio.includes('DEBITO')) return TIPOS_COMPROBANTE[`NOTA DE DEBITO ${letra}`] ?? null;
  if (limpio.includes('FACTURA')) return TIPOS_COMPROBANTE[`FACTURA ${letra}`] ?? null;
  return null;
}

export function partirComprobante(numero: unknown): { puntoVenta: number; numero: number } | null {
  const solo = String(numero ?? '').replace(/[^0-9-]/g, '');
  const partes = solo.split('-').filter(Boolean);
  if (partes.length !== 2) return null;

  const puntoVenta = Number(partes[0]);
  const correlativo = Number(partes[1]);
  if (!Number.isInteger(puntoVenta) || !Number.isInteger(correlativo)) return null;
  if (puntoVenta <= 0 || correlativo <= 0) return null;

  return { puntoVenta, numero: correlativo };
}

export function comoFechaArca(valor: unknown): string | null {
  const texto = String(valor ?? '').trim();
  if (/^\d{8}$/.test(texto)) return texto;

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;

  const local = texto.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (local) return `${local[3]}${local[2]}${local[1]}`;

  return null;
}

export interface ConfiguracionArca {
  cuit: string;
  certificado: string;
  clavePrivada: string;
  entorno: keyof typeof ENTORNOS_ARCA;
}

export function configuracionArca(): ConfiguracionArca | null {
  const cuit = process.env['ARCA_CUIT'];
  if (!cuit) return null;

  const certificado = process.env['ARCA_CERTIFICADO']
    ?? leerArchivo(process.env['ARCA_CERTIFICADO_RUTA']);
  const clavePrivada = process.env['ARCA_CLAVE_PRIVADA']
    ?? leerArchivo(process.env['ARCA_CLAVE_PRIVADA_RUTA']);

  if (!certificado || !clavePrivada) return null;

  const entorno = process.env['ARCA_ENTORNO'] === 'produccion' ? 'produccion' : 'homologacion';
  return { cuit: cuit.replace(/\D/g, ''), certificado, clavePrivada, entorno };
}

function leerArchivo(ruta: string | undefined): string | null {
  if (!ruta) return null;
  try {
    return readFileSync(ruta, 'utf8');
  } catch {
    return null;
  }
}

export function arcaConfigurado(): boolean {
  return configuracionArca() !== null;
}

export class ErrorArca extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorArca';
    this.codigo = codigo;
  }
}

export function armarTicketDeRequerimiento(servicio: string, ahora = new Date()): string {
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 10 * 60 * 1000);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '<header>',
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`,
    `<generationTime>${desde.toISOString()}</generationTime>`,
    `<expirationTime>${hasta.toISOString()}</expirationTime>`,
    '</header>',
    `<service>${servicio}</service>`,
    '</loginTicketRequest>',
  ].join('');
}

function oid(nombre: string): string {
  const valor = (forge.pki.oids as Record<string, string | undefined>)[nombre];
  if (!valor) throw new ErrorArca('OID_DESCONOCIDO', `node-forge no conoce el oid ${nombre}.`);
  return valor;
}

export function firmarTicket(
  ticket: string,
  certificado: string,
  clavePrivada: string,
): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(ticket, 'utf8');
  p7.addCertificate(certificado);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePrivada),
    certificate: forge.pki.certificateFromPem(certificado),
    digestAlgorithm: oid('sha256'),
    authenticatedAttributes: [
      { type: oid('contentType'), value: oid('data') },
      { type: oid('messageDigest') },
      { type: oid('signingTime'), value: new Date().toISOString() },
    ],
  });
  p7.sign();

  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export interface TicketAcceso {
  token: string;
  sign: string;
  expiraEn: Date;
}

const ticketsVigentes = new Map<string, TicketAcceso>();

export function limpiarTickets(): void {
  ticketsVigentes.clear();
}

function textoEntre(xml: string, etiqueta: string): string | null {
  const patron = new RegExp(`<${etiqueta}[^>]*>([\\s\\S]*?)</${etiqueta}>`, 'i');
  return xml.match(patron)?.[1]?.trim() ?? null;
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export async function obtenerTicketDeAcceso(
  configuracion: ConfiguracionArca,
  servicio = SERVICIO_CONSTATACION,
): Promise<TicketAcceso> {
  const clave = `${configuracion.entorno}:${configuracion.cuit}:${servicio}`;
  const vigente = ticketsVigentes.get(clave);
  if (vigente && vigente.expiraEn.getTime() - Date.now() > 60_000) return vigente;

  const firmado = firmarTicket(
    armarTicketDeRequerimiento(servicio),
    configuracion.certificado,
    configuracion.clavePrivada,
  );

  const sobre = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    ' xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    '<soapenv:Body><wsaa:loginCms>',
    `<wsaa:in0>${firmado}</wsaa:in0>`,
    '</wsaa:loginCms></soapenv:Body></soapenv:Envelope>',
  ].join('');

  let respuesta: RespuestaSoap;
  try {
    respuesta = await pedirSoap(ENTORNOS_ARCA[configuracion.entorno].wsaa, '', sobre);
  } catch (error) {
    throw new ErrorArca('WSAA_INALCANZABLE', (error as Error).message);
  }

  const cuerpo = respuesta.cuerpo;

  if (respuesta.estado < 200 || respuesta.estado >= 300) {
    const detalle = textoEntre(cuerpo, 'faultstring') ?? `${respuesta.estado}`;
    throw new ErrorArca('WSAA_RECHAZO', detalle);
  }

  const crudo = textoEntre(cuerpo, 'loginCmsReturn');
  if (!crudo) throw new ErrorArca('WSAA_SIN_TICKET', 'WSAA no devolvio un ticket de acceso.');

  const ticketXml = desescapar(crudo);
  const token = textoEntre(ticketXml, 'token');
  const sign = textoEntre(ticketXml, 'sign');
  const expiracion = textoEntre(ticketXml, 'expirationTime');

  if (!token || !sign) {
    throw new ErrorArca('WSAA_SIN_TICKET', 'El ticket de acceso no trae token ni sign.');
  }

  const ticket: TicketAcceso = {
    token,
    sign,
    expiraEn: expiracion ? new Date(expiracion) : new Date(Date.now() + 11 * 3600_000),
  };

  ticketsVigentes.set(clave, ticket);
  return ticket;
}

export interface ComprobanteAConstatar {
  modo: 'CAE' | 'CAI' | 'CAEA';
  cuitEmisor: string;
  puntoVenta: number;
  tipoComprobante: number;
  numero: number;
  fecha: string;
  importeTotal: number;
  codigoAutorizacion: string;
  tipoDocumentoReceptor?: string;
  numeroDocumentoReceptor?: string;
}

export interface ResultadoConstatacion {
  resultado: 'A' | 'O' | 'R';
  observaciones: { codigo: number; mensaje: string }[];
  errores: { codigo: number; mensaje: string }[];
  fechaProceso: string | null;
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function armarSobreConstatacion(
  ticket: TicketAcceso,
  cuitConsultante: string,
  comprobante: ComprobanteAConstatar,
): string {
  const receptor = comprobante.numeroDocumentoReceptor
    ? [
        `<DocTipoReceptor>${escapar(comprobante.tipoDocumentoReceptor ?? '80')}</DocTipoReceptor>`,
        `<DocNroReceptor>${escapar(comprobante.numeroDocumentoReceptor)}</DocNroReceptor>`,
      ].join('')
    : '';

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '<soap:Body>',
    `<ComprobanteConstatar xmlns="${SPACIO_WSCDC}">`,
    '<Auth>',
    `<Token>${escapar(ticket.token)}</Token>`,
    `<Sign>${escapar(ticket.sign)}</Sign>`,
    `<Cuit>${cuitConsultante}</Cuit>`,
    '</Auth>',
    '<CmpReq>',
    `<CbteModo>${comprobante.modo}</CbteModo>`,
    `<CuitEmisor>${comprobante.cuitEmisor}</CuitEmisor>`,
    `<PtoVta>${comprobante.puntoVenta}</PtoVta>`,
    `<CbteTipo>${comprobante.tipoComprobante}</CbteTipo>`,
    `<CbteNro>${comprobante.numero}</CbteNro>`,
    `<CbteFch>${comprobante.fecha}</CbteFch>`,
    `<ImpTotal>${comprobante.importeTotal}</ImpTotal>`,
    `<CodAutorizacion>${escapar(comprobante.codigoAutorizacion)}</CodAutorizacion>`,
    receptor,
    '</CmpReq>',
    '</ComprobanteConstatar>',
    '</soap:Body></soap:Envelope>',
  ].join('');
}

export function leerRespuestaConstatacion(xml: string): ResultadoConstatacion {
  const pares = (etiqueta: string) => {
    const bloque = textoEntre(xml, etiqueta);
    if (!bloque) return [];
    const items = bloque.match(/<(Obs|Err)>[\s\S]*?<\/(Obs|Err)>/g) ?? [];
    return items.map((item) => ({
      codigo: Number(textoEntre(item, 'Code') ?? 0),
      mensaje: textoEntre(item, 'Msg') ?? '',
    }));
  };

  const resultado = textoEntre(xml, 'Resultado');

  return {
    resultado: resultado === 'A' || resultado === 'O' ? resultado : 'R',
    observaciones: pares('Observaciones'),
    errores: pares('Errors'),
    fechaProceso: textoEntre(xml, 'FchProceso'),
  };
}

export async function constatarComprobante(
  comprobante: ComprobanteAConstatar,
  configuracion = configuracionArca(),
): Promise<ResultadoConstatacion> {
  if (!configuracion) {
    throw new ErrorArca('ARCA_NO_CONFIGURADO', 'Faltan el CUIT y el certificado de ARCA.');
  }

  const ticket = await obtenerTicketDeAcceso(configuracion);
  const sobre = armarSobreConstatacion(ticket, configuracion.cuit, comprobante);

  let respuesta: RespuestaSoap;
  try {
    respuesta = await pedirSoap(
      ENTORNOS_ARCA[configuracion.entorno].wscdc,
      `${SPACIO_WSCDC}ComprobanteConstatar`,
      sobre,
    );
  } catch (error) {
    throw new ErrorArca('ARCA_INALCANZABLE', (error as Error).message);
  }

  if (respuesta.estado < 200 || respuesta.estado >= 300) {
    const detalle = textoEntre(respuesta.cuerpo, 'faultstring') ?? `${respuesta.estado}`;
    throw new ErrorArca('ARCA_CON_ERROR', detalle);
  }

  return leerRespuestaConstatacion(respuesta.cuerpo);
}

export interface EstadoServicioArca {
  aplicacion: string;
  base: string;
  autenticacion: string;
}

export async function estadoDeArca(
  entorno: keyof typeof ENTORNOS_ARCA = 'homologacion',
): Promise<EstadoServicioArca> {
  const sobre = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    `<soap:Body><ComprobanteDummy xmlns="${SPACIO_WSCDC}" /></soap:Body>`,
    '</soap:Envelope>',
  ].join('');

  const { cuerpo } = await pedirSoap(
    ENTORNOS_ARCA[entorno].wscdc,
    `${SPACIO_WSCDC}ComprobanteDummy`,
    sobre,
  );

  return {
    aplicacion: textoEntre(cuerpo, 'AppServer') ?? 'DESCONOCIDO',
    base: textoEntre(cuerpo, 'DbServer') ?? 'DESCONOCIDO',
    autenticacion: textoEntre(cuerpo, 'AuthServer') ?? 'DESCONOCIDO',
  };
}
