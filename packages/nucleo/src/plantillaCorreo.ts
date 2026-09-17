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

  if (contenido.enlace) lineas.push('', `Ver en NEXT DOC AI: ${contenido.enlace}`);
  if (contenido.piePersonalizado) lineas.push('', contenido.piePersonalizado);

  return lineas.join('\n');
}

export function htmlDeCorreo(contenido: ContenidoCorreo): string {
  const tono = TONOS[contenido.estado] ?? '#334155';

  const filasDatos = contenido.datos
    .map(
      (dato) => `
        <tr>
          <td style="padding:9px 0;color:#667085;font-size:13px;width:42%;vertical-align:top;border-bottom:1px solid #f1f3f7">
            ${escapar(dato.etiqueta)}
          </td>
          <td style="padding:9px 0;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #f1f3f7">
            ${escapar(dato.valor)}
          </td>
        </tr>`,
    )
    .join('');

  const bloqueHallazgos = contenido.hallazgos.length
    ? `
      <div style="margin-top:24px">
        <div style="font-size:11px;font-weight:700;color:#667085;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
          Para revisar
        </div>
        ${contenido.hallazgos
          .map(
            (h) => `
          <div style="border-left:3px solid ${TONOS_SEVERIDAD[h.severidad] ?? '#98a2b3'};background:#f8fafc;padding:10px 14px;margin-bottom:8px;border-radius:0 6px 6px 0">
            <div style="font-size:11px;font-weight:700;color:${TONOS_SEVERIDAD[h.severidad] ?? '#667085'};text-transform:uppercase;letter-spacing:.06em">
              ${escapar(h.severidad)}
            </div>
            <div style="font-size:13px;color:#344054;margin-top:3px;line-height:1.45">${escapar(h.mensaje)}</div>
          </div>`,
          )
          .join('')}
      </div>`
    : '';

  const boton = '';

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td>
          <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(13,15,18,.08)">

            <div style="height:5px;background:linear-gradient(90deg,#6c36ff 0%,#a44dff 45%,#ff1e1e 100%)"></div>

            <div style="background:#0d0f12;padding:22px 28px">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:middle">
                  <img src="cid:logoMarca" alt="NEXT DOC AI" width="150"
                       style="display:block;height:auto;border:0">
                </td>
              </tr></table>
              <div style="color:#8a93a6;font-size:12px;margin-top:10px;letter-spacing:.02em">
                Inteligencia documental &middot; del documento a la acci&oacute;n
              </div>
            </div>

            <div style="padding:28px">
              <div style="display:inline-block;background:${tono}1a;color:${tono};font-size:11px;
                          font-weight:700;padding:5px 12px;border-radius:5px;text-transform:uppercase;
                          letter-spacing:.06em">
                ${escapar(contenido.estado)}
              </div>

              <h1 style="margin:16px 0 6px;font-size:21px;color:#0d0f12;font-weight:700;line-height:1.3;letter-spacing:-.01em">
                ${escapar(contenido.titulo)}
              </h1>
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6">
                ${escapar(contenido.bajada)}
              </p>

              <div style="margin-top:24px;padding:16px 18px;background:#f7f9fc;border-radius:8px;
                          border:1px solid #e2e7ef">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                  <td style="vertical-align:middle">
                    <div style="font-size:14px;font-weight:700;color:#0d0f12;word-break:break-all">
                      ${escapar(contenido.documento)}
                    </div>
                    <div style="font-size:12px;color:#667085;margin-top:4px">
                      ${escapar(contenido.tipo)}${contenido.confianza ? ` &middot; confianza ${escapar(contenido.confianza)}` : ''}${contenido.asociadoA ? ` &middot; ${escapar(contenido.asociadoA)}` : ''}
                    </div>
                  </td>
                </tr></table>
              </div>

              ${filasDatos
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
                     ${filasDatos}
                   </table>`
                : ''}

              ${bloqueHallazgos}
              ${boton}
            </div>

            <div style="border-top:1px solid #e9edf3;padding:18px 28px;background:#f9fafc">
              <div style="font-size:11px;color:#98a2b3;line-height:1.6">
                ${contenido.piePersonalizado ? `${escapar(contenido.piePersonalizado)}<br>` : ''}
                Este correo lo gener&oacute; NEXT DOC AI autom&aacute;ticamente.
                El documento original queda archivado y disponible en el sistema de tu organizaci&oacute;n.
              </div>
            </div>

          </div>
          <div style="text-align:center;padding:18px 0 4px;font-size:11px;color:#98a2b3">
            NEXT DOC AI &middot; nextdocsia.fenixgroup.tech
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
