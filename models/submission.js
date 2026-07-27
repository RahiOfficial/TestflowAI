const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
    stripeSessionId: { type: String, required: true, unique: true },
    testCases: [{
        name: String,
        input: String,
        expected: String,
        actual: String
    }],
    createdAt: { type: Date, default: Date.now, expires: 86400 } // Automatically deletes after 24 hours to clean up storage
});

module.exports = mongoose.model('Submission', SubmissionSchema);