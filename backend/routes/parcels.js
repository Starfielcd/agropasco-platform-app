/**
 * AgroPasco — Rutas de Parcelas
 */

const router = require('express').Router();
const { listParcels, createParcel, getParcel, updateParcel, deleteParcel } = require('../controllers/parcelController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Farmer y advisor pueden listar/ver parcelas
router.get('/', listParcels);
router.get('/:id', getParcel);

// Solo farmer puede crear/editar/eliminar sus parcelas
router.post('/', requireRole('farmer'), createParcel);
router.put('/:id', requireRole('farmer'), updateParcel);
router.delete('/:id', requireRole('farmer'), deleteParcel);

module.exports = router;
