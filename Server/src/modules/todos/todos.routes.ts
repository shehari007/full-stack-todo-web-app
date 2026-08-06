/**
 * Task routes: `/api/todos/*`
 */
import { Router } from 'express';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import {
  bulkTodoSchema,
  createTodoSchema,
  listTodosQuerySchema,
  reorderTodosSchema,
  todoIdParamSchema,
  updateTodoSchema,
  type BulkTodoInput,
  type ReorderTodosInput,
  type TodoListQuery,
} from './todos.schemas.js';
import * as service from './todos.service.js';

const router: Router = Router();

/*
 * `requireAuth` is applied where this router is mounted, and is deliberately not
 * repeated here: it costs a user lookup per request. Every handler still reads
 * the caller through `requireAuthContext`, so a mount that forgot the middleware
 * fails as a 401 rather than serving somebody else's tasks.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/',
  validate({ query: listTodosQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const query = validatedQuery<TodoListQuery>(req);

    const { todos, pagination } = await service.listTodos(auth.userId, query);
    res.status(200).json({ todos, pagination });
  }),
);

/** Declared before `/:id`; otherwise "stats" is parsed as a task id. */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const stats = await service.getStats(auth.userId);

    res.status(200).json({ stats });
  }),
);

router.get(
  '/:id',
  validate({ params: todoIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const todo = await service.getTodo(auth.userId, id);
    res.status(200).json({ todo });
  }),
);

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/',
  writeLimiter,
  validate({ body: createTodoSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const todo = await service.createTodo(auth.userId, req.body);

    res.status(201).json({ todo });
  }),
);

router.patch(
  '/:id',
  writeLimiter,
  validate({ params: todoIdParamSchema, body: updateTodoSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const todo = await service.updateTodo(auth.userId, id, req.body);
    res.status(200).json({ todo });
  }),
);

/**
 * Soft delete. The updated row is returned rather than a bare 204 so the client
 * has everything it needs to offer an undo without re-fetching.
 */
router.delete(
  '/:id',
  writeLimiter,
  validate({ params: todoIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const todo = await service.softDeleteTodo(auth.userId, id);
    res.status(200).json({ todo });
  }),
);

router.post(
  '/:id/restore',
  writeLimiter,
  validate({ params: todoIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const todo = await service.restoreTodo(auth.userId, id);
    res.status(200).json({ todo });
  }),
);

/* -------------------------------------------------------------------------- */
/* Batch operations                                                           */
/* -------------------------------------------------------------------------- */

router.post(
  '/bulk',
  writeLimiter,
  validate({ body: bulkTodoSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const input = req.body as BulkTodoInput;

    const ids = await service.bulkMutate(auth.userId, input);

    // Only the destructive action is audited. Bulk completion is routine; a
    // batch that empties someone's board is the one worth being able to explain
    // afterwards, and the ids are recorded because the rows themselves are only
    // soft-deleted and can still be brought back.
    if (input.action === 'delete') {
      await recordAudit(req, {
        action: 'todo.bulk_delete',
        targetType: 'todo',
        metadata: { requested: input.ids.length, deleted: ids.length, ids },
      });
    }

    res.status(200).json({ result: { action: input.action, affected: ids.length, ids } });
  }),
);

router.post(
  '/reorder',
  writeLimiter,
  validate({ body: reorderTodosSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { ids } = req.body as ReorderTodosInput;

    const reordered = await service.reorderTodos(auth.userId, ids);
    res.status(200).json({ result: { affected: reordered.length, ids: reordered } });
  }),
);

export default router;
