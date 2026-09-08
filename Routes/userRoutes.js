const express = require('express');
const userController = require('../Controllers/userController');
const authController = require('../Controllers/authController');

const router = express.Router();

// BANKING LAYER SECURITY
// Protect all routes defined below this line automatically
router.use(authController.protect);

router.get('/me', userController.getMe);
router.patch('/me/identity', userController.addNin);
router.post('/account', userController.createAccount);
router.get('/balance', userController.fetchAccountBalance);

module.exports = router;
