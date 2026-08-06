/**
 * Token routes: `/api/tokens/*`
 *
 * Management only. The tokens minted here authenticate the public read API in
 * `modules/public`; nothing in this module accepts one as a credential, so a
 * leaked token can never be used to mint another.
 */
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { TOKEN_SCOPES } from '../../lib/api-tokens.js';
import { createTokenSchema, tokenIdParamSchema } from './tokens.schemas.js';
import * as service from './tokens.service.js';

const router: Router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    res.status(200).json({
      tokens: await service.listTokens(auth.userId),
      // Shipped with the list so the create form offers exactly the scopes this
      // build understands, instead of a copy that drifts from the server's.
      availableScopes: TOKEN_SCOPES,
    });
  }),
);

/**
 * Mint a token.
 *
 * `token` carries the plaintext, and this is the only response that will ever
 * contain it: only a digest is stored, so nothing here or later can reproduce
 * it. `apiToken` is the row the list endpoint would show. The client has to
 * display the secret once and say plainly that it will not be shown again.
 */
router.post(
  '/',
  writeLimiter,
  validate({ body: createTokenSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { token, plaintext } = await service.createToken(auth.userId, req.body);

    await recordAudit(req, {
      action: 'token.create',
      targetType: 'api_token',
      targetId: token.id,
      // The scopes and the expiry are the whole of what this credential can do,
      // so they belong in the record rather than just the name.
      metadata: { name: token.name, scopes: token.scopes, expiresAt: token.expiresAt },
    });

    res.status(201).json({ token: plaintext, apiToken: token });
  }),
);

router.delete(
  '/:id',
  writeLimiter,
  validate({ params: tokenIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const revoked = await service.revokeToken(auth.userId, id);

    await recordAudit(req, {
      action: 'token.revoke',
      targetType: 'api_token',
      targetId: revoked.id,
      metadata: { name: revoked.name },
    });

    res.status(204).end();
  }),
);

router.get(
  '/:id/usage',
  validate({ params: tokenIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    res.status(200).json({ usage: await service.getTokenUsage(auth.userId, id) });
  }),
);

export default router;
