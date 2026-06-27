const express = require('express');
const categoriesController = require('../controllers/categoriesController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', categoriesController.getCategories);
router.post('/', categoriesController.createCategory);
router.get('/:id', categoriesController.getCategory);
router.patch('/:id', categoriesController.updateCategory);
router.delete('/:id', categoriesController.deleteCategory);

module.exports = router;
