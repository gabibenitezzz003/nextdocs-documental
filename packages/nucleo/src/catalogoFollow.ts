import {
  ErrorFollow,
  buscarChoferesEnFollow,
  buscarPedidosEnFollow,
  buscarVehiculosEnFollow,
  followConfigurado,
  type ChoferFollow,
  type PedidoFollow,
  type VehiculoFollow,
} from '@docvance/adaptadores';
import {
  normalizarPatente,
  texto,
  type ObjetoNegocio,
} from '@docvance/dominio';

import { buscarObjetosDeNegocio } from './catalogo.js';

export const CLAVES_DOCUMENTO = ['numeroDocumento', 'cuil', 'documentoChofer'];
export const CLAVES_PATENTE = ['patente', 'dominio'];
export const CLAVES_PEDIDO = ['nroPedido', 'numeroPedido', 'ordenCompra'];

function primerTermino(valores: Record<string, unknown>, claves: string[]): string | null {
  for (const clave of claves) {
    const valor = texto(valores[clave]);
    if (valor.length >= 3) return valor;
  }
  return null;
}

export function choferComoObjeto(chofer: ChoferFollow): ObjetoNegocio {
  const nombreCompleto = [chofer.apellido, chofer.nombre].filter(Boolean).join(', ');
  return {
    tipo: 'CHOFER',
    id: chofer.id,
    etiqueta: nombreCompleto || chofer.documento || chofer.id,
    numeroDocumento: chofer.documento ?? null,
    cuil: chofer.documento ?? null,
    apellido: chofer.apellido ?? null,
    nombre: chofer.nombre ?? null,
    legajo: chofer.legajo ?? null,
    estado: chofer.estado ?? null,
    origen: 'follow',
  };
}

export function vehiculoComoObjeto(vehiculo: VehiculoFollow): ObjetoNegocio {
  const patente = normalizarPatente(vehiculo.dominio) ?? vehiculo.dominio ?? null;
  const descripcion = [vehiculo.marca?.nombre, vehiculo.modelo].filter(Boolean).join(' ');
  return {
    tipo: 'VEHICULO',
    id: vehiculo.id,
    etiqueta: [patente, descripcion].filter(Boolean).join(' - ') || vehiculo.id,
    patente,
    marca: vehiculo.marca?.nombre ?? null,
    modelo: vehiculo.modelo ?? null,
    anio: vehiculo.anioFabricacion ?? null,
    origen: 'follow',
  };
}

export function pedidoComoObjeto(pedido: PedidoFollow): ObjetoNegocio {
  const numero = pedido.numeroVisible ?? pedido.nroPedido ?? null;
  return {
    tipo: 'PEDIDO',
    id: pedido.id,
    etiqueta: numero ? `Pedido ${numero}` : pedido.id,
    nroPedido: numero,
    numero,
    razonSocialDestinatario: pedido.clienteNombre ?? null,
    cuitDestinatario: pedido.clienteCuit ?? null,
    totalBultos: pedido.totalBultos ?? null,
    origen: 'follow',
  };
}

export async function buscarObjetosEnFollow(
  valores: Record<string, unknown>,
): Promise<ObjetoNegocio[]> {
  if (!followConfigurado()) return [];

  const documento = primerTermino(valores, CLAVES_DOCUMENTO);
  const patente = primerTermino(valores, CLAVES_PATENTE);
  const pedido = primerTermino(valores, CLAVES_PEDIDO);

  const busquedas: Promise<ObjetoNegocio[]>[] = [];

  if (documento) {
    busquedas.push(
      buscarChoferesEnFollow(documento).then((choferes) => choferes.map(choferComoObjeto)),
    );
  }

  if (patente) {
    busquedas.push(
      buscarVehiculosEnFollow(patente).then((vehiculos) => vehiculos.map(vehiculoComoObjeto)),
    );
  }

  if (pedido) {
    busquedas.push(
      buscarPedidosEnFollow(pedido).then((pedidos) => pedidos.map(pedidoComoObjeto)),
    );
  }

  if (!busquedas.length) return [];

  const resultados = await Promise.allSettled(busquedas);
  const encontrados: ObjetoNegocio[] = [];

  for (const resultado of resultados) {
    if (resultado.status === 'fulfilled') encontrados.push(...resultado.value);
  }

  return encontrados;
}

export async function buscarObjetosCombinado(
  inquilinoId: string,
  valores: Record<string, unknown>,
): Promise<ObjetoNegocio[]> {
  const [propios, deFollow] = await Promise.all([
    buscarObjetosDeNegocio(inquilinoId, valores),
    buscarObjetosEnFollow(valores).catch((error: ErrorFollow) => {
      process.stderr.write(`follow no respondio: ${error.message}\n`);
      return [] as ObjetoNegocio[];
    }),
  ]);

  const vistos = new Set(propios.map((o) => `${o.tipo}:${o.id}`));
  const combinados = [...propios];

  for (const objeto of deFollow) {
    const clave = `${objeto.tipo}:${objeto.id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    combinados.push(objeto);
  }

  return combinados;
}
