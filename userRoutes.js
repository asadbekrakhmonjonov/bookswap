const express = require('express');
const { getDb } = require('./connect');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sanitize = require('mongo-sanitize');

const userRoutes = express.Router();

userRoutes.use(helmet());
userRoutes.use(express.json({ limit: '10kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  handler: (_, res) => res.status(429).json({
    success: false,
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMITED'
  })
});

userRoutes.use('/login', authLimiter);
userRoutes.use('/', authLimiter);

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS) || 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MINUTES = 15;

const generateToken = (userId) => jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
const sanitizeInput = (input) => sanitize(input);

const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new Error('Missing token');
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(decoded.id),
      isActive: true
    });
    
    if (!user) throw new Error('User not found');
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Not authorized',
      code: 'NOT_AUTHORIZED'
    });
  }
};

const validate = (schemas) => async (req, res, next) => {
  await Promise.all(schemas.map(schema => schema.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
      code: 'VALIDATION_ERROR'
    });
  }
  next();
};

const registerSchema = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/),
  body('email').trim().isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$/)
];

const loginSchema = [
  body('email').trim().isEmail(),
  body('password').exists()
];

const updateSchema = [
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 30 }),
  body('email')
    .optional()
    .trim()
    .isEmail(),
  body('password')
    .optional()
    .isLength({ min: 8 }),
  body('currentPassword')
    .if(body('password').exists())
    .notEmpty()
];

userRoutes.post('/', validate(registerSchema), async (req, res) => {
  try {
    const db = getDb();
    const { username, email, password } = req.body;
    const sanitized = {
      username: sanitizeInput(username),
      email: sanitizeInput(email)
    };

    const existing = await db.collection("users").findOne({
      $or: [
        { username: sanitized.username },
        { email: sanitized.email }
      ]
    });
    
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Username or email already exists',
        code: 'USER_EXISTS'
      });
    }

    const hashedPassword = await bcrypt.hash(sanitizeInput(password), SALT_ROUNDS);
    const user = {
      ...sanitized,
      password: hashedPassword,
      joinDate: new Date(),
      lastLogin: null,
      loginAttempts: 0,
      isActive: true,
      role: 'user',
      profile: {}
    };

    const result = await db.collection("users").insertOne(user);
    const token = generateToken(result.insertedId.toString());

    res.status(201).json({
      success: true,
      data: {
        _id: result.insertedId,
        username: user.username,
        email: user.email,
        joinDate: user.joinDate,
        token
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

userRoutes.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;
    const sanitizedEmail = sanitizeInput(email);

    const user = await db.collection('users').findOne({ email: sanitizedEmail });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      const minutesSinceLastAttempt = (new Date() - (user.lastFailedLogin || new Date())) / (1000 * 60);
      if (minutesSinceLastAttempt < LOGIN_WINDOW_MINUTES) {
        return res.status(429).json({
          success: false,
          error: `Account locked. Try again in ${Math.ceil(LOGIN_WINDOW_MINUTES - minutesSinceLastAttempt)} minutes.`,
          code: 'ACCOUNT_LOCKED'
        });
      }
    }

    const validPassword = await bcrypt.compare(sanitizeInput(password), user.password);
    if (!validPassword) {
      await db.collection('users').updateOne(
        { _id: user._id },
        { 
          $inc: { loginAttempts: 1 },
          $set: { lastFailedLogin: new Date() }
        }
      );
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          loginAttempts: 0,
          lastLogin: new Date() 
        }
      }
    );

    const token = generateToken(user._id.toString());

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        token
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

userRoutes.get('/me', authenticateUser, async (req, res) => {
  res.json({
    success: true,
    data: {
      _id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      profile: req.user.profile,
      joinDate: req.user.joinDate
    }
  });
});

userRoutes.put('/me', authenticateUser, validate(updateSchema), async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user._id;
    const updates = {};
    const { currentPassword, password, email, username } = req.body;

    if (password) {
      const validCurrent = await bcrypt.compare(sanitizeInput(currentPassword), req.user.password);
      if (!validCurrent) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
          code: 'INVALID_PASSWORD'
        });
      }
      updates.password = await bcrypt.hash(sanitizeInput(password), SALT_ROUNDS);
    }

    if (email && email !== req.user.email) {
      const existing = await db.collection('users').findOne({ 
        email: sanitizeInput(email),
        _id: { $ne: new ObjectId(userId) }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Email already in use',
          code: 'EMAIL_IN_USE'
        });
      }
      updates.email = sanitizeInput(email);
    }

    if (username && username !== req.user.username) {
      const existing = await db.collection('users').findOne({ 
        username: sanitizeInput(username),
        _id: { $ne: new ObjectId(userId) }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Username already in use',
          code: 'USERNAME_IN_USE'
        });
      }
      updates.username = sanitizeInput(username);
    }

    if (req.body.profile) {
      updates.profile = {
        ...req.user.profile,
        ...req.body.profile
      };
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided',
        code: 'NO_UPDATES'
      });
    }

    updates.updatedAt = new Date();
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updates }
    );

    const updatedUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });

    res.json({
      success: true,
      data: {
        _id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        profile: updatedUser.profile,
        updatedAt: updatedUser.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});
userRoutes.get('/:id', authenticateUser, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.params.id;

    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
        code: 'INVALID_ID'
      });
    }

    const user = await db.collection('users').findOne({ _id: new ObjectId(userId), isActive: true });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        joinDate: user.joinDate
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});


userRoutes.delete('/me', authenticateUser, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user._id;

    const result = await db.collection('users').deleteOne({ 
      _id: new ObjectId(userId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

module.exports = { userRoutes, authenticateUser };
