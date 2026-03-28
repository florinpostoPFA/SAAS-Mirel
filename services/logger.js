/**
 * Simple logger utility
 * Can be extended to use winston, pino, etc.
 */

function log(level, source, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}] [${source}]`;
  
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function info(source, message, data) {
  log("INFO", source, message, data);
}

function debug(source, message, data) {
  log("DEBUG", source, message, data);
}

function error(source, message, data) {
  log("ERROR", source, message, data);
}

module.exports = { info, debug, error };
