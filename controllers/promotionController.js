const Promotion = require('../models/Promotion');

// @desc    Create a new promotion request
// @route   POST /api/promotions
// @access  Public (Any student can submit)
exports.createPromotion = async (req, res) => {
    try {
        const { title, description, imageUrl, linkUrl, contactDetails, submittedBy } = req.body;

        if (!title || !description || !submittedBy) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields (title, description, submittedBy)' });
        }

        const promotion = await Promotion.create({
            title,
            description,
            imageUrl: imageUrl || '',
            linkUrl,
            contactDetails,
            submittedBy
        });

        res.status(201).json({
            success: true,
            data: promotion,
            message: 'Promotion request submitted successfully. It is currently pending review.'
        });
    } catch (error) {
        console.error('Error creating promotion:', error);
        res.status(500).json({ success: false, message: 'Server error while creating promotion request' });
    }
};

// @desc    Get all active/approved promotions
// @route   GET /api/promotions/active
// @access  Public
exports.getActivePromotions = async (req, res) => {
    try {
        const promotions = await Promotion.find({ status: 'Approved' }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: promotions.length,
            data: promotions
        });
    } catch (error) {
        console.error('Error fetching active promotions:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching active promotions' });
    }
};

// @desc    Get all promotions (for Super Admin)
// @route   GET /api/promotions/all
// @access  Private (Super Admin) - Security layer applied via middleware or frontend verification
exports.getAllPromotions = async (req, res) => {
    try {
        const key = req.headers['x-super-admin-key'];
        if (!key || key !== process.env.SUPER_ADMIN_MASTER_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const promotions = await Promotion.find({}).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: promotions.length,
            data: promotions
        });
    } catch (error) {
        console.error('Error fetching all promotions:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching promotions' });
    }
};

// @desc    Update a promotion's status
// @route   PUT /api/promotions/:id/status
// @access  Private (Super Admin)
exports.updatePromotionStatus = async (req, res) => {
    try {
        const key = req.headers['x-super-admin-key'];
        if (!key || key !== process.env.SUPER_ADMIN_MASTER_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const { id } = req.params;
        const { status } = req.body;

        if (!['Pending', 'Approved', 'Rejected', 'Inactive'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const promotion = await Promotion.findByIdAndUpdate(
            id,
            { status },
            { new: true, runValidators: true }
        );

        if (!promotion) {
            return res.status(404).json({ success: false, message: 'Promotion not found' });
        }

        res.status(200).json({
            success: true,
            data: promotion,
            message: `Promotion status updated to ${status}`
        });
    } catch (error) {
        console.error('Error updating promotion status:', error);
        res.status(500).json({ success: false, message: 'Server error while updating promotion status' });
    }
};

// @desc    Get promotions by array of IDs (for students checking their pitches)
// @route   POST /api/promotions/my-pitches
// @access  Public
exports.getMyPromotions = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'Please provide an array of IDs' });
        }

        const promotions = await Promotion.find({ _id: { $in: ids } }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: promotions.length,
            data: promotions
        });
    } catch (error) {
        console.error('Error fetching my promotions:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching your promotions' });
    }
};

// @desc    Toggle upvote on a promotion
// @route   POST /api/promotions/:id/upvote
// @access  Public
exports.toggleUpvote = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const promotion = await Promotion.findById(id);

        if (!promotion) {
            return res.status(404).json({ success: false, message: 'Promotion not found' });
        }

        // Check if user already upvoted
        const hasUpvoted = promotion.upvotes.includes(userId);

        let updateQuery = {};
        if (hasUpvoted) {
            // Remove upvote
            updateQuery = { $pull: { upvotes: userId } };
        } else {
            // Add upvote
            updateQuery = { $addToSet: { upvotes: userId } };
        }

        const updatedPromotion = await Promotion.findByIdAndUpdate(id, updateQuery, { new: true });

        res.status(200).json({
            success: true,
            upvotes: updatedPromotion.upvotes.length,
            hasUpvoted: !hasUpvoted
        });
    } catch (error) {
        console.error('Error toggling upvote:', error);
        res.status(500).json({ success: false, message: 'Server error while updating upvote' });
    }
};

// @desc    Record views for promotions
// @route   POST /api/promotions/views
// @access  Public
exports.recordViews = async (req, res) => {
    try {
        const { promoIds, userId } = req.body;

        if (!userId || !promoIds || !Array.isArray(promoIds) || promoIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid data' });
        }

        // Add userId to views array for all specified promotion IDs if not already there
        await Promotion.updateMany(
            { _id: { $in: promoIds } },
            { $addToSet: { views: userId } }
        );

        res.status(200).json({ success: true, message: 'Views recorded' });
    } catch (error) {
        console.error('Error recording views:', error);
        res.status(500).json({ success: false, message: 'Server error while tracking views' });
    }
};
