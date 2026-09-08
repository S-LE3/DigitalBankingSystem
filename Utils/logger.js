/* eslint-disable no-console */

const serializeError = error => ({
  name: error.name,
  message: error.message,
  stack: error.stack
});

const serializeContext = context => {
  if (!context) return '';

  try {
    return ` ${JSON.stringify(context, (_, value) => {
      if (value instanceof Error) return serializeError(value);
      return value;
    })}`;
  } catch {
    return ' [unserializable log context]';
  }
};

const write = (level, message, context) => {
  const entry = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeContext(context)}`;

  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
};

module.exports = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  // Pure stream interface binding to guarantee complete Morgan and winston compatibility
  stream: {
    write: message => {
      if (message) write('http', message.trim());
    }
  }
};
