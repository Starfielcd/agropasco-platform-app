const router = require('express').Router();
const { getProducts, getProduct, getProductTrace, publishProduct, validateProduct, getPendingProducts } = require('../controllers/supermarketController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Public endpoints for supermarket integration
router.get('/products', authenticateToken, getProducts);
router.get('/products/pending', authenticateToken, requireRole('advisor'), getPendingProducts);
router.get('/products/:id', getProduct);
router.get('/products/:id/trace', getProductTrace);

// Authenticated endpoint for farmers to publish products
router.post('/products', authenticateToken, requireRole('farmer'), publishProduct);

// Advisor validates products
router.put('/products/:id/validate', authenticateToken, requireRole('advisor'), validateProduct);

module.exports = router;
