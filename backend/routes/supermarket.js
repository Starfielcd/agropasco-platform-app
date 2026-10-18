const router = require('express').Router();
const { getProducts, getProduct, getProductTrace, publishProduct, validateProduct, getPendingProducts, updateProduct } = require('../controllers/supermarketController');
const { createOrder, getOrders, getOrderById, farmerResponse, supermarketResponse } = require('../controllers/orderController');
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

// ===== B2B PURCHASE ORDERS (COMERCIO01) =====
router.post('/orders', authenticateToken, requireRole('supermarket', 'admin'), createOrder);
router.get('/orders', authenticateToken, getOrders);
router.get('/orders/:id', authenticateToken, getOrderById);
router.put('/orders/:id/farmer-response', authenticateToken, requireRole('farmer', 'admin'), farmerResponse);
router.put('/orders/:id/supermarket-response', authenticateToken, requireRole('supermarket', 'admin'), supermarketResponse);

module.exports = router;

