const mongoose = require('mongoose');
const catchAsync = require('../Utils/catchAsync');
const AppError = require('../Utils/appError');
const Account = require('../Models/accountModel');
const Transaction = require('../Models/transactionModel');
const nibssService = require('../Services/nibssService');

exports.nameEnquiry = catchAsync(async (req, res, next) => {
  if (!req.body.accountNumber) {
    return next(new AppError('Please provide account number.', 400));
  }
  const localAccount = await Account.findOne({
    accountNumber: req.body.accountNumber
  }).populate('user');
  if (localAccount) {
    res.status(200).json({
      status: 'success',
      data: {
        name: localAccount.user.name,
        accountNumber: localAccount.accountNumber,
        bankName: process.env.BANK_NAME || 'RAI Bank'
      }
    });
    return;
  }

  //Wrap Axios in a try/catch block to intercept 404/500 API responses gracefully
  try {
    const validatedAccount = await nibssService.nameEnquiry(
      req.body.accountNumber
    );

    res.status(200).json({
      status: 'success',
      data: {
        name:
          validatedAccount.data?.accountName ||
          validatedAccount.data?.name ||
          validatedAccount.data,
        accountNumber: req.body.accountNumber
      }
    });
  } catch {
    // If Axios fails because of an invalid account number or NIBSS failure, return clean status
    return res.status(404).json({
      status: 'fail',
      message: 'Account number not found or service unavailable.'
    });
  }
});

exports.transfer = catchAsync(async (req, res, next) => {
  const { receivingAccountNumber, amount, description } = req.body;
  const transferAmount = Number(amount);
  const transferAmountInKobo = Math.round(transferAmount * 100);

  // Input Validations
  if (
    !receivingAccountNumber ||
    !description ||
    !Number.isFinite(transferAmount)
  ) {
    return next(
      new AppError(
        'Please provide receiving account number, amount, and description.',
        400
      )
    );
  }

  if (transferAmount <= 0) {
    return next(
      new AppError('Transaction amount must be greater than zero.', 400)
    );
  }

  // Locate Sender Account
  const senderAccount = await Account.findOne({ user: req.user._id }).populate(
    'user'
  );
  if (!senderAccount) {
    return next(new AppError('Sender account not found.', 404));
  }

  if (senderAccount.accountNumber === receivingAccountNumber) {
    return next(new AppError('You cannot transfer money to yourself.', 400));
  }

  // Determine Destination (Internal or External)
  const receivingAccount = await Account.findOne({
    accountNumber: receivingAccountNumber
  }).populate('user');
  const isInternal = !!receivingAccount;

  let externalReceiverName = '';
  let providerReference;
  let transaction;
  let providerTransferSucceeded = false;
  const externalReceivingAccount = new mongoose.Types.ObjectId();

  // If external, run a silent Name Enquiry via NIBSS wrapper to confirm it exists
  if (!isInternal) {
    try {
      const nameEnquiryRes = await nibssService.nameEnquiry(
        receivingAccountNumber
      );

      externalReceiverName =
        nameEnquiryRes.data?.accountName ||
        nameEnquiryRes.data?.name ||
        nameEnquiryRes.data;
    } catch {
      return next(
        new AppError(
          'Destination external account not found or interbank network down.',
          404
        )
      );
    }
  }

  // Adaptive Transaction Setup
  const session = await mongoose.startSession();
  const topologyType = mongoose.connection.client?.topology?.description?.type;
  const useTransactions =
    isInternal && topologyType && topologyType !== 'Single';

  if (useTransactions) {
    session.startTransaction();
  } else {
    // Standalone MongoDB instances do not support transaction-numbered writes.
    session.endSession();
  }

  let credited = false;

  try {
    const queryOptions = { new: true, runSettersOnQuery: true };
    if (useTransactions) queryOptions.session = session;

    // Debit the sender with an optimistic check
    const debitedAccount = await Account.findOneAndUpdate(
      { _id: senderAccount._id, balance: { $gte: transferAmountInKobo } },
      { $inc: { balance: -transferAmount }, $set: { updatedAt: new Date() } },
      queryOptions
    );

    if (!debitedAccount) {
      throw new AppError('Insufficient account balance.', 400);
    }

    const updateOptions = { runSettersOnQuery: true };
    if (useTransactions) updateOptions.session = session;

    // If internal, credit the local recipient
    if (isInternal) {
      const creditedAccount = await Account.findByIdAndUpdate(
        receivingAccount._id,
        { $inc: { balance: transferAmount }, $set: { updatedAt: new Date() } },
        updateOptions
      );
      if (creditedAccount) credited = true;
    } else {
      transaction = await Transaction.create({
        senderAccount: senderAccount._id,
        senderAccountNumber: senderAccount.accountNumber,
        senderName: senderAccount.user.name,
        receivingAccount: externalReceivingAccount,
        receivingAccountNumber: receivingAccountNumber,
        receivingName: externalReceiverName,
        description,
        amount: transferAmount,
        type: 'transfer',
        status: 'pending'
      });

      // EXTERNAL INTERBANK DISBURSEMENT API GATEWAY WIRE
      const providerResponse = await nibssService.transfer({
        from: senderAccount.accountNumber,
        to: receivingAccountNumber,
        amount: transferAmount
      });
      const providerData = providerResponse.data?.data || providerResponse.data;
      providerReference =
        providerData?.ref ||
        providerData?.reference ||
        providerData?.transactionRef ||
        providerData?.transactionReference ||
        providerData?.transactionId;
      providerTransferSucceeded = true;

      if (!providerReference) {
        throw new AppError(
          'NIBSS transfer completed without a transaction reference.',
          502
        );
      }

      transaction.providerReference = providerReference;
      transaction.status = 'success';
      await transaction.save();
    }

    // Generate Ledger Transaction Receipt Record
    if (useTransactions) {
      const createdTx = await Transaction.create(
        [
          {
            senderAccount: senderAccount._id,
            senderAccountNumber: senderAccount.accountNumber,
            senderName: senderAccount.user.name,
            receivingAccount: isInternal
              ? receivingAccount._id
              : new mongoose.Types.ObjectId(),
            receivingAccountNumber: receivingAccountNumber,
            receivingName: isInternal
              ? receivingAccount.user.name
              : externalReceiverName,
            providerReference,
            description,
            amount: transferAmount,
            type: 'transfer',
            status: 'success'
          }
        ],
        { session }
      );
      transaction = createdTx[0]; // Extract from session array wrapper
      await session.commitTransaction();
      session.endSession();
    } else if (isInternal) {
      transaction = await Transaction.create({
        senderAccount: senderAccount._id,
        senderAccountNumber: senderAccount.accountNumber,
        senderName: senderAccount.user.name,
        receivingAccount: isInternal
          ? receivingAccount._id
          : new mongoose.Types.ObjectId(),
        receivingAccountNumber: receivingAccountNumber,
        receivingName: isInternal
          ? receivingAccount.user.name
          : externalReceiverName,
        providerReference,
        description,
        amount: transferAmount,
        type: 'transfer',
        status: 'success'
      });
    }

    return res.status(201).json({
      status: 'success',
      data: { transaction }
    });
  } catch (error) {
    if (useTransactions) {
      await session.abortTransaction();
      session.endSession();
    }

    if (!providerTransferSucceeded) {
      // Manual balance calculation reversal if transaction engine is absent
      await Account.findByIdAndUpdate(senderAccount._id, {
        $inc: { balance: transferAmount },
        $set: { updatedAt: new Date() }
      });

      if (credited && isInternal) {
        await Account.findByIdAndUpdate(receivingAccount._id, {
          $inc: { balance: -transferAmount },
          $set: { updatedAt: new Date() }
        });
      }
    }

    if (transaction && !providerTransferSucceeded) {
      transaction.status = 'failed';
      await transaction.save().catch(err =>
        // eslint-disable-next-line no-console
        console.error('Failed updating transaction failure trail:', err.message)
      );
    } else if (!transaction) {
      await Transaction.create({
        senderAccount: senderAccount._id,
        senderAccountNumber: senderAccount.accountNumber,
        senderName: senderAccount.user.name,
        receivingAccount: isInternal
          ? receivingAccount?._id
          : externalReceivingAccount,
        receivingAccountNumber: receivingAccountNumber,
        receivingName: isInternal
          ? receivingAccount?.user?.name
          : externalReceiverName || 'External Recipient',
        description: `[FAILED TRANSACTION] ${description}`,
        amount: transferAmount,
        type: 'transfer',
        status: 'failed'
      }).catch(err =>
        // eslint-disable-next-line no-console
        console.error('Failed logging transaction failure trail:', err.message)
      );
    }

    return next(error);
  }
});

