import { describe, expect, it } from 'vitest';

import {
  CONFIANZA_SIN_EVIDENCIA,
  confianzaGlobal,
  cuitValido,
  decidir,
  emparejar,
  exigirTransicion,
  fecha,
  normalizarComprobante,
  normalizarPatente,
  numero,
  patenteValida,
  plantillaDe,
  procesarCampos,
  REMITO,
  transicionValida,
  TransicionInvalida,
  validar,
} from './indice.js';
import type { MapaValores, ObjetoNegocio, ResultadoEmparejamiento } from './tipos.js';

const CAMPOS_BUENOS: Record<string, unknown> = {
  numero: { valor: '0004-00008932', confianza: 0.97, evidencia: { pagina: 1, recorte: [0.1, 0.1, 0.3, 0.15], textoFuente: '0004-00008932' } },
  fechaEmision: { valor: '19/08/2026', confianza: 0.96, evidencia: { pagina: 1, recorte: [0.4, 0.1, 0.6, 0.15], textoFuente: '19/08/2026' } },
  cuitEmisor: { valor: '20-12345678-6', confianza: 0.98, evidencia: { pagina: 1, recorte: [0.1, 0.2, 0.4, 0.25], textoFuente: '20-12345678-6' } },
  razonSocialEmisor: { valor: 'BODEGA SAN MARTIN SA', confianza: 0.95, evidencia: { pagina: 1, recorte: [0.1, 0.05, 0.5, 0.1], textoFuente: 'BODEGA SAN MARTIN SA' } },
  razonSocialDestinatario: { valor: 'CEPAS ARGENTINAS SA', confianza: 0.94, evidencia: { pagina: 1, recorte: [0.1, 0.3, 0.5, 0.35], textoFuente: 'CEPAS ARGENTINAS SA' } },
  domicilioEntrega: { valor: 'San Martin 1450, Godoy Cruz', confianza: 0.93, evidencia: { pagina: 1, recorte: [0.1, 0.35, 0.7, 0.4], textoFuente: 'San Martin 1450' } },
  conformado: { valor: true, confianza: 0.95, evidencia: { pagina: 1, recorte: [0.6, 0.8, 0.9, 0.9], textoFuente: 'Recibi conforme' } },
  nroPedido: { valor: '80264630', confianza: 0.93, evidencia: { pagina: 1, recorte: [0.5, 0.2, 0.7, 0.25], textoFuente: '80264630' } },
};

const SIN_EMPAREJAR: ResultadoEmparejamiento = {
  resolucion: 'CONFIRMADO_AUTOMATICO',
  sujeto: { tipo: 'PEDIDO', id: 'ped-1', etiqueta: 'Pedido 80264630' },
  candidatos: [],
  hallazgos: [],
};

describe('valores', () => {
  it('valida el digito verificador del cuit', () => {
    expect(cuitValido('20-12345678-6')).toBe(true);
    expect(cuitValido('30-71234567-8')).toBe(false);
    expect(cuitValido('123')).toBe(false);
  });

  it('normaliza comprobantes a sucursal y correlativo', () => {
    expect(normalizarComprobante('0004-00008932')).toBe('0004-00008932');
    expect(normalizarComprobante('4-8932')).toBe('0004-00008932');
    expect(normalizarComprobante('N 0004 00008932')).toBe('0004-00008932');
  });

  it('interpreta numeros con coma y con punto decimal', () => {
    expect(numero('1.234,56')).toBe(1234.56);
    expect(numero('1,234.56')).toBe(1234.56);
    expect(numero('2.121704545454545')).toBeCloseTo(2.1217045, 6);
  });

  it('valida patentes en los dos formatos argentinos', () => {
    expect(patenteValida('KBP169')).toBe(true);
    expect(patenteValida('AB123CD')).toBe(true);
    expect(patenteValida('KBP')).toBe(false);
    expect(normalizarPatente('kbp 169')).toBe('KBP169');
  });

  it('interpreta fechas en formato local sin correrse de dia', () => {
    const d = fecha('19/08/2026');
    expect(d?.getDate()).toBe(19);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getFullYear()).toBe(2026);
  });
});

