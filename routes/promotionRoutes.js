const express = require('express');
const router = express.Router();
const {
    createPromotion,
    getActivePromotions,
    getAllPromotions,
    updatePromotionStatus
} = require('../controllers/promotionController');

// Public route to submit a new promotion
router.post('/', createPromotion);

// Public route to get only approved/active promotions
router.get('/active', getActivePromotions);

// Private/Admin route to get all promotions
router.get('/all', getAllPromotions);

// Private/Admin route to change promotion status
router.put('/:id/status', updatePromotionStatus);

// Public route to get promotions by ID array (My Pitches)
router.post('/my-pitches', require('../controllers/promotionController').getMyPromotions);

// Public route to record views
router.post('/views', require('../controllers/promotionController').recordViews);

// Public route to toggle upvote
router.post('/:id/upvote', require('../controllers/promotionController').toggleUpvote);

// Public route to record external link click
router.post('/:id/click', require('../controllers/promotionController').recordClick);

module.exports = router;
