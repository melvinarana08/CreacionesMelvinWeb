// errors.js — error HTTP tipificado para respuestas JSON consistentes.
export class HttpError extends Error {
  /**
   * @param {number} status  Código HTTP (400, 401, 404, 409, 500...)
   * @param {string} code    Código máquina estable (ej. 'discount_exceeds_subtotal')
   * @param {string} message Mensaje legible (se devuelve al cliente)
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}
