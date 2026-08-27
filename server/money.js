// money.js — manejo de dinero en centavos enteros (USD, sin impuestos).
// Regla: NUNCA usar flotantes para dinero; todo se almacena/calcula en centavos.

/**
 * Convierte un precio en dólares (número) a centavos enteros.
 * Acepta solo números finitos >= 0. Lanza Error en cualquier otro caso.
 */
export function toCents(dollars) {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0) {
    throw new Error(`Precio inválido: ${dollars}`);
  }
  return Math.round(dollars * 100);
}

/** Suma centavos de forma segura. */
export function addCents(a, b) {
  return a + b;
}

/** Total de una línea: precio unitario (centavos) * cantidad. */
export function lineTotal(unitPriceCents, quantity) {
  return unitPriceCents * quantity;
}

/** Formatea centavos como USD con dos decimales. */
export function formatUSD(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