exports.getMyTransactions = catchAsync(async (req, res, next) => {
  const account = await Account.findOne({ user: req.user._id });
  if (!account) {
    return next(new AppError('Account not found.', 404));
  }

  const transactions = await Transaction.find({
    $or: [{ senderAccount: account._id }, { receivingAccount: account._id }]
  }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: transactions.length,
    data: { transactions }
  });
});

exports.getTransactionStatus = catchAsync(async (req, res, next) => {
  // Find the transaction by its URL parameter ID
  const transaction = await Transaction.findById(req.params.id);

  if (!transaction) {
    return next(new AppError('No transaction found with that ID.', 404));
  }

  // DATA ISOLATION ENFORCEMENT
  // Get the logged-in user's account to cross-verify ownership bounds
  const account = await Account.findOne({ user: req.user._id });

  const isSender = transaction.senderAccount.equals(account?._id);
  const isReceiver = transaction.receivingAccount.equals(account?._id);

  if (!isSender && !isReceiver) {
    return next(
      new AppError(
        'You do not have permission to view this transaction data.',
        403
      )
    );
  }

  const { status: localStatus } = transaction;
  let status = localStatus;
  let providerStatus;
  if (transaction.providerReference) {
    const providerResponse = await nibssService.getTransaction(
      transaction.providerReference
    );
    const providerData = providerResponse.data?.data || providerResponse.data;
    providerStatus = providerData?.status || providerData?.transactionStatus;
    if (providerStatus) status = providerStatus;
  }

  // Return only the necessary tracking metadata
  res.status(200).json({
    status: 'success',
    data: {
      transactionId: transaction._id,
      type: transaction.type,
      status,
      providerReference: transaction.providerReference,
      providerStatus,
      amount: transaction.amount,
      createdAt: transaction.createdAt
    }
  });
});