describe('extraccion', () => {
  it('procesa una extraccion completa y calcula confianza', () => {
    const r = procesarCampos(REMITO, CAMPOS_BUENOS);
    expect(r.valores['cuitEmisor']?.valorNormalizado).toBe('20123456786');
    expect(r.valores['fechaEmision']?.valorNormalizado).toBe('2026-08-19');
    expect(r.confianza).toBeGreaterThan(0.9);
    expect(r.observados).toHaveLength(0);
  });

  it('marca faltante un campo requerido que no vino', () => {
    const campos = { ...CAMPOS_BUENOS };
    delete campos['conformado'];
    const r = procesarCampos(REMITO, campos);
    expect(r.observados.some((c) => c.clave === 'conformado' && c.motivo === 'FALTANTE')).toBe(true);
    expect(r.hallazgos.some((h) => h.codigo === 'CAMPO_REQUERIDO_FALTANTE')).toBe(true);
  });

  it('topea la confianza si el campo no trae evidencia', () => {
    const campos = { ...CAMPOS_BUENOS, numero: { valor: '0004-00008932', confianza: 0.99 } };
    const r = procesarCampos(REMITO, campos);
    expect(r.valores['numero']?.confianza).toBeLessThanOrEqual(CONFIANZA_SIN_EVIDENCIA);
  });

  it('baja la confianza cuando el valor no se puede normalizar', () => {
    const campos = { ...CAMPOS_BUENOS, cuitEmisor: { valor: 'no es un cuit', confianza: 0.99, evidencia: { pagina: 1, recorte: [0, 0, 1, 1], textoFuente: 'x' } } };
    const r = procesarCampos(REMITO, campos);
    expect(r.valores['cuitEmisor']?.confianza).toBeLessThanOrEqual(0.4);
    expect(r.hallazgos.some((h) => h.codigo === 'VALOR_NO_NORMALIZABLE')).toBe(true);
  });

  it('la confianza global pondera solo los campos criticos', () => {
    const valores: MapaValores = {
      numero: { valorLeido: 'x', valorNormalizado: 'x', confianza: 1, evidencia: null, critico: true, requerido: true },
      observaciones: { valorLeido: 'y', valorNormalizado: 'y', confianza: 0, evidencia: null, critico: false, requerido: false },
    };
    const campos = REMITO.campos.filter((c) => ['numero', 'observaciones'].includes(c.clave));
    expect(confianzaGlobal(campos, valores)).toBe(1);
  });
});

describe('emparejamiento', () => {
  const valores = procesarCampos(REMITO, CAMPOS_BUENOS).valores;

  it('empareja solo cuando hay un unico candidato fuerte', () => {
    const catalogo: ObjetoNegocio[] = [{ tipo: 'PEDIDO', id: 'ped-1', nroPedido: '80264630' }];
    const r = emparejar(REMITO, valores, catalogo);
    expect(r.resolucion).toBe('CONFIRMADO_AUTOMATICO');
    expect(r.sujeto?.id).toBe('ped-1');
  });

  it('no elige cuando hay dos candidatos parecidos', () => {
    const catalogo: ObjetoNegocio[] = [
      { tipo: 'PEDIDO', id: 'ped-1', nroPedido: '80264630' },
      { tipo: 'PEDIDO', id: 'ped-2', nroPedido: '80264630' },
    ];
    const r = emparejar(REMITO, valores, catalogo);
    expect(r.resolucion).toBe('AMBIGUO');
    expect(r.sujeto).toBeNull();
    expect(r.hallazgos.some((h) => h.codigo === 'EMPAREJAMIENTO_AMBIGUO')).toBe(true);
  });

  it('avisa cuando el emparejamiento es debil', () => {
    const catalogo: ObjetoNegocio[] = [{ tipo: 'CLIENTE', id: 'cli-1', razonSocialDestinatario: 'CEPAS ARGENTINAS SA' }];
    const r = emparejar(REMITO, valores, catalogo);
    expect(r.resolucion).toBe('DEBIL');
  });

  it('informa cuando no hay candidatos', () => {
    const r = emparejar(REMITO, valores, []);
    expect(r.resolucion).toBe('SIN_CANDIDATOS');
  });
});

