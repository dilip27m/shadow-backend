const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary with credentials from .env
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Setup multer storage for Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'shadow-promotions', // The folder name in your Cloudinary account
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
        // transformation: [{ width: 800, height: 600, crop: 'limit' }] // Optional: resize images
    }
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };
