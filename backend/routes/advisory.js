const router = require('express').Router();
const { getTips, getEmergencyTips, getCalendar, getPlantingGuide } = require('../controllers/advisoryController');

router.get('/tips', getTips);
router.get('/emergency', getEmergencyTips);
router.get('/calendar', getCalendar);
router.get('/calendar/:cropType', getCalendar);
router.get('/guide', getPlantingGuide);
router.get('/guide/:cropType', getPlantingGuide);

module.exports = router;