describe('validacion', () => {
  const base = (extra: Record<string, unknown> = {}) => procesarCampos(REMITO, { ...CAMPOS_BUENOS, ...extra }).valores;

  it('un remito correcto valida limpio', () => {
    const r = validar({ plantilla: REMITO, valores: base(), observaciones: [], emparejamiento: SIN_EMPAREJAR, ahora: new Date(2026, 7, 20) });
    expect(r.resultado).toBe('LIMPIO');
  });

  it('detecta cuit con digito verificador malo', () => {
    const r = validar({ plantilla: REMITO, valores: base({ cuitEmisor: { valor: '20-12345678-9', confianza: 0.98, evidencia: { pagina: 1, recorte: [0, 0, 1, 1], textoFuente: 'x' } } }), observaciones: [], emparejamiento: SIN_EMPAREJAR, ahora: new Date(2026, 7, 20) });
    expect(r.hallazgos.some((h) => h.codigo === 'CUIT_INVALIDO')).toBe(true);
    expect(r.resultado).toBe('CON_ERRORES');
  });

  it('detecta un remito sin conformar', () => {
    const r = validar({ plantilla: REMITO, valores: base({ conformado: { valor: false, confianza: 0.95, evidencia: { pagina: 1, recorte: [0, 0, 1, 1], textoFuente: 'x' } } }), observaciones: [], emparejamiento: SIN_EMPAREJAR, ahora: new Date(2026, 7, 20) });
    expect(r.hallazgos.some((h) => h.codigo === 'REMITO_SIN_CONFORMAR')).toBe(true);
  });

  it('detecta una fecha futura', () => {
    const r = validar({ plantilla: REMITO, valores: base(), observaciones: [], emparejamiento: SIN_EMPAREJAR, ahora: new Date(2026, 7, 1) });
    expect(r.hallazgos.some((h) => h.codigo === 'FECHA_FUTURA')).toBe(true);
  });

  it('detecta daño mencionado y no lo trata como bloqueante', () => {
    const r = validar({ plantilla: REMITO, valores: base(), observaciones: ['Se recibe con un pallet mojado'], emparejamiento: SIN_EMPAREJAR, ahora: new Date(2026, 7, 20) });
    const h = r.hallazgos.find((x) => x.codigo === 'DANIO_MENCIONADO');
    expect(h?.origen).toBe('semantica');
    expect(h?.severidad).toBe('advertencia');
  });
});

describe('decision', () => {
  const entrada = (extra: Record<string, unknown> = {}) => ({
    plantilla: REMITO,
    confianza: 0.96,
    observados: [],
    hallazgos: [],
    emparejamiento: SIN_EMPAREJAR,
    ...extra,
  }) as Parameters<typeof decidir>[0];

  it('aprueba cuando se cumple todo', () => {
    const d = decidir(entrada());
    expect(d.aprobable).toBe(true);
    expect(d.estado).toBe('APROBADO');
  });

  it('observa si la confianza no alcanza', () => {
    const d = decidir(entrada({ confianza: 0.8 }));
    expect(d.estado).toBe('OBSERVADO');
    expect(d.motivos.some((m) => m.codigo === 'CONFIANZA_GLOBAL_BAJA')).toBe(true);
  });

  it('observa si un campo critico quedo bajo', () => {
    const d = decidir(entrada({ observados: [{ clave: 'cuitEmisor', motivo: 'CONFIANZA_BAJA', confianza: 0.4, critico: true }] }));
    expect(d.estado).toBe('OBSERVADO');
  });

  it('observa si el emparejamiento quedo ambiguo', () => {
    const d = decidir(entrada({ emparejamiento: { resolucion: 'AMBIGUO', sujeto: null, candidatos: [], hallazgos: [] } }));
    expect(d.estado).toBe('OBSERVADO');
    expect(d.motivos.some((m) => m.codigo === 'EMPAREJAMIENTO_NO_RESUELTO' && m.severidad === 'error')).toBe(true);
  });
});

describe('maquina de estados', () => {
  it('permite el camino feliz', () => {
    expect(transicionValida(null, 'RECIBIDO')).toBe(true);
    expect(transicionValida('RECIBIDO', 'PROCESANDO')).toBe(true);
    expect(transicionValida('VALIDADO', 'APROBADO')).toBe(true);
    expect(transicionValida('APROBADO', 'CERRADO')).toBe(true);
  });

  it('no permite volver atras desde aprobado', () => {
    expect(transicionValida('APROBADO', 'PROCESANDO')).toBe(false);
    expect(transicionValida('CERRADO', 'APROBADO')).toBe(false);
  });

  it('exigirTransicion falla con un error tipado', () => {
    expect(() => exigirTransicion('APROBADO', 'RECIBIDO')).toThrow(TransicionInvalida);
  });
});

describe('plantillas', () => {
  it('encuentra plantillas por codigo sin importar mayusculas', () => {
    expect(plantillaDe('remito')?.codigo).toBe('REMITO');
    expect(plantillaDe('FACTURA')?.codigo).toBe('FACTURA');
    expect(plantillaDe('inexistente')).toBeNull();
  });

  it('todo campo critico es requerido', () => {
    for (const plantilla of [plantillaDe('REMITO'), plantillaDe('FACTURA')]) {
      for (const campo of plantilla?.campos ?? []) {
        if (campo.critico) expect(campo.requerido).toBe(true);
      }
    }
  });
});
