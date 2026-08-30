const router = require('express').Router();
const { getCurrent, getForecastData, getAlerts, getWeatherHistory } = require('../controllers/weatherController');

router.get('/current', getCurrent);
router.get('/forecast', getForecastData);
router.get('/alerts', getAlerts);
router.get('/history/:cropId', getWeatherHistory);

module.exports = router;
