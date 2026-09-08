// Account: Account number, Balance, 1:M Transaction, 1:1 User

const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    accountNumber: {
      type: String,
      required: [true, 'Please provide an account number!'],
      unique: true
    },
    balance: {
      type: Number,
      default: 15000, // 15,000 Naira, stored as 1,500,000 Kobo by the setter
      min: [0, 'Account balance cannot be negative!'], // Prevents accidental overdrafts
      // Floating point decimal safety
      // Stores currency safely as an integer (e.g., Kobo/Cents) behind the scenes, reads as standard float
      set: val => Math.round(val * 100),
      get: val => val / 100
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      default: null,
      unique: true,
      required: [true, 'User is required for an account!']
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    // Required so getters execute when transforming documents to JSON or Objects
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
    // Forces background queries ($inc, $set) to respect your currency math multipliers
    runSettersOnQuery: true
  }
);

accountSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

accountSchema.virtual('outgoingTransactions', {
  ref: 'Transaction',
  foreignField: 'senderAccount',
  localField: '_id'
});

accountSchema.virtual('receivingAccountTransactions', {
  ref: 'Transaction',
  foreignField: 'receivingAccount',
  localField: '_id'
});

const Account = mongoose.model('Account', accountSchema);

module.exports = Account;
