const { createTodoSchema, checkedTodoSchema } = require('../utils/validation');
const Todo = require('../models/todos');

/**
 * Get all todos for authenticated user
 * GET /api/todos
 */
const getAllTodos = async (req, res) => {
  try {
    const { user_id } = res.locals.userAuth;
    
    const todoList = await Todo.findAll({
      where: { user_id },
      order: [['id', 'DESC']],
      attributes: ['id', 'text', 'time', 'checked', 'createdAt', 'updatedAt']
    });
    
    res.status(200).json({ 
      message: 'Todo list retrieved successfully', 
      todoList,
      count: todoList.length
    });
  } catch (err) {
    console.error('Get todos error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get single todo by ID
 * GET /api/todos/:id
 */
const getTodoById = async (req, res) => {
  try {
    const { user_id } = res.locals.userAuth;
    const { id } = req.params;

    const todoItem = await Todo.findOne({ 
      where: { id, user_id },
      attributes: ['id', 'text', 'time', 'checked', 'createdAt', 'updatedAt']
    });

    if (!todoItem) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.status(200).json({ message: 'Todo retrieved successfully', todoItem });
  } catch (err) {
    console.error('Get todo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create new todo
 * POST /api/todos
 */
const createTodo = async (req, res) => {
  try {
    const { error } = createTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { user_id } = res.locals.userAuth;
    const { text, time } = req.body;

    const newTodo = await Todo.create({
      user_id,
      text,
      time,
      checked: false
    });

    res.status(201).json({ 
      message: 'Todo created successfully',
      todo: {
        id: newTodo.id,
        text: newTodo.text,
        time: newTodo.time,
        checked: newTodo.checked
      }
    });
  } catch (err) {
    console.error('Create todo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update todo text and time
 * PUT /api/todos/:id
 */
const updateTodo = async (req, res) => {
  try {
    const { error } = createTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { user_id } = res.locals.userAuth;
    const { id } = req.params;
    const { text, time } = req.body;

    const [updatedCount] = await Todo.update(
      { text, time },
      { where: { id, user_id } }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.status(200).json({ message: 'Todo updated successfully' });
  } catch (err) {
    console.error('Update todo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update todo checked status
 * PATCH /api/todos/:id/check
 */
const updateTodoCheck = async (req, res) => {
  try {
    const { error } = checkedTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { user_id } = res.locals.userAuth;
    const { id } = req.params;
    const { checked } = req.body;

    const [updatedCount] = await Todo.update(
      { checked },
      { where: { id, user_id } }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.status(200).json({ 
      message: checked ? 'Task marked as completed' : 'Task marked as pending'
    });
  } catch (err) {
    console.error('Update todo check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete todo
 * DELETE /api/todos/:id
 */
const deleteTodo = async (req, res) => {
  try {
    const { user_id } = res.locals.userAuth;
    const { id } = req.params;

    const deletedCount = await Todo.destroy({ 
      where: { id, user_id } 
    });

    if (!deletedCount) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.status(200).json({ message: 'Todo deleted successfully' });
  } catch (err) {
    console.error('Delete todo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getAllTodos,
  getTodoById,
  createTodo,
  updateTodo,
  updateTodoCheck,
  deleteTodo,
};
