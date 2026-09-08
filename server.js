const dotenv = require('dotenv');

dotenv.config({ path: './.env' });

const mongoose = require('mongoose');
const logger = require('./Utils/logger');
const User = require('./Models/userModel');
// const authController = require('./Controllers/authController');

process.on('uncaughtException', err => {
  logger.error('Uncaught exception. Shutting down.', { error: err });
  process.exit(1);
});

const app = require('./app');

const DB = process.env.MONGO_CONNECTION;

mongoose.connect(DB).then(async () => {
  logger.info('MongoDB connected');

  try {
    // Cleans out conflicting legacy indexes and forces a sync of the new 1:1 unique parameters
    await User.cleanIndexes();
    await User.syncIndexes();
    logger.info('User Model Indexes Synchronized Perfectly');
  } catch (err) {
    logger.warn(
      'Index sync warning (likely due to existing duplicate records in database):',
      { message: err.message }
    );
  }
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  logger.info('Application started', {
    port,
    environment: process.env.NODE_ENV
  });
});

process.on('unhandledRejection', err => {
  logger.error('Unhandled rejection. Shutting down.', { error: err });
  server.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    logger.info('Process terminated.');
  });
});
