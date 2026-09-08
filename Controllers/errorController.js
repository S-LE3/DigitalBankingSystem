const AppError = require('../Utils/appError');
const logger = require('../Utils/logger');

const handleCastErrorDB = err => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = err => {
  // MongoDB exposes duplicate-key details through `keyValue` (and, in some
  // driver versions, only through `keyPattern`). Do not parse `errmsg` or
  // assume it exists; doing so can turn a duplicate-key response into a 500.
  const duplicateFields = Object.keys(err.keyValue || err.keyPattern || {});
  const fields = duplicateFields.length ? duplicateFields.join(', ') : 'field';

  const message = `Duplicate value for ${fields}. Please use another value!`;
  return new AppError(message, 400);
};

const isDuplicateKeyError = err => {
  const code = Number(err.code);
  const message = typeof err.message === 'string' ? err.message : '';

  return (
    code === 11000 ||
    code === 11001 ||
    /duplicate key/i.test(message) ||
    (Array.isArray(err.writeErrors) &&
      err.writeErrors.some(writeError => Number(writeError.code) === 11000))
  );
};

const handleValidationErrorDB = err => {
  const errors = Object.values(err.errors).map(el => el.message);

  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Intercept Axios network exceptions cleanly for bank verification steps
const handleAxiosError = err => {
  const operation = err.nibssOperation || 'NIBSS request';
  const providerMessage = err.response?.data?.message;
  const message = providerMessage
    ? `${operation} failed: ${providerMessage}`
    : `${operation} failed: External NIBSS service is currently unreachable.`;
  const statusCode = err.response?.status || 502;
  const appError = new AppError(message, statusCode);
  appError.nibssOperation = operation;
  return appError;
};

const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

const sendErrorDev = (err, req, res) => {
  // A) API

  return res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack
  });
};

const sendErrorProd = (err, req, res) => {
  // A) API
  // A) Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message
    });
  }
  // B) Programming or other unknown error: don't leak error details
  logger.error('Unhandled application error', {
    error: err,
    method: req.method,
    url: req.originalUrl
  });
  // Send generic message
  return res.status(500).json({
    status: 'error',
    message: 'Something went very wrong!'
  });
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (isDuplicateKeyError(err)) err = handleDuplicateFieldsDB(err);

  if (
    err.name === 'CastError' ||
    err.kind === 'ObjectId' ||
    /Cast to ObjectId failed/.test(err.message || '') ||
    /Cast to/.test(err.message || '')
  ) {
    err = handleCastErrorDB(err);
  }

  if (
    err.name === 'ValidationError' ||
    err._message === 'Validation failed' ||
    (err.errors && Object.keys(err.errors).length > 0)
  ) {
    err = handleValidationErrorDB(err);
  }

  if (err.name === 'JsonWebTokenError') err = handleJWTError();
  if (err.name === 'TokenExpiredError') err = handleJWTExpiredError();
  if (err.isAxiosError === true || err.name === 'AxiosError') {
    err = handleAxiosError(err);
  }

  if (process.env.NODE_ENV === 'development') {
    return sendErrorDev(err, req, res);
  }

  return sendErrorProd(err, req, res);
};
