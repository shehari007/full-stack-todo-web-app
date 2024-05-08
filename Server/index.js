const express = require('express')
const dotenv = require('dotenv').config()
const cors = require('cors');
const { userSchema, createTodoSchema, checkedTodoSchema } = require('./utils/validation');
const { cryptPSW, checkPSW } = require('./utils/hashPSW');
const User = require('./models/users');
const { createJWT } = require('./utils/jwt');
const Todo = require('./models/todos');
const { verifyUser } = require('./middleware/middleware');
const app = express()

const corsOrigin = {
  origin: process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()),
  credentials: true,
  methods: process.env.ALLOWED_METHODS.split(',').map(method => method.trim()),
};

app.use(cors(corsOrigin))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// ROUTES
app.get('/', (req, res) => {
  res.status(200).send('Server Up and Running!')
})
app.delete('/delete/:id', verifyUser, async (req, res) => {
  try {
    const deleteTodo = await Todo.destroy({ where: { id: req.params.id } });

    if (!deleteTodo) {
      return res.status(404).json({ message: "Todo not found" });
    }
    return res.status(200).json({ message: "Todo Task deleted successfully!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});
app.put('/update/:id', verifyUser, async (req, res) => {
  console.log(req.params.id)
  try {

    const { error } = createTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { user_id } = res.locals.userAuth;
    const { text, time } = req.body;

    const [updatedCount, updatedTodo] = await Todo.update(
      { text, time },
      { where: { id: req.params.id, user_id }, returning: true }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Todo task not found for the user' });
    }

    res.status(200).json({ message: 'Todo Task Updated Successfully!' });
  } catch (err) {
    console.error('Todo Task update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.put('/updateCheck/:id', verifyUser, async (req, res) => {
  try {

    const { error } = checkedTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { user_id } = res.locals.userAuth;
    const { checked } = req.body;

    const [updatedCount, updatedTodo] = await Todo.update(
      { checked },
      { where: { id: req.params.id, user_id }, returning: true }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Todo task not found for the user' });
    }

    res.status(200).json({ message: checked === true? 'Todo Task Set Completed Successfully!' : 'Todo Task Set incompleted Successfully' });
  } catch (err) {
    console.error('Todo Task update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.post('/create', verifyUser, async (req, res) => {
  try {

    const { error } = createTodoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { user_id } = res.locals.userAuth;
    const { text, time } = req.body;

    await Todo.create({
      user_id: user_id,
      text: text,
      time: time,
      checked: false
    });

    res.status(200).json({ message: 'Todo Task Created Successfully!' });
  } catch (err) {
    console.error('Todo Task creation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get("/getAll", verifyUser, async (req, res) => {
  const { user_id } = res.locals.userAuth;
  const todoList = await Todo.findAll({
    where: { user_id },
    order: [['id', 'DESC']]
  });
  res.status(200).json({ message: 'Todo list found', todoList });
});

app.get("/getOne/:id", verifyUser, async (req, res) => {
  try {
    const { user_id } = res.locals.userAuth;
    const todoItem = await Todo.findOne({ where: { id: req.params.id, user_id } });

    if (!todoItem) {
      return res.status(404).json({ message: 'Todo item not found' });
    }

    res.status(200).json({ message: 'Todo item found', todoItem });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  try {
    // Validate request body
    const { error } = userSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const { username, password } = req.body;

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'no user found!' });
    }
    const ComparePSW = await checkPSW(password, user.password);
    if (!ComparePSW) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const JWTAccessToken = createJWT(user.id);
    const finalData = { JWTAccessToken: JWTAccessToken, userDetails: user.username}
    res.status(200).json({ message: ' User Authenticated successfully', finalData });
  } catch (err) {
    console.error('User login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/register', async (req, res) => {
  try {

    const { error } = userSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { username, password } = req.body;
    const hashedPassword = await cryptPSW(password);

    await User.create({
      username: username,
      password: hashedPassword,
    });

    res.status(200).json({ message: 'User added successfully' });
  } catch (err) {
    console.error('User creation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SERVER SETUP
const PORT = process.env.PORT || 8000
app.listen(PORT, () => console.log(`server on port ${PORT}`))