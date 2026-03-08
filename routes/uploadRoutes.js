const express = require('express');
const router = express.Router();
const { upload } = require('../utils/cloudinaryConfig');

// @route   POST /api/upload/image
// @desc    Upload an image to Cloudinary and return the URL
// @access  Public
router.post('/image', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image provided' });
        }

        // The image was successfully uploaded to Cloudinary by multer-storage-cloudinary
        // The Cloudinary file URL is available at req.file.path
        res.status(200).json({
            success: true,
            message: 'Image uploaded successfully',
            imageUrl: req.file.path
        });
    } catch (error) {
        console.error('Error uploading image to Cloudinary:', error);
        res.status(500).json({ success: false, message: 'Server error during image upload' });
    }
});

// @route   DELETE /api/upload/image
// @desc    Delete an image from Cloudinary by its URL
// @access  Public (in production, you'd want to secure this to prevent malicious deletions)
router.delete('/image', async (req, res) => {
    try {
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, message: 'No image URL provided' });
        }

        // Extract the public_id from the Cloudinary URL
        // URL example: https://res.cloudinary.com/dxsgzcdvz/image/upload/v1709880000/shadow-promotions/filename.jpg
        const urlParts = imageUrl.split('/');
        // Extract everything after the environment/version (e.g., 'shadow-promotions/filename.jpg')
        const fileNameWithExt = urlParts[urlParts.length - 1]; // filename.jpg
        const folderName = urlParts[urlParts.length - 2]; // shadow-promotions

        // Cloudinary public_ids typically don't include the file extension.
        const fileNameWithoutExt = fileNameWithExt.split('.')[0];
        const publicId = `${folderName}/${fileNameWithoutExt}`;

        const { cloudinary } = require('../utils/cloudinaryConfig');

        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result === 'ok') {
            return res.status(200).json({ success: true, message: 'Image deleted successfully' });
        } else {
            return res.status(400).json({ success: false, message: 'Failed to delete image from Cloudinary', result });
        }

    } catch (error) {
        console.error('Error deleting image from Cloudinary:', error);
        res.status(500).json({ success: false, message: 'Server error during image deletion' });
    }
});

module.exports = router;
