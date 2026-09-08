const Account = require('./../Models/accountModel');
const User = require('./../Models/userModel');
const catchAsync = require('./../Utils/catchAsync');
const AppError = require('./../Utils/appError');
const nibssService = require('../Services/nibssService');

exports.getMe = (req, res, next) => {
  const userDocument = req.user.toObject
    ? req.user.toObject()
    : { ...req.user };
  const user = {
    _id: userDocument._id,
    name: userDocument.name,
    firstName: userDocument.firstName,
    lastName: userDocument.lastName,
    phone: userDocument.phone,
    bvn: userDocument.bvn,
    nin: userDocument.nin,
    dob: userDocument.dob,
    onboardingStatus: userDocument.onboardingStatus,
    account: userDocument.account,
    createdAt: userDocument.createdAt,
    updatedAt: userDocument.updatedAt,
    __v: userDocument.__v
  };

  res.status(200).json({
    status: 'success',
    data: {
      user
    }
  });
};

exports.addNin = catchAsync(async (req, res, next) => {
  const { nin } = req.body;

  if (!nin) {
    return next(new AppError('Please provide a NIN.', 400));
  }

  if (req.user.nin === nin) {
    return res.status(200).json({
      status: 'success',
      message: 'NIN is already linked to this customer.'
    });
  }

  const existingUser = await User.findOne({ nin });
  if (existingUser && String(existingUser._id) !== String(req.user._id)) {
    return next(
      new AppError('This NIN is already linked to another customer.', 409)
    );
  }

  const verification = await nibssService.verifyIdentity({ nin });
  if (verification.status !== 200) {
    return next(new AppError('NIN verification failed.', 400));
  }

  req.user.nin = nin;
  await req.user.save();

  res.status(200).json({
    status: 'success',
    message: 'NIN linked successfully.',
    data: {
      user: {
        id: req.user._id,
        bvn: req.user.bvn,
        nin: req.user.nin
      }
    }
  });
});

exports.fetchAccountBalance = catchAsync(async (req, res, next) => {
  // Performance Optimization. Query the Account collection directly
  // using req.user.account reference already provided by your protect middleware.
  if (!req.user.account) {
    return next(
      new AppError('No bank account is linked to this user profile.', 404)
    );
  }

  const account = await Account.findById(req.user.account);

  // Safe Object Null-Guard Check to stop server crash if the account document is missing
  if (!account) {
    return next(
      new AppError('Linked bank account record could not be found.', 404)
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      balance: account.balance
    }
  });
});

exports.createAccount = catchAsync(async (req, res, next) => {
  if (req.user.onboardingStatus !== 'verified') {
    return next(
      new AppError(
        'Complete BVN or NIN onboarding before creating an account.',
        403
      )
    );
  }

  if (req.user.account) {
    return next(new AppError('This customer already has an account.', 409));
  }

  const kycID = req.user.bvn || req.user.nin;
  const accountsResponse = await nibssService.listAccounts();
  const providerAccounts = accountsResponse.data?.accounts || [];
  const existingProviderAccount = providerAccounts.find(
    providerAccount => String(providerAccount.kycID) === String(kycID)
  );

  if (existingProviderAccount?.accountNumber) {
    const account = await Account.create({
      accountNumber: existingProviderAccount.accountNumber,
      user: req.user._id
    });
    req.user.account = account._id;
    await req.user.save();

    return res.status(200).json({
      status: 'success',
      message: 'Existing provider account linked successfully.',
      data: { account }
    });
  }

  const providerResponse = await nibssService.createAccount({
    bvn: req.user.bvn,
    nin: req.user.nin,
    dob: req.user.dob
  });
  const providerData = providerResponse.data?.data || providerResponse.data;
  const accountNumber =
    providerData?.accountNumber || providerData?.account?.accountNumber;

  if (!accountNumber) {
    return next(
      new AppError('NibssByPhoenix did not return an account number.', 502)
    );
  }

  const account = await Account.create({
    accountNumber,
    user: req.user._id
  });
  req.user.account = account._id;
  await req.user.save();

  res.status(201).json({
    status: 'success',
    data: { account }
  });
});
