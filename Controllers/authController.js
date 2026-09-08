const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('./../Models/userModel');
const catchAsync = require('../Utils/catchAsync');
const AppError = require('../Utils/appError');
const Account = require('../Models/accountModel');
const Blacklist = require('../Models/blacklistModel');
const nibssService = require('../Services/nibssService');

//  Sign short-lived access tokens (10m window)
const signAccessToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '10m'
  });
};

//  Sign longer-lived refresh tokens (1h window)
const signRefreshToken = id => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '1h'
  });
};

//  Complete cookie and header authentication delivery system
const createSendToken = (user, statusCode, req, res) => {
  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);

  // Set the refresh token inside a secure, httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    expires: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 Hours
    httpOnly: true, // Shields token against XSS/Script access
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https', // True over HTTPS
    sameSite: 'strict' // Defends against CSRF forging vectors
  });

  // Strip password field before response delivery
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token: accessToken,
    data: {
      user
    }
  });
};

exports.onboardFintech = catchAsync(async (req, res, next) => {
  const { email, companyName } = req.body;

  if (!email || !companyName) {
    return next(new AppError('Please provide email and company name.', 400));
  }

  await nibssService.onboardFintech({ email, companyName });

  res.status(201).json({
    status: 'success',
    message:
      'Fintech onboarding submitted. Check the provided email for credentials.'
  });
});

exports.onboardCustomer = catchAsync(async (req, res, next) => {
  const { name, password, bvn, nin, dob, phone } = req.body;
  const nameParts = name?.trim().split(/\s+/) || [];
  const firstName = req.body.firstName || nameParts[0];
  const lastName = req.body.lastName || nameParts.slice(1).join(' ');

  // Validate client payload parameters locally BEFORE triggering external API network actions
  if (!name || !password || !dob || !firstName || !lastName) {
    return next(
      new AppError(
        'Please provide name, first name, last name, password, and date of birth.',
        400
      )
    );
  }

  if (!bvn && !nin) {
    return next(new AppError('Please provide either BVN or NIN.', 400));
  }

  if (bvn && !phone) {
    return next(new AppError('Phone is required for BVN onboarding.', 400));
  }

  try {
    await nibssService.insertIdentity({
      name,
      password,
      bvn,
      nin,
      firstName,
      lastName,
      dob,
      phone
    });
  } catch (error) {
    const providerMessage = error.response?.data?.message || '';
    const existingIdentity =
      error.response?.status === 409 && /already exists/i.test(providerMessage);

    if (!existingIdentity) throw error;
  }

  const verify = await nibssService.verifyIdentity({ bvn, nin });
  if (verify.status !== 200)
    return next(new AppError('Identity verification failed.', 400));

  const identityQuery = bvn ? { bvn } : { nin };
  const existingUser = await User.findOne(identityQuery).select('+password');
  if (existingUser) {
    if (
      !(await existingUser.correctPassword(password, existingUser.password))
    ) {
      return next(new AppError('Incorrect account or password.', 401));
    }

    return createSendToken(existingUser, 200, req, res);
  }

  // User creation
  const userData = {
    name,
    firstName,
    lastName,
    phone,
    password,
    dob,
    onboardingStatus: 'verified'
  };
  if (bvn) userData.bvn = bvn;
  if (nin) userData.nin = nin;

  const user = await User.create(userData);

  createSendToken(user, 201, req, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { account, password } = req.body;

  // Check if email and password exist
  if (!account || !password) {
    return next(
      new AppError('Please provide account number and password!', 400)
    );
  }

  // Safe Object Null-Guard Check to stop server crash on unknown inputs
  const accountData = await Account.findOne({ accountNumber: account });
  if (!accountData) {
    return next(new AppError('Incorrect account or password', 401));
  }
  // Check if user exists && password is correct
  const user = await User.findOne({ account: accountData._id }).select(
    '+password'
  );
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect account or password', 401));
  }

  // If everything is okay, send token to client
  createSendToken(user, 200, req, res);
});

// Silent background token rotation endpoint
exports.refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.cookies || {};
  if (!refreshToken) {
    return next(new AppError('No refresh token found. Please log in.', 401));
  }

  // Double check if token is logged on your database blacklist
  const isBlacklisted = await Blacklist.findOne({ token: refreshToken });
  if (isBlacklisted) {
    return next(new AppError('Session expired. Please log in again.', 401));
  }

  const decoded = await promisify(jwt.verify)(
    refreshToken,
    process.env.JWT_REFRESH_SECRET
  );

  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError('The user matching this session no longer exists.', 401)
    );
  }

  const newAccessToken = signAccessToken(currentUser._id);

  res.status(200).json({
    status: 'success',
    token: newAccessToken
  });
});

// Util for protected routes
exports.protect = catchAsync(async (req, res, next) => {
  // Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  // Blacklist Interception. Block attackers using tokens after user logs out
  const isBlacklisted = await Blacklist.findOne({ token });
  if (isBlacklisted) {
    return next(
      new AppError(
        'This session has been terminated. Please log in again.',
        401
      )
    );
  }

  // Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401
      )
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  res.locals.user = currentUser;
  next();
});

// Invalidation and Session Wipe on Manual Logout
exports.logout = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.cookies || {};
  let accessToken;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    accessToken = req.headers.authorization.split(' ')[1];
  }

  if (accessToken) {
    await Blacklist.create({ token: accessToken });
  }

  if (refreshToken) {
    await Blacklist.create({ token: refreshToken });
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'strict'
  });

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully.'
  });
});

// Protects roles endpoints
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};
