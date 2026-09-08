const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    senderAccount: {
      type: mongoose.Schema.ObjectId,
      ref: 'Account',
      required: [true, 'Sender account is required']
    },
    senderAccountNumber: {
      type: String,
      required: [true, 'Sender account number is required']
    },
    senderName: {
      type: String,
      required: [true, 'Sender name is required']
    },
    receivingAccount: {
      type: mongoose.Schema.ObjectId,
      ref: 'Account',
      required: [true, 'Receiving account is required']
    },
    receivingAccountNumber: {
      type: String,
      required: [true, 'Receiving account number is required']
    },
    receivingName: {
      type: String,
      required: [true, 'Receiving name is required']
    },
    providerReference: {
      type: String,
      sparse: true
    },
    description: {
      type: String,
      required: [false, 'Transaction description is optional'],
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters']
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Transaction amount must be greater than zero'],
      // Exact decimal protection matching the Account Model
      set: val => Math.round(val * 100),
      get: val => val / 100
    },
    // State Tracking Fields
    type: {
      type: String,
      required: true,
      enum: {
        values: ['transfer', 'deposit', 'withdrawal'],
        message: 'Type must be transfer, deposit, or withdrawal'
      },
      default: 'transfer'
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ['pending', 'success', 'failed'],
        message: 'Status must be pending, success, or failed'
      },
      default: 'success'
    }
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    runSettersOnQuery: true
  }
);

transactionSchema.index({ senderAccount: 1, createdAt: -1 });
transactionSchema.index({ receivingAccount: 1, createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
