const TIPOS_ACEPTADOS = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/tiff': 'tiff',
};

const TAMANO_MAXIMO = 25 * 1024 * 1024;

const MOTIVOS_DEL_CHOFER = [
  'CONFIANZA_GLOBAL_BAJA',
  'CAMPOS_CRITICOS_OBSERVADOS',
  'TIPO_NO_RECONOCIDO',
  'TIPO_INCIERTO',
  'SALIDA_NO_PARSEABLE',
  'ARCHIVO_RECHAZADO',
];

const MOTIVOS_DEL_OPERADOR = [
  'REGLAS_CON_ERROR',
  'EMPAREJAMIENTO_NO_RESUELTO',
  'CAE_RECHAZADO',
  'CAE_OBSERVADO',
  'PLANTILLA_NO_PUBLICADA',
];

const MOTIVOS_TRANSITORIOS = [
  'PROVEEDOR_SATURADO',
  'PROVEEDOR_NO_DISPONIBLE',
  'PROVEEDOR_INALCANZABLE',
  'PROVEEDOR_CON_ERROR',
];

function normalizarTelefono(valor) {
  const solo = String(valor || '').replace(/\D/g, '');
  return solo.length >= 10 ? solo : null;
}

function extensionDe(tipoMime, nombre) {
  const porMime = TIPOS_ACEPTADOS[String(tipoMime || '').toLowerCase()];
  if (porMime) return porMime;
  const porNombre = String(nombre || '').split('.').pop();
  return Object.values(TIPOS_ACEPTADOS).includes(porNombre) ? porNombre : null;
}

function nombreDelArchivo(entrada) {
  const propuesto = String(entrada.nombreArchivo || '').trim();
  if (propuesto) return propuesto.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

  const extension = extensionDe(entrada.tipoMime, propuesto) || 'pdf';
  const marca = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
  return `whatsapp_${entrada.telefono || 'chofer'}_${marca}.${extension}`;
}

function evaluarEntrada(entrada) {
  const telefono = normalizarTelefono(entrada.telefono);
  if (!telefono) {
    return { aceptado: false, motivo: 'SIN_TELEFONO', mensaje: null };
  }

  if (!entrada.contenidoBase64 || String(entrada.contenidoBase64).length < 32) {
    return {
      aceptado: false,
      motivo: 'SIN_CONTENIDO',
      mensaje: 'No me llego el archivo. Probá mandarlo de nuevo.',
    };
  }

  if (!extensionDe(entrada.tipoMime, entrada.nombreArchivo)) {
    return {
      aceptado: false,
      motivo: 'TIPO_NO_ACEPTADO',
      mensaje: 'Ese formato no lo puedo leer. Mandame una foto o un PDF.',
    };
  }

  const tamano = Math.floor((String(entrada.contenidoBase64).length * 3) / 4);
  if (tamano > TAMANO_MAXIMO) {
    return {
      aceptado: false,
      motivo: 'DEMASIADO_GRANDE',
      mensaje: 'El archivo pesa demasiado. Probá con una foto de menor calidad.',
    };
  }

  return { aceptado: true, motivo: null, mensaje: null, telefono, tamano };
}

function prepararCarga(entrada) {
  const evaluacion = evaluarEntrada(entrada);
  if (!evaluacion.aceptado) return { ...evaluacion, carga: null };

  return {
    ...evaluacion,
    carga: {
      origen: 'WHATSAPP',
      nombreArchivo: nombreDelArchivo({ ...entrada, telefono: evaluacion.telefono }),
      tipoMime: String(entrada.tipoMime || '').toLowerCase() || undefined,
      contenidoBase64: entrada.contenidoBase64,
      referenciaExterna: entrada.referenciaExterna || null,
      plantilla: entrada.plantillaSugerida || null,
    },
    claveIdempotencia: entrada.idMensaje ? `wsp:${entrada.idMensaje}` : null,
  };
}

function acusarRecibo(resultado) {
  if (resultado && resultado.motivo === 'DUPLICADO') {
    return 'Ese documento ya lo tenia. No hace falta que lo mandes de nuevo.';
  }
  return 'Recibi el documento, lo estoy leyendo. En un rato te confirmo.';
}

