const express = require('express');
const cors = require('cors');
const connect = require('./connect');
const { bookRoutes } = require('./bookRoutes');
const { userRoutes } = require('./userRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: "*", // Consider restricting this in production
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Routes
app.use('/api/books', bookRoutes);
app.use('/api/users', userRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('BookSwap API is running');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Modified server startup for Vercel
module.exports = app;

// Only listen locally when not in Vercel environment
if (process.env.VERCEL_ENV !== 'production') {
  app.listen(PORT, async () => {
    try {
      await connect.connectToServer();
      console.log(`✅ Server is running on http://localhost:${PORT}`);
    } catch (err) {
      console.error('❌ Failed to connect to the database:', err);
      process.exit(1);
    }
  });
}