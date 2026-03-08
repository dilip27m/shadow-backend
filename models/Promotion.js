const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please provide a title for the promotion'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Please provide a short description'],
        trim: true,
        maxlength: [200, 'Description cannot exceed 200 characters']
    },
    imageUrl: {
        type: String,
        trim: true,
        default: ''
    },
    linkUrl: {
        type: String,
        trim: true,
        default: ''
    },
    contactDetails: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Inactive'],
        default: 'Pending'
    },
    submittedBy: {
        type: String,
        required: [true, 'Please provide the name or context info of the submitter'],
        trim: true
    },
    upvotes: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Promotion', promotionSchema);
