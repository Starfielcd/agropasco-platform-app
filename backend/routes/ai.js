const router = require('express').Router();
const { recommend, frostRisk, irrigationPlan } = require('../controllers/aiController');

router.get('/recommend/:cropId', recommend);
router.get('/frost-risk', frostRisk);
router.get('/irrigation/:cropId', irrigationPlan);

module.exports = router;
