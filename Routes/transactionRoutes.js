const express = require('express');
const transactionController = require('../Controllers/transactionController');
const authController = require('../Controllers/authController');

const router = express.Router();

// BANKING LAYER SECURITY
// Protect all transaction routes defined below this line automatically
router.use(authController.protect);

router.get('/', transactionController.getMyTransactions);
router.get('/:id/status', transactionController.getTransactionStatus);
router.post('/name-enquiry', transactionController.nameEnquiry);
router.post('/transfer', transactionController.transfer);

module.exports = router;
