const assert = require('node:assert');
const {
  evaluarEntrada,
  prepararCarga,
  acusarRecibo,
  quienResuelve,
  mensajeParaElChofer,
  puedeEscribirle,
  normalizarTelefono,
  nombreDelArchivo,
} = require('./b49_documentos.cjs');

let corridas = 0;
let fallidas = 0;

function probar(nombre, cuerpo) {
  corridas += 1;
  try {
    cuerpo();
    process.stdout.write(`  ok  ${nombre}\n`);
  } catch (error) {
    fallidas += 1;
    process.stdout.write(`  NO  ${nombre}\n      ${error.message}\n`);
  }
}

const base64Valido = Buffer.from('x'.repeat(600)).toString('base64');

process.stdout.write('\ntelefono\n');

probar('acepta un numero argentino completo', () => {
  assert.strictEqual(normalizarTelefono('+54 9 261 555-1234'), '5492615551234');
});

probar('rechaza un numero corto', () => {
  assert.strictEqual(normalizarTelefono('1234'), null);
});

process.stdout.write('\nentrada del chofer\n');

probar('acepta una foto de remito', () => {
  const salida = evaluarEntrada({
    telefono: '5492615551234',
    tipoMime: 'image/jpeg',
    contenidoBase64: base64Valido,
  });
  assert.strictEqual(salida.aceptado, true);
});

probar('rechaza un audio con un mensaje entendible', () => {
  const salida = evaluarEntrada({
    telefono: '5492615551234',
    tipoMime: 'audio/ogg',
    contenidoBase64: base64Valido,
  });
  assert.strictEqual(salida.aceptado, false);
  assert.strictEqual(salida.motivo, 'TIPO_NO_ACEPTADO');
  assert.ok(salida.mensaje.includes('foto'));
});

probar('rechaza si no vino el archivo', () => {
  const salida = evaluarEntrada({ telefono: '5492615551234', tipoMime: 'image/jpeg' });
  assert.strictEqual(salida.motivo, 'SIN_CONTENIDO');
});

probar('rechaza sin telefono y no arma mensaje para nadie', () => {
  const salida = evaluarEntrada({ tipoMime: 'image/jpeg', contenidoBase64: base64Valido });
  assert.strictEqual(salida.motivo, 'SIN_TELEFONO');
  assert.strictEqual(salida.mensaje, null);
});

probar('rechaza un archivo enorme', () => {
  const salida = evaluarEntrada({
    telefono: '5492615551234',
    tipoMime: 'application/pdf',
    contenidoBase64: 'A'.repeat(40 * 1024 * 1024),
  });
  assert.strictEqual(salida.motivo, 'DEMASIADO_GRANDE');
});

process.stdout.write('\ncarga para nextdocs_documental\n');

probar('arma el pedido con origen whatsapp', () => {
  const salida = prepararCarga({
    telefono: '5492615551234',
    tipoMime: 'image/jpeg',
    nombreArchivo: 'remito.jpg',
    contenidoBase64: base64Valido,
    idMensaje: 'wamid.ABC',
  });

  assert.strictEqual(salida.carga.origen, 'WHATSAPP');
  assert.strictEqual(salida.carga.nombreArchivo, 'remito.jpg');
  assert.strictEqual(salida.claveIdempotencia, 'wsp:wamid.ABC');
});

probar('inventa un nombre cuando whatsapp no manda ninguno', () => {
  const nombre = nombreDelArchivo({ telefono: '5492615551234', tipoMime: 'image/jpeg' });
  assert.ok(nombre.startsWith('whatsapp_5492615551234_'));
  assert.ok(nombre.endsWith('.jpg'));
});

probar('limpia un nombre con caracteres peligrosos', () => {
  const nombre = nombreDelArchivo({ nombreArchivo: '../../etc/passwd.pdf' });
  assert.ok(!nombre.includes('/'));
});

probar('sin id de mensaje no manda clave de idempotencia', () => {
  const salida = prepararCarga({
    telefono: '5492615551234',
    tipoMime: 'application/pdf',
    contenidoBase64: base64Valido,
  });
  assert.strictEqual(salida.claveIdempotencia, null);
});

process.stdout.write('\nacuse de recibo\n');

probar('avisa que ya lo tenia si es duplicado', () => {
  assert.ok(acusarRecibo({ motivo: 'DUPLICADO' }).includes('ya lo tenia'));
});

probar('confirma que lo esta leyendo', () => {
  assert.ok(acusarRecibo({ aceptado: true }).includes('leyendo'));
});

