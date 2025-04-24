const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config({ path: "./config.env" });

// Connection URI and options
const client = new MongoClient(process.env.ATLAS_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10, // Limit connection pool size
  connectTimeoutMS: 5000, // Fail fast if can't connect
  socketTimeoutMS: 30000 // Close idle connections
});

let database;
let connectionPromise;

module.exports = {
  connectToServer: async () => {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        try {
          await client.connect();
          database = client.db('book-exchange-data');
          console.log("✅ Successfully connected to MongoDB");
          return database;
        } catch (err) {
          console.error('❌ MongoDB connection error:', err);
          throw err;
        }
      })();
    }
    return connectionPromise;
  },

  getDb: () => {
    if (!database) throw new Error('Database not initialized. Call connectToServer first.');
    return database;
  },

  // For graceful shutdown in serverless environment
  closeConnection: async () => {
    try {
      if (client) {
        await client.close();
        console.log("MongoDB connection closed");
      }
    } catch (err) {
      console.error('Error closing MongoDB connection:', err);
    } finally {
      database = null;
      connectionPromise = null;
    }
  }
};

// Handle Vercel serverless function cleanup
if (process.env.VERCEL_ENV) {
  process.on('SIGTERM', async () => {
    await module.exports.closeConnection();
    process.exit(0);
  });
}