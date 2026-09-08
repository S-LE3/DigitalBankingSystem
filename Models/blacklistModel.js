const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '1h' // Matches your JWT_REFRESH_EXPIRES_IN; MongoDB auto-deletes this row after 1 hour
  }
});

module.exports = mongoose.model('Blacklist', blacklistSchema);
