import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface Almacenamiento {
  guardar(clave: string, contenido: Buffer, tipoMime: string): Promise<void>;
  leer(clave: string): Promise<Buffer>;
  urlFirmada(clave: string, segundos?: number): Promise<string>;
}

export class AlmacenamientoS3 implements Almacenamiento {
  private readonly cliente: S3Client;

  private readonly balde: string;

  constructor(configuracion?: {
    endpoint?: string;
    clave?: string;
    secreto?: string;
    balde?: string;
    region?: string;
  }) {
    const endpoint = configuracion?.endpoint ?? process.env['ALMACENAMIENTO_ENDPOINT'];
    const clave = configuracion?.clave ?? process.env['ALMACENAMIENTO_CLAVE'];
    const secreto = configuracion?.secreto ?? process.env['ALMACENAMIENTO_SECRETO'];
    this.balde = configuracion?.balde ?? process.env['ALMACENAMIENTO_BALDE'] ?? 'docvance-documentos';

    if (!endpoint || !clave || !secreto) {
      throw new Error('Falta configurar el almacenamiento: endpoint, clave y secreto.');
    }

    this.cliente = new S3Client({
      endpoint,
      region: configuracion?.region ?? 'us-east-1',
      credentials: { accessKeyId: clave, secretAccessKey: secreto },
      forcePathStyle: true,
    });
  }

  async guardar(clave: string, contenido: Buffer, tipoMime: string): Promise<void> {
    await this.cliente.send(new PutObjectCommand({
      Bucket: this.balde,
      Key: clave,
      Body: contenido,
      ContentType: tipoMime,
    }));
  }

  async leer(clave: string): Promise<Buffer> {
    const respuesta = await this.cliente.send(new GetObjectCommand({
      Bucket: this.balde,
      Key: clave,
    }));
    const cuerpo = respuesta.Body;
    if (!cuerpo) throw new Error(`El objeto ${clave} vino vacio.`);
    const partes: Uint8Array[] = [];
    for await (const parte of cuerpo as AsyncIterable<Uint8Array>) partes.push(parte);
    return Buffer.concat(partes);
  }

  async urlFirmada(clave: string, segundos = 300): Promise<string> {
    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({ Bucket: this.balde, Key: clave }),
      { expiresIn: segundos },
    );
  }
}

export class AlmacenamientoEnMemoria implements Almacenamiento {
  private readonly objetos = new Map<string, { contenido: Buffer; tipoMime: string }>();

  async guardar(clave: string, contenido: Buffer, tipoMime: string): Promise<void> {
    this.objetos.set(clave, { contenido, tipoMime });
  }

  async leer(clave: string): Promise<Buffer> {
    const objeto = this.objetos.get(clave);
    if (!objeto) throw new Error(`No existe el objeto ${clave}.`);
    return objeto.contenido;
  }

  async urlFirmada(clave: string): Promise<string> {
    if (!this.objetos.has(clave)) throw new Error(`No existe el objeto ${clave}.`);
    return `memoria://${clave}`;
  }

  get cantidad(): number {
    return this.objetos.size;
  }
}
