export const ZONA = 'America/Argentina/Buenos_Aires';

export function texto(valor: unknown): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizar(valor: unknown): string {
  return texto(valor).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function claveComparacion(valor: unknown): string {
  return normalizar(valor).replace(/[^A-Z0-9]/g, '');
}

export function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let limpio = texto(valor).replace(/[^\d.,-]/g, '');
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimaComa > ultimoPunto) {
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    limpio = limpio.replace(/,/g, '');
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export function fecha(valor: unknown): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const crudo = texto(valor);
  const iso = crudo.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 0, 0, 0, 0);
  }
  const dmy = crudo.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (dmy) {
    let anio = Number(dmy[3]);
    if (anio < 100) anio += 2000;
    return new Date(anio, Number(dmy[2]) - 1, Number(dmy[1]), 0, 0, 0, 0);
  }
  return null;
}

export function comoDiaIso(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function diasEntre(anterior: Date, posterior: Date): number {
  return Math.floor((posterior.getTime() - anterior.getTime()) / 86400000);
}

export function cuitValido(valor: unknown): boolean {
  const digitos = texto(valor).replace(/\D/g, '');
  if (digitos.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i += 1) {
    suma += Number(digitos[i]) * (pesos[i] as number);
  }
  const resto = suma % 11;
  let verificador = 11 - resto;
  if (verificador === 11) verificador = 0;
  if (verificador === 10) verificador = 9;
  return verificador === Number(digitos[10]);
}

export function normalizarCuit(valor: unknown): string | null {
  const digitos = texto(valor).replace(/\D/g, '');
  return digitos.length === 11 ? digitos : null;
}

export function patenteValida(valor: unknown): boolean {
  const p = normalizar(valor).replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d{3}$/.test(p) || /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p);
}

export function normalizarPatente(valor: unknown): string | null {
  const p = normalizar(valor).replace(/[^A-Z0-9]/g, '');
  return patenteValida(p) ? p : null;
}

export function normalizarComprobante(valor: unknown): string | null {
  const crudo = texto(valor);
  const partido = crudo.match(/(\d{1,5})\s*[-/]\s*(\d{1,8})/);
  if (partido) {
    return `${(partido[1] as string).padStart(4, '0')}-${(partido[2] as string).padStart(8, '0')}`;
  }
  const digitos = crudo.replace(/\D/g, '');
  if (digitos.length < 5) return null;
  if (digitos.length <= 8) return `0001-${digitos.padStart(8, '0')}`;
  const sucursal = digitos.slice(0, digitos.length - 8).padStart(4, '0');
  const correlativo = digitos.slice(-8).padStart(8, '0');
  return `${sucursal}-${correlativo}`;
}
