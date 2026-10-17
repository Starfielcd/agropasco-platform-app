const router = require('express').Router();
const { getProducts, getProduct, getProductTrace, publishProduct, validateProduct, getPendingProducts, updateProduct } = require('../controllers/supermarketController');
const { authenticateToken, optionalAuth, requireRole } = require('../middleware/auth');

// Public/authenticated endpoints for supermarket integration
router.get('/products', optionalAuth, getProducts);
router.get('/products/pending', authenticateToken, requireRole('advisor'), getPendingProducts);
router.get('/products/:id', getProduct);
router.get('/products/:id/trace', getProductTrace);

// Authenticated endpoint for farmers to publish or update products
router.post('/products', authenticateToken, requireRole('farmer'), publishProduct);
router.put('/products/:id', authenticateToken, requireRole('farmer', 'admin'), updateProduct);

// Advisor validates products
router.put('/products/:id/validate', authenticateToken, requireRole('advisor'), validateProduct);

module.exports = router;
