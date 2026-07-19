'use strict';

// A small HTTP error type plus an async wrapper so route handlers can throw and
// let the central error handler translate to JSON.

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || null;
  }
}

const badRequest = (msg, code) => new HttpError(400, msg, code);
const unauthorized = (msg, code) => new HttpError(401, msg || 'Avtorizatsiya talab qilinadi.', code);
const forbidden = (msg, code) => new HttpError(403, msg || 'Ruxsat yo‘q.', code);
const notFound = (msg, code) => new HttpError(404, msg || 'Topilmadi.', code);
const tooMany = (msg, code) => new HttpError(429, msg || 'Juda ko‘p so‘rov. Birozdan so‘ng urinib ko‘ring.', code);

// Wrap an async handler so rejected promises reach next() / the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, asyncHandler, badRequest, unauthorized, forbidden, notFound, tooMany };