function quienResuelve(codigoMotivo) {
  const codigo = String(codigoMotivo || '').toUpperCase();
  if (MOTIVOS_TRANSITORIOS.includes(codigo)) return 'NADIE';
  if (MOTIVOS_DEL_CHOFER.includes(codigo)) return 'CHOFER';
  if (MOTIVOS_DEL_OPERADOR.includes(codigo)) return 'OPERADOR';
  return 'OPERADOR';
}

function mensajeParaElChofer(evento) {
  const tipo = String(evento.tipoEvento || '');
  const datos = evento.datos || {};
  const nombre = evento.nombreArchivo ? ` (${evento.nombreArchivo})` : '';

  if (tipo === 'documento.aprobado') {
    const asociado = datos.sujetoId ? ` Quedo asociado al pedido ${datos.sujetoId}.` : '';
    return {
      escribir: true,
      destino: 'CHOFER',
      texto: `Listo, el documento${nombre} quedo cargado.${asociado} Gracias.`,
    };
  }

  if (tipo !== 'documento.observado') {
    return { escribir: false, destino: null, texto: null };
  }

  const responsable = quienResuelve(datos.codigoMotivo);

  if (responsable === 'NADIE') {
    return { escribir: false, destino: null, texto: null };
  }

  if (responsable === 'OPERADOR') {
    return {
      escribir: false,
      destino: 'OPERADOR',
      texto: null,
      motivo: datos.codigoMotivo || null,
    };
  }

  const textos = {
    CONFIANZA_GLOBAL_BAJA: 'No llego a leer bien el documento. Probá sacarle la foto de nuevo, derecho y con buena luz.',
    CAMPOS_CRITICOS_OBSERVADOS: 'Me falta leer algunos datos del documento. Mandame una foto donde se vea la hoja completa.',
    TIPO_NO_RECONOCIDO: 'No pude reconocer que documento es. Confirmame que mandaste el remito o la factura correcta.',
    TIPO_INCIERTO: 'No estoy seguro de que documento es. Mandame una foto mas clara del encabezado.',
    SALIDA_NO_PARSEABLE: 'No pude interpretar el documento. Probá mandarlo de nuevo.',
    ARCHIVO_RECHAZADO: 'Ese archivo no lo pude abrir. Mandame una foto o un PDF.',
  };

  const codigo = String(datos.codigoMotivo || '').toUpperCase();

  return {
    escribir: true,
    destino: 'CHOFER',
    texto: textos[codigo] || 'Necesito que me mandes el documento de nuevo, no lo pude procesar bien.',
    motivo: codigo || null,
  };
}

function puedeEscribirle(estado) {
  const ahora = Number(estado.ahora || Date.now());

  if (estado.botPausado) {
    return { puede: false, motivo: 'BOT_PAUSADO' };
  }

  if (estado.preguntaPendienteDeOtroAgente) {
    return { puede: false, motivo: 'OTRO_AGENTE_ESPERANDO' };
  }

  const minutosDesdeElUltimo = estado.ultimoAvisoEn
    ? (ahora - Number(estado.ultimoAvisoEn)) / 60000
    : Infinity;

  if (minutosDesdeElUltimo < 10) {
    return { puede: false, motivo: 'RECIEN_LE_ESCRIBIMOS' };
  }

  if (Number(estado.avisosDelDocumento || 0) >= 3) {
    return { puede: false, motivo: 'YA_INSISTIMOS' };
  }

  return { puede: true, motivo: null };
}

module.exports = {
  TIPOS_ACEPTADOS,
  TAMANO_MAXIMO,
  MOTIVOS_DEL_CHOFER,
  MOTIVOS_DEL_OPERADOR,
  MOTIVOS_TRANSITORIOS,
  normalizarTelefono,
  extensionDe,
  nombreDelArchivo,
  evaluarEntrada,
  prepararCarga,
  acusarRecibo,
  quienResuelve,
  mensajeParaElChofer,
  puedeEscribirle,
};
