/**
 * Request validation.
 *
 * v1 sanitised input by stripping quotes and backslashes from every string,
 * which corrupted legitimate data (`O'Brien` became `OBrien`) while providing
 * no real protection: Drizzle, like Sequelize before it, sends values as bound
 * parameters, so SQL injection was never the exposure.
 *
 * The real rule is: validate shape and length on the way in, and escape on the
 * way *out* according to the destination. Storing exactly what the user typed
 * is correct.
 */
// `Request` must be imported explicitly: @types/node declares a global `Request`
// (the fetch API one), which would otherwise shadow Express's and produce
// baffling "missing properties: cache, credentials, destination" errors.
import type { Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validate and replace `req.body` / `req.query` / `req.params` with the parsed
 * result, so handlers receive coerced, trusted values.
 *
 * Parsing also *strips unknown keys* (zod objects are non-passthrough by
 * default). That is a security property, not a convenience: it stops mass
 * assignment, where a client posts `{"role":"root"}` alongside legitimate
 * fields and hopes it reaches an update statement.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) {
        Object.assign(req.params, schemas.params.parse(req.params));
      }

      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Express 5 exposes `req.query` via a getter, so it cannot be assigned
        // directly. The parsed object is stashed and read via `validatedQuery`.
        Object.defineProperty(req, '_validatedQuery', { value: parsed, configurable: true });
      }

      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      next();
    } catch (error) {
      next(error); // ZodError is rendered as a 422 by the error handler.
    }
  };
}

/**
 * Read the query object produced by `validate({ query })`.
 *
 * Typed as `Request` rather than a structural `{ _validatedQuery?: unknown }`,
 * because TypeScript's weak-type check rejects passing a full `Request` to a
 * parameter whose only members are optional.
 */
export function validatedQuery<T>(req: Request): T {
  return (req as Request & { _validatedQuery?: unknown })._validatedQuery as T;
}
