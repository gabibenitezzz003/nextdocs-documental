import { createTransport, type Transporter } from 'nodemailer';

export interface ConfiguracionCorreo {
  anfitrion: string;
  puerto: number;
  seguro: boolean;
  usuario: string | null;
  clave: string | null;
  remitente: string;
}

export function configuracionCorreo(): ConfiguracionCorreo | null {
  const esProduccion = process.env['NODE_ENV'] === 'production';
  const anfitrionConfigurado = process.env['CORREO_ANFITRION']?.trim() ?? '';

  // En desarrollo NextDocs Documental usa Mailpit como SMTP local. Esto evita que un
  // CORREO_ANFITRION vacio (tal como quedaba al copiar el .env.ejemplo viejo)
  // desactive silenciosamente todo el despachador de correo.
  const anfitrion = anfitrionConfigurado || (esProduccion ? '' : 'localhost');
  if (!anfitrion) return null;

  const puertoConfigurado = process.env['CORREO_PUERTO']?.trim() ?? '';
  const puerto = Number(puertoConfigurado || (esProduccion ? 587 : 1025));
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) {
    throw new ErrorCorreo('CORREO_CONFIGURACION_INVALIDA', `Puerto SMTP invalido: ${puertoConfigurado || puerto}.`);
  }

  return {
    anfitrion,
    puerto,
    seguro: process.env['CORREO_SEGURO'] === 'true' || puerto === 465,
    usuario: process.env['CORREO_USUARIO']?.trim() || null,
    clave: process.env['CORREO_CLAVE'] || null,
    remitente: process.env['CORREO_REMITENTE']?.trim() || 'NextDocs Documental <no-reply@nextdocs-documental.local>',
  };
}

export function correoConfigurado(): boolean {
  return configuracionCorreo() !== null;
}

export class ErrorCorreo extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCorreo';
    this.codigo = codigo;
  }
}

let transporte: Transporter | null = null;

export function cerrarCorreo(): void {
  if (transporte) {
    transporte.close();
    transporte = null;
  }
}

function obtenerTransporte(configuracion: ConfiguracionCorreo): Transporter {
  if (!transporte) {
    transporte = createTransport({
      host: configuracion.anfitrion,
      port: configuracion.puerto,
      secure: configuracion.seguro,
      ...(configuracion.usuario && configuracion.clave
        ? { auth: { user: configuracion.usuario, pass: configuracion.clave } }
        : {}),
    });
  }
  return transporte;
}

export interface Adjunto {
  nombre: string;
  contenido: Buffer;
  tipoMime: string;
  cid?: string;
}

export interface CorreoASalir {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  adjuntos?: Adjunto[];
}

export async function enviarCorreo(
  correo: CorreoASalir,
  configuracion = configuracionCorreo(),
): Promise<string> {
  if (!configuracion) {
    throw new ErrorCorreo('CORREO_NO_CONFIGURADO', 'Falta configurar el servidor de correo.');
  }

  try {
    const salida = await obtenerTransporte(configuracion).sendMail({
      from: configuracion.remitente,
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
      attachments: (correo.adjuntos ?? []).map((a) => ({
        filename: a.nombre,
        content: a.contenido,
        contentType: a.tipoMime,
        ...(a.cid ? { cid: a.cid } : {}),
      })),
    });

    return String(salida.messageId ?? '');
  } catch (error) {
    throw new ErrorCorreo('CORREO_NO_ENVIADO', (error as Error).message);
  }
}

export async function verificarCorreo(
  configuracion = configuracionCorreo(),
): Promise<boolean> {
  if (!configuracion) return false;
  try {
    await obtenerTransporte(configuracion).verify();
    return true;
  } catch {
    return false;
  }
}