process.stdout.write('\nquien resuelve cada problema\n');

probar('una foto ilegible la arregla el chofer', () => {
  assert.strictEqual(quienResuelve('CONFIANZA_GLOBAL_BAJA'), 'CHOFER');
  assert.strictEqual(quienResuelve('CAMPOS_CRITICOS_OBSERVADOS'), 'CHOFER');
});

probar('un remito sin conformar lo resuelve el operador', () => {
  assert.strictEqual(quienResuelve('REGLAS_CON_ERROR'), 'OPERADOR');
  assert.strictEqual(quienResuelve('EMPAREJAMIENTO_NO_RESUELTO'), 'OPERADOR');
  assert.strictEqual(quienResuelve('CAE_RECHAZADO'), 'OPERADOR');
});

probar('una caida de la ia no la resuelve nadie, se reintenta sola', () => {
  assert.strictEqual(quienResuelve('PROVEEDOR_SATURADO'), 'NADIE');
  assert.strictEqual(quienResuelve('PROVEEDOR_NO_DISPONIBLE'), 'NADIE');
});

probar('un motivo desconocido va al operador, no al chofer', () => {
  assert.strictEqual(quienResuelve('ALGO_NUEVO'), 'OPERADOR');
});

process.stdout.write('\nque se le contesta al chofer\n');

probar('un documento aprobado se le agradece y se le dice a que pedido fue', () => {
  const salida = mensajeParaElChofer({
    tipoEvento: 'documento.aprobado',
    nombreArchivo: 'remito.jpg',
    datos: { sujetoId: 'PED-100234' },
  });

  assert.strictEqual(salida.escribir, true);
  assert.ok(salida.texto.includes('PED-100234'));
});

probar('una foto ilegible le pide otra foto', () => {
  const salida = mensajeParaElChofer({
    tipoEvento: 'documento.observado',
    datos: { codigoMotivo: 'CONFIANZA_GLOBAL_BAJA' },
  });

  assert.strictEqual(salida.escribir, true);
  assert.strictEqual(salida.destino, 'CHOFER');
  assert.ok(salida.texto.includes('foto'));
});

probar('un remito sin conformar no molesta al chofer, va al operador', () => {
  const salida = mensajeParaElChofer({
    tipoEvento: 'documento.observado',
    datos: { codigoMotivo: 'REGLAS_CON_ERROR' },
  });

  assert.strictEqual(salida.escribir, false);
  assert.strictEqual(salida.destino, 'OPERADOR');
});

probar('una caida de la ia no le escribe a nadie', () => {
  const salida = mensajeParaElChofer({
    tipoEvento: 'documento.observado',
    datos: { codigoMotivo: 'PROVEEDOR_SATURADO' },
  });

  assert.strictEqual(salida.escribir, false);
  assert.strictEqual(salida.destino, null);
});

probar('un evento que no es de documentos se ignora', () => {
  assert.strictEqual(mensajeParaElChofer({ tipoEvento: 'documento.recibido' }).escribir, false);
});

process.stdout.write('\ncuando se le puede escribir\n');

probar('se le escribe si no hay nada que lo impida', () => {
  assert.strictEqual(puedeEscribirle({}).puede, true);
});

probar('no se le escribe si un operador tomo la conversacion', () => {
  const salida = puedeEscribirle({ botPausado: true });
  assert.strictEqual(salida.puede, false);
  assert.strictEqual(salida.motivo, 'BOT_PAUSADO');
});

probar('no se le escribe si otro agente tiene una pregunta abierta', () => {
  assert.strictEqual(puedeEscribirle({ preguntaPendienteDeOtroAgente: true }).motivo, 'OTRO_AGENTE_ESPERANDO');
});

probar('no se le escribe dos veces seguidas', () => {
  const salida = puedeEscribirle({ ultimoAvisoEn: Date.now() - 3 * 60000 });
  assert.strictEqual(salida.motivo, 'RECIEN_LE_ESCRIBIMOS');
});

probar('pasados diez minutos si se le puede escribir', () => {
  assert.strictEqual(puedeEscribirle({ ultimoAvisoEn: Date.now() - 15 * 60000 }).puede, true);
});

probar('despues de tres avisos por el mismo documento se corta', () => {
  const salida = puedeEscribirle({ avisosDelDocumento: 3, ultimoAvisoEn: Date.now() - 60 * 60000 });
  assert.strictEqual(salida.motivo, 'YA_INSISTIMOS');
});

process.stdout.write(`\n${corridas - fallidas} de ${corridas} bien\n`);
process.exit(fallidas ? 1 : 0);
