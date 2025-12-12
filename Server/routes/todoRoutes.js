const express = require('express');
const router = express.Router();
const todoController = require('../controllers/todoController');
const { verifyUser } = require('../middleware/middleware');

// All routes require authentication
router.use(verifyUser);

/**
 * @route   GET /api/todos
 * @desc    Get all todos for authenticated user
 * @access  Private
 */
router.get('/', todoController.getAllTodos);

/**
 * @route   GET /api/todos/:id
 * @desc    Get single todo by ID
 * @access  Private
 */
router.get('/:id', todoController.getTodoById);

/**
 * @route   POST /api/todos
 * @desc    Create a new todo
 * @access  Private
 */
router.post('/', todoController.createTodo);

/**
 * @route   PUT /api/todos/:id
 * @desc    Update todo text and time
 * @access  Private
 */
router.put('/:id', todoController.updateTodo);

/**
 * @route   PATCH /api/todos/:id/check
 * @desc    Update todo checked status
 * @access  Private
 */
router.patch('/:id/check', todoController.updateTodoCheck);

/**
 * @route   DELETE /api/todos/:id
 * @desc    Delete a todo
 * @access  Private
 */
router.delete('/:id', todoController.deleteTodo);

module.exports = router;
