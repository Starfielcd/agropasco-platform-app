const router = require('express').Router();
const { getProducts, getProduct, getProductTrace, publishProduct } = require('../controllers/supermarketController');
const { authenticateToken } = require('../middleware/auth');

// Public endpoints for supermarket integration
router.get('/products', getProducts);
router.get('/products/:id', getProduct);
router.get('/products/:id/trace', getProductTrace);

// Authenticated endpoint for farmers to publish products
router.post('/products', authenticateToken, publishProduct);

module.exports = router;
