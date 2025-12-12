const { userSchema } = require('../utils/validation');
const { cryptPSW, checkPSW } = require('../utils/hashPSW');
const { createJWT } = require('../utils/jwt');
const User = require('../models/users');

/**
 * User Login
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { error } = userSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { username, password } = req.body;

    const user = await User.findOne({ 
      where: { username },
      attributes: ['id', 'username', 'password'] 
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await checkPSW(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const JWTAccessToken = createJWT(user.id);
    
    res.status(200).json({ 
      message: 'User authenticated successfully', 
      finalData: { 
        JWTAccessToken, 
        userDetails: user.username 
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * User Registration
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { error } = userSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { username, password } = req.body;

    // Check if username exists
    const existingUser = await User.findOne({ 
      where: { username },
      attributes: ['id'] 
    });
    
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashedPassword = await cryptPSW(password);

    await User.create({
      username,
      password: hashedPassword,
    });

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  login,
  register,
};
