const express = require('express');
const statsController = require('../controllers/statsController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', statsController.getStats);

module.exports = router;
