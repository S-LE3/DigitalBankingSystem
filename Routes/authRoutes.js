const express = require('express');
// const userController = require('./../controllers/userController');
const authController = require('./../Controllers/authController');

const router = express.Router();

// Public Authentication Endpoints
router.post('/fintech-onboard', authController.onboardFintech);
router.post('/onboard', authController.onboardCustomer);
router.post('/login', authController.login);

// Silent Token Rotation Endpoint (Public as it relies on the secure cookie payload)
router.post('/refresh-token', authController.refreshToken);

// Protected Authentication Endpoints
router.post('/logout', authController.protect, authController.logout);

module.exports = router;
