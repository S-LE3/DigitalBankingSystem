const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please tell us your name']
  },
  firstName: String,
  lastName: String,
  phone: String,
  bvn: {
    type: String
  },
  nin: {
    type: String
  },
  dob: {
    type: String,
    required: [true, 'Please provide your date of birth']
  },
  onboardingStatus: {
    type: String,
    enum: ['pending', 'verified'],
    default: 'pending'
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 8,
    select: false
  },
  account: {
    type: mongoose.Schema.ObjectId,
    ref: 'Account',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// These identifiers are optional, but any value that is provided must be
// unique. Partial indexes exclude missing/null values from the uniqueness
// constraint.

userSchema.index(
  { account: 1 },
  { unique: true, partialFilterExpression: { account: { $type: 'objectId' } } }
);

userSchema.index(
  { bvn: 1 },
  { unique: true, partialFilterExpression: { bvn: { $type: 'string' } } }
);
userSchema.index(
  { nin: 1 },
  { unique: true, partialFilterExpression: { nin: { $type: 'string' } } }
);

// This ensures no heavy database writes (like account creation) happen if the password fails validation.
userSchema.pre('save', async function (next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

const User = mongoose.model('User', userSchema);

module.exports = User;
