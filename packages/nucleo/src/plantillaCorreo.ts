export interface DatoDelCorreo {
  etiqueta: string;
  valor: string;
}

export interface HallazgoDelCorreo {
  codigo: string;
  severidad: string;
  mensaje: string;
}

export interface ContenidoCorreo {
  titulo: string;
  bajada: string;
  documento: string;
  tipo: string;
  estado: string;
  confianza: string | null;
  datos: DatoDelCorreo[];
  hallazgos: HallazgoDelCorreo[];
  asociadoA: string | null;
  enlace: string | null;
  piePersonalizado: string | null;
}

const TONOS: Record<string, string> = {
  APROBADO: '#059669',
  OBSERVADO: '#d97706',
  RECHAZADO: '#dc2626',
  VENCIDO: '#dc2626',
  POR_VENCER: '#d97706',
};

const TONOS_SEVERIDAD: Record<string, string> = {
  critico: '#dc2626',
  error: '#dc2626',
  advertencia: '#d97706',
  info: '#0284c7',
};

function escapar(valor: string): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function asuntoDeCorreo(contenido: ContenidoCorreo): string {
  return `${contenido.titulo} - ${contenido.documento}`;
}

export function textoDeCorreo(contenido: ContenidoCorreo): string {
  const lineas = [
    contenido.titulo,
    contenido.bajada,
    '',
    `Documento: ${contenido.documento}`,
    `Tipo: ${contenido.tipo}`,
    `Estado: ${contenido.estado}`,
  ];

  if (contenido.confianza) lineas.push(`Confianza: ${contenido.confianza}`);
  if (contenido.asociadoA) lineas.push(`Asociado a: ${contenido.asociadoA}`);

  if (contenido.datos.length) {
    lineas.push('', 'Datos leidos:');
    for (const dato of contenido.datos) lineas.push(`  ${dato.etiqueta}: ${dato.valor}`);
  }

  if (contenido.hallazgos.length) {
    lineas.push('', 'Para revisar:');
    for (const h of contenido.hallazgos) lineas.push(`  [${h.severidad}] ${h.mensaje}`);
  }

  if (contenido.enlace) lineas.push('', `Ver en IA-Docs: ${contenido.enlace}`);
  if (contenido.piePersonalizado) lineas.push('', contenido.piePersonalizado);

  return lineas.join('\n');
}

export function htmlDeCorreo(contenido: ContenidoCorreo): string {
  const tono = TONOS[contenido.estado] ?? '#334155';

  const filasDatos = contenido.datos
    .map(
      (dato) => `
        <tr>
          <td style="padding:8px 0;color:#64748b;font-size:13px;width:42%;vertical-align:top">
            ${escapar(dato.etiqueta)}
          </td>
          <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600">
            ${escapar(dato.valor)}
          </td>
        </tr>`,
    )
    .join('');

  const bloqueHallazgos = contenido.hallazgos.length
    ? `
      <div style="margin-top:24px">
        <div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase;margin-bottom:10px">
          Para revisar
        </div>
        ${contenido.hallazgos
          .map(
            (h) => `
          <div style="border-left:3px solid ${TONOS_SEVERIDAD[h.severidad] ?? '#94a3b8'};background:#f8fafc;padding:10px 12px;margin-bottom:8px;border-radius:0 4px 4px 0">
            <div style="font-size:11px;font-weight:700;color:${TONOS_SEVERIDAD[h.severidad] ?? '#64748b'};text-transform:uppercase;letter-spacing:.04em">
              ${escapar(h.severidad)}
            </div>
            <div style="font-size:13px;color:#334155;margin-top:2px">${escapar(h.mensaje)}</div>
          </div>`,
          )
          .join('')}
      </div>`
    : '';

  const boton = contenido.enlace
    ? `
      <div style="margin-top:28px">
        <a href="${escapar(contenido.enlace)}"
           style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;
                  padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">
          Ver el documento
        </a>
      </div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td>
      <div style="background:#ffffff;border:1px solid #c1ccd7;border-radius:8px;overflow:hidden">

        <div style="background:#0f172a;padding:18px 24px">
          <div style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-.01em">IA-Docs</div>
          <div style="color:#94a3b8;font-size:12px;margin-top:2px">Del documento a la accion</div>
        </div>

        <div style="padding:24px">
          <div style="display:inline-block;background:${tono}1a;color:${tono};font-size:11px;
                      font-weight:700;padding:4px 10px;border-radius:4px;text-transform:uppercase;
                      letter-spacing:.04em">
            ${escapar(contenido.estado)}
          </div>

          <h1 style="margin:14px 0 6px;font-size:20px;color:#0f172a;font-weight:700;line-height:1.3">
            ${escapar(contenido.titulo)}
          </h1>
          <p style="margin:0;color:#475569;font-size:14px;line-height:1.55">
            ${escapar(contenido.bajada)}
          </p>

          <div style="margin-top:22px;padding:14px 16px;background:#f8fafc;border-radius:6px;
                      border:1px solid #e2e8f0">
            <div style="font-size:14px;font-weight:700;color:#0f172a">
              ${escapar(contenido.documento)}
            </div>
            <div style="font-size:12px;color:#64748b;margin-top:3px">
              ${escapar(contenido.tipo)}${contenido.confianza ? ` &middot; confianza ${escapar(contenido.confianza)}` : ''}${contenido.asociadoA ? ` &middot; ${escapar(contenido.asociadoA)}` : ''}
            </div>
          </div>

          ${filasDatos
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px">
                 ${filasDatos}
               </table>`
            : ''}

          ${bloqueHallazgos}
          ${boton}
        </div>

        <div style="border-top:1px solid #e2e8f0;padding:14px 24px;background:#f8fafc">
          <div style="font-size:11px;color:#94a3b8;line-height:1.5">
            ${contenido.piePersonalizado ? `${escapar(contenido.piePersonalizado)}<br>` : ''}
            Este correo lo genero IA-Docs automaticamente. El documento original queda archivado en el sistema.
          </div>
        </div>

      </div>
    </td></tr>
  </table>
</body>
</html>`;
}
