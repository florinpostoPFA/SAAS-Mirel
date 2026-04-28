/**
 * Typed application errors for machine-actionable logs and HTTP mapping.
 */

const CATEGORIES = {
  VALIDATION: "VALIDATION",
  ROUTING: "ROUTING",
  SEARCH: "SEARCH",
  LLM: "LLM",
  FLOW: "FLOW",
  SESSION: "SESSION",
  UNKNOWN: "UNKNOWN"
};

class AppError extends Error {
  /**
   * @param {string} code Stable machine code, e.g. OPENAI_RATE_LIMIT
   * @param {string} message Human-readable message
   * @param {object} [options]
   * @param {keyof typeof CATEGORIES} [options.category]
   * @param {number} [options.httpStatus]
   * @param {Record<string, unknown>} [options.details]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.category = options.category || CATEGORIES.UNKNOWN;
    this.httpStatus = options.httpStatus;
    this.details = options.details && typeof options.details === "object" ? options.details : undefined;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      httpStatus: this.httpStatus,
      details: this.details
    };
  }
}

module.exports = { AppError, ERROR_CATEGORIES: CATEGORIES };
