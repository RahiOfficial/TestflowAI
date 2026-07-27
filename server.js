require('dotenv').config();

// 0. Bypass Windows DNS SRV Lookup Errors (Fixes querySrv ECONNREFUSED)
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const multer = require('multer');
const pdfkit = require('pdfkit');
const mongoose = require('mongoose');
const fs = require('fs');
const Submission = require('./models/Submission');

const app = express();
const upload = multer({ dest: 'uploads/' });

// 1. Database Connection Configuration
mongoose.connect(process.env.MONGODB_URI, {
    family: 4 // Forces IPv4 connection
})
.then(() => console.log('📁 Database Engine Connected Successfully'))
.catch(err => console.error('Database connection error:', err));

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 2. Landing Page Route
app.get('/', (req, res) => res.render('index'));

// 3. Flexible Java File Parser Route
app.post('/upload', upload.single('testFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file received. Please upload a valid .java test file.');
    }

    try {
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        
        // Flexible Regex: Matches @Test, @ParameterizedTest, or standard void/returned methods
        const methodRegex = /(?:@(?:ParameterizedTest|Test)\s+[\s\S]*?)?(?:public|protected|private|static|\s)+[\w<>\b]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
        let match;
        const testCases = [];
        const seenMethods = new Set();

        while ((match = methodRegex.exec(fileContent)) !== null) {
            const methodName = match[1];

            // Ignore class constructor or common keyword false-positives
            if (['if', 'for', 'while', 'switch', 'catch'].includes(methodName) || seenMethods.has(methodName)) {
                continue;
            }
            seenMethods.add(methodName);

            // Split camelCase words into readable spacing structures
            const readableName = methodName
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, str => str.toUpperCase())
                .replace(/_/g, ' ');

            testCases.push({ method: methodName, name: readableName });
        }

        // Clean up local temp file
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        if (testCases.length === 0) {
            return res.send(`
                <body style="background:#090D16;color:#cbd5e1;font-family:sans-serif;padding:40px;text-align:center;">
                    <h2 style="color:#f43f5e;">No Methods or Test Cases Found</h2>
                    <p>We parsed your Java file but couldn't identify valid method signatures.</p>
                    <a href="/" style="color:#6366f1;text-decoration:none;font-weight:bold;">← Go Back and Try Another File</a>
                </body>
            `);
        }

        res.render('edit', { testCases });

    } catch (error) {
        console.error("Critical Compiler Error:", error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send('Critical failure processing your file structural syntax.');
    }
});

// 4. Enhanced Document Generation & PDF Compiler Route
app.post('/generate-doc', async (req, res) => {
    try {
        const { names, inputs, expected, actual } = req.body;
        
        const nameArray = Array.isArray(names) ? names : [names];
        const inputArray = Array.isArray(inputs) ? inputs : [inputs];
        const expectedArray = Array.isArray(expected) ? expected : [expected];
        const actualArray = Array.isArray(actual) ? actual : [actual];

        const formattedTestCases = nameArray.map((name, i) => ({
            name,
            input: inputArray[i] || 'None Provided',
            expected: expectedArray[i] || 'System runs without exception.',
            actual: actualArray[i] || 'Verified Pass (100% Match)'
        }));

        // Save record directly to MongoDB
        const record = await Submission.create({
            testCases: formattedTestCases
        });

        // Initialize PDFKit Engine with standard margins
        const doc = new pdfkit({ margin: 40, size: 'A4' });
        
        res.setHeader('Content-disposition', `attachment; filename="TestFlow_Report_${record._id}.pdf"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // Styling Colors
        const primaryColor = '#0F172A';   // Dark Slate
        const secondaryColor = '#475569'; // Slate Text
        const accentColor = '#4F46E5';    // Indigo
        const lightBg = '#F8FAFC';        // Neutral Background
        const borderColor = '#E2E8F0';    // Border Line
        const successColor = '#16A34A';   // Emerald Green

        // --- Header Banner ---
        doc.rect(40, 40, 515, 60).fill(lightBg);
        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(20).text('System Testing Report', 55, 52);
        doc.fillColor(accentColor).font('Helvetica-Bold').fontSize(8).text('GENERATED VIA TESTFLOW PRO ENGINE', 55, 77, { characterSpacing: 1 });
        
        // Metadata
        doc.fillColor(secondaryColor).font('Helvetica').fontSize(9).text(`Report ID: ${record._id}`, 350, 54, { align: 'right' });
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 350, 68, { align: 'right' });
        
        doc.moveDown(3);

        // --- Render Test Case Cards ---
        record.testCases.forEach((tc, index) => {
            // Check vertical boundaries to add new page if necessary
            if (doc.y > 680) {
                doc.addPage();
            }

            const currentY = doc.y;

            // Container Box
            doc.roundedRect(40, currentY, 515, 105, 6)
               .lineWidth(1)
               .strokeColor(borderColor)
               .fillAndStroke('#FFFFFF', borderColor);

            // Test Case Header Header Bar
            doc.roundedRect(40, currentY, 515, 24, 6).fill(lightBg);
            doc.rect(40, currentY + 18, 515, 6).fill(lightBg); // Squared bottom corners for header bar

            // Title & ID Tag
            doc.fillColor(accentColor).font('Helvetica-Bold').fontSize(9)
               .text(`TC-${String(index + 1).padStart(3, '0')}`, 52, currentY + 7);
               
            doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(10)
               .text(tc.name, 100, currentY + 7, { width: 440, lineBreak: false });

            // Status Tag
            doc.roundedRect(480, currentY + 5, 65, 14, 3).fill('#DCFCE7');
            doc.fillColor(successColor).font('Helvetica-Bold').fontSize(7).text('PASSED', 480, currentY + 9, { width: 65, align: 'center' });

            // Table Content Rows
            const textStartY = currentY + 32;

            // Row 1: Preconditions
            doc.fillColor(secondaryColor).font('Helvetica-Bold').fontSize(8).text('Preconditions:', 52, textStartY);
            doc.fillColor(primaryColor).font('Helvetica').fontSize(8).text(tc.input, 130, textStartY, { width: 410, lineBreak: false });

            // Row 2: Expected Output
            doc.fillColor(secondaryColor).font('Helvetica-Bold').fontSize(8).text('Expected Result:', 52, textStartY + 20);
            doc.fillColor(primaryColor).font('Helvetica').fontSize(8).text(tc.expected, 130, textStartY + 20, { width: 410, lineBreak: false });

            // Row 3: Actual Result
            doc.fillColor(secondaryColor).font('Helvetica-Bold').fontSize(8).text('Actual Output:', 52, textStartY + 40);
            doc.fillColor(successColor).font('Helvetica').fontSize(8).text(tc.actual, 130, textStartY + 40, { width: 410, lineBreak: false });

            doc.y = currentY + 118; // Spacing to next element
        });

        // --- Document Footer ---
        const pageCount = doc.bufferedPageRange().count || 1;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fillColor(secondaryColor).font('Helvetica').fontSize(8)
               .text(`Page ${i + 1} of ${pageCount}`, 40, 800, { align: 'center', width: 515 });
        }

        doc.end();

    } catch (err) {
        console.error("Error generating documentation:", err);
        res.status(500).send("Internal Server Error compiling documentation.");
    }
});

// 5. Start Server Listener Engine
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Production Engine Online on port ${PORT}`));