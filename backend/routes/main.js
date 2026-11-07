const bcrypt = require('bcrypt');
const { spawn } = require("child_process");
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

// Runs a Python helper and waits for its printed result.
function runPython(script, args) {
    return spawn('python3', [script, ...args], { cwd: paths.processing });
}

module.exports = function(app) {

    // Sends visitors who are not signed in back to the login page.
    const isAuthenticated = (req, res, next) => {
        if(req.session && req.session.userEmail) {
            return next();
        }
        res.redirect(req.app.get('baseUrl')+'/login');
    };

    // Set storage engine
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, paths.uploads);
        },
        filename: function (req, file, cb) {
            const userEmail = req.session.userEmail;
            const timestamp = Date.now();
            const filePath = decodeURI(req.body.path).split("/home/")[1];
            const originalFileName = req.body.title + ".pdf";

            // Query to count files with similar names and paths
            const query = 'SELECT COUNT(*) AS count FROM documents WHERE email = ? AND file_path = ? AND file_name LIKE ?';
            const searchPattern = `%${req.body.title}%`;

            global.db.query(query, [userEmail, filePath, searchPattern], (error, results) => {
                if (error) {
                    console.error('Error checking file existence:', error);
                    return cb(error);
                }

                // Get the count of files with similar names and paths
                const count = results[0].count;

                // Construct the final filename with user email, timestamp, path, and original file name
                let finalFileName = originalFileName;
                if (count > 0) {
                    finalFileName = `${req.body.title}_${count}.pdf`;
                }

                // Construct the final filename with user email, timestamp, path, and unique file name
                finalFileName = `${userEmail}&&d&&${timestamp}&&d&&${filePath}&&d&&${finalFileName}`;

                cb(null, finalFileName);
            });
        }
    });

    // Initialize multer upload
    const upload = multer({
        storage: storage,
    });

    // Saves an uploaded PDF and starts its summary.
    app.post('/upload', isAuthenticated, upload.single('file'), (req, res) => {
        invokePythonDocumentProcessor(req, res);
        // SQL query to insert user details into the users table
        let query = 'INSERT INTO documents (email, file_name, file_path, messageHistory) VALUES (?, ?, ?, "")';

        // Execute the SQL query
        global.db.query(query, [req.session.userEmail, req.file.filename, req.file.filename.split("&&d&&")[2]], (error, results, fields) => {
            if (error) {
                console.error('Error inserting document:', error);
                res.status(500).send('Error creating file');
                return;
            }
            console.log('document uploaded successfully');

            res.redirect('/home/'+decodeURI(req.body.path).split("/home/")[1]);
        });
    });

    // Tells the library whether a PDF summary is ready yet.
    app.post('/processing_check', (req, res) => {
        let userEmail = req.session && req.session.userEmail;
        if (!userEmail && req.body && typeof req.body.filename === 'string' && req.body.filename.includes('&&d&&')) {
            // The stored name starts with the owner's email. The file page sends that
            // full name, so a restart that cleared the session can still finish the poll.
            userEmail = req.body.filename.split('&&d&&')[0];
        }
        if (!userEmail || !req.body || typeof req.body.filename !== 'string' || req.body.filename.length === 0) {
            return res.status(400).json(true);
        }

        // Clients send the stored name with the trailing ".pdf" removed.
        const filename = req.body.filename.endsWith('.pdf') ? req.body.filename : req.body.filename + '.pdf';

        const query = `
            SELECT file_name, summary
            FROM documents
            WHERE file_name LIKE ? AND email = ?
        `;
        global.db.query(query, [`%${filename}%`, userEmail], (error, results) => {
            if (error) {
                console.error(`Error querying database: ${error}`);
                return res.status(500).json(true);
            }
            if (results.length === 0) {
                return res.status(404).json(true); // No matching document found
            }
            if (results[0].summary) {
                // false means processing is finished and the page can reload.
                return res.json(false);
            }
            // Cloud processing never stored a summary. Build one from the local PDF
            // so the file page can leave the overlay.
            buildLocalSummary(results[0].file_name, (html) => {
                if (!html) {
                    return res.json(true);
                }
                saveSummary(results[0].file_name, userEmail, html, (saveError) => {
                    if (saveError) {
                        console.error(`Error saving local summary: ${saveError}`);
                        return res.status(500).json(true);
                    }
                    return res.json(false);
                });
            });
        });

    });

    // Opens the library.
    app.get('/', isAuthenticated, (req, res) => {
        res.redirect("/home");
    });

    //home  + location dir requested
    // Opens a folder in the library, or a PDF if the link ends in .file.
    app.get('/home/*', isAuthenticated, (req, res) => {

        if(decodeURIComponent(req.url).split("/").pop().includes(".file")){
            return res.redirect('/file/'+decodeURIComponent(req.url).split('/home/').join(""))
        }

        let urlPath;
        let pathSegments;

        try{
            urlPath = decodeURIComponent(req.url).split('/home/')[1]; // Decode the URL and get the part after '/home'
            pathSegments = urlPath.split('/'); // Split the URL path into segments
        }
        catch{
            urlPath = null;
            pathSegments = null;
        }

        let currentDirectory = req.session.fs; // Start from the root directory

        // Traverse the JSON object based on the URL path segments
        for (const segment of pathSegments) {
            if (segment !== '') {
                if (currentDirectory.hasOwnProperty(segment) && typeof currentDirectory[segment] === 'object') {
                    currentDirectory = currentDirectory[segment]; // Move to the next directory
                } else {
                    // Handle the case where the directory doesn't exist
                    res.status(404).send('Directory not found');
                    return;
                }
            }
        }

        //if reached this point, the url path must exist. the following code depends on this
        let query = 'SELECT file_name, summary FROM documents WHERE email = ? AND file_path = ?';
        global.db.query(query, [req.session.userEmail, urlPath], (error, results) => {
            if (error) {
                console.error('Error loading files..', error);
                return res.status(500).send('Internal Server Error');
            }
            console.log('User files loaded');
            let files = {};
            for(let file of results){
                const displayName = file.file_name.split("&&d&&")[3].replace(".pdf", "");
                const embeddingReady = fileExists(path.join(paths.embeddings, file.file_name.replace(".pdf", ".pkl")));
                files[displayName] = {
                    ready: Boolean(file.summary) || embeddingReady,
                    storedName: file.file_name
                };
            }
            // Render the home template with the current directory's content
            res.render(req.app.get('baseUrl') + 'home', { "fs": currentDirectory, "files":files, "urlPath":urlPath, "userEmail":req.session.userEmail});
        });
    });
    // Makes sure the library address always has a trailing slash.
    app.get('/home', isAuthenticated, (req, res) => {
        res.redirect("/home/")
    });

    // Creates a new folder in the current library location.
    app.post('/newfolder', isAuthenticated, (req, res) => {
        // Check if the current path exists
        let currentPath = decodeURIComponent(req.body.path).split('/home/')[1]; // Decode the URL and get the part after '/home'

        // Split the path into segments
        const segments = currentPath.split("/").filter(segment => segment !== '');

        // Initialize a reference to the session directory structure
        let currentDirectory = req.session.fs;

        // Traverse the JSON structure based on the segments
        for (const segment of segments) {
            if (currentDirectory.hasOwnProperty(segment) && typeof currentDirectory[segment] === 'object') {
                currentDirectory = currentDirectory[segment];
            } else {
                // Handle the case where the directory doesn't exist
                return res.status(404).send('Directory not found');
            }
        }

        // Add a new key to the final nested object in the JSON structure
        const newFolderName = req.body.title;
        if (!newFolderName || typeof newFolderName !== 'string') {
            return res.status(400).send('Invalid folder title');
        }

        // Check if the new folder name already exists in the current directory
        if (currentDirectory.hasOwnProperty(newFolderName)) {
            return res.status(400).send('Folder already exists');
        }

        // Create a new folder in the current directory
        currentDirectory[newFolderName] = {};

        const userId = req.session.userEmail;
        const fsData = JSON.stringify(req.session.fs);

        const updateQuery = 'UPDATE users SET fs = ? WHERE email = ?';
        global.db.query(updateQuery, [fsData, userId], (error, results) => {
            if (error) {
                console.error('Error updating file system in the database:', error);
                return res.status(500).send('Internal Server Error');
            }
            console.log('File system updated in the database');
            res.redirect('/home/'+currentPath);
        });
    });

    // Finds one folder inside the reader's library.
    function folderAt(tree, urlPath) {
        let current = tree;
        for (const segment of String(urlPath || "").split("/").filter(Boolean)) {
            if (!current || typeof current[segment] !== "object") {
                return null;
            }
            current = current[segment];
        }
        return current;
    }

    // Deletes a folder and the PDFs stored inside it.
    app.post('/delete_folder', isAuthenticated, (req, res) => {
        const name = String(req.body.name || "").trim();
        const currentPath = decodeURIComponent(req.body.path || "").split("/home/")[1] || "";
        const parent = folderAt(req.session.fs, currentPath);
        if (!name || !parent || typeof parent[name] !== "object") {
            return res.status(404).send("Folder not found");
        }
        const folderPath = currentPath ? `${currentPath}/${name}` : name;
        delete parent[name];
        const email = req.session.userEmail;
        global.db.query(
            "SELECT file_name FROM documents WHERE email = ? AND (file_path = ? OR file_path LIKE ?)",
            [email, folderPath, `${folderPath}/%`],
            (error, rows) => {
                if (error) {
                    return res.status(500).send("Internal Server Error");
                }
                const names = rows.map((row) => row.file_name);
                const finish = () => {
                    global.db.query("UPDATE users SET fs = ? WHERE email = ?", [JSON.stringify(req.session.fs), email], (updateError) => {
                        if (updateError) {
                            return res.status(500).send("Internal Server Error");
                        }
                        names.forEach((storedName) => {
                            fs.unlink(path.join(paths.uploads, storedName), () => {});
                            fs.unlink(path.join(paths.embeddings, storedName.replace(".pdf", ".pkl")), () => {});
                        });
                        res.send("deleted successfully");
                    });
                };
                if (names.length === 0) {
                    return finish();
                }
                global.db.query("DELETE FROM quizzes WHERE id IN (SELECT id FROM documents WHERE email = ? AND (file_path = ? OR file_path LIKE ?))", [email, folderPath, `${folderPath}/%`], (quizError) => {
                    if (quizError) {
                        return res.status(500).send("Internal Server Error");
                    }
                    global.db.query("DELETE FROM documents WHERE email = ? AND (file_path = ? OR file_path LIKE ?)", [email, folderPath, `${folderPath}/%`], (docError) => {
                        if (docError) {
                            return res.status(500).send("Internal Server Error");
                        }
                        finish();
                    });
                });
            }
        );
    });

    // Opens one PDF with its summary, quiz, and chat.
    app.get('/file/*', isAuthenticated, (req, res) => {
        let urlPath = decodeURIComponent(req.url).split('/file/')[1];
        let pathSegments = urlPath.split("/")
        pathSegments.pop();

        let currentDirectory = req.session.fs; // Start from the root directory

        // Traverse the JSON object based on the URL path segments
        for (const segment of pathSegments) {
            if (segment !== '') {
                if (currentDirectory.hasOwnProperty(segment) && typeof currentDirectory[segment] === 'object') {
                    currentDirectory = currentDirectory[segment]; // Move to the next directory
                } else {
                    // Handle the case where the directory doesn't exist
                    res.status(404).send('Directory not found');
                    return;
                }
            }
        }

        let filename = urlPath.split("/").pop().replace(".file",".pdf");
        let filedir = urlPath.split("/");
        filedir.pop();
        filedir = filedir.join("");

        let folderPath = paths.uploads
        let foundPDF;

        fs.readdir(folderPath, (err, files) => {
            if (err) {
                console.error('Error reading folder:', err);
                res.send("Your file could not be found. Please contact us if this issue continues.");
            }

            // Filter out directories from the list of files
            const fileList = files.filter(file => fs.statSync(path.join(folderPath, file)).isFile());

            for(let file of fileList){
                if(file.split("&&d&&")[0] == req.session.userEmail
                && file.split("&&d&&")[2] == filedir
                && file.split("&&d&&")[3] == filename){
                    foundPDF = file;
                    break;
                }
            }

            let query = "SELECT summary FROM documents WHERE file_name = ?";
            db.query(query, [foundPDF], (error, results) => {
                if (error) {
                    res.send("Please try again later...");
                }
                else if (!results.length) {
                    res.send("Your file could not be found. Please contact us if this issue continues.");
                }
                else {
                    let summary = results[0].summary;
                    let markedQuizzes;
                    let query = `
                        SELECT q.*
                        FROM quizzes q
                        JOIN documents d ON q.id = d.id
                        WHERE q.marked = 1
                        AND d.file_name = ?
                    `;
                    db.query(query, [foundPDF], (error, results) => {
                        if (error) {
                            console.error('Error getting quiz status from quizzes table', error);
                            return res.status(500).send('Internal Server Error');
                        }
                        markedQuizzes = results;

                        const query = `
                            SELECT messageHistory FROM documents
                            WHERE file_name = ?
                        `;
                        db.query(query, [foundPDF], (error, results) => {
                            if (error) {
                                console.error(`Error updating history in database: ${error}`);
                            }
                            else {
                                messageHistory = results[0].messageHistory;
                                let query = `
                                    SELECT q.*
                                    FROM quizzes q
                                    JOIN documents d ON q.id = d.id
                                    WHERE q.marked = 0
                                    AND d.file_name = ?
                                `;
                                db.query(query, [foundPDF], (error, results) => {
                                    if (error) {
                                        console.error('Error getting quiz status from quizzes table', error);
                                        return res.status(500).send('Internal Server Error');
                                    }
                                    if(results.length == 0){
                                        res.render(req.app.get('baseUrl') + 'file', { "fs": currentDirectory, "urlPath":urlPath, "pdfName":foundPDF, "summary":summary, quizHistory:markedQuizzes, messageHistory:messageHistory, quiz:""});
                                    }
                                    else{
                                        res.render(req.app.get('baseUrl') + 'file', { "fs": currentDirectory, "urlPath":urlPath, "pdfName":foundPDF, "summary":summary, quizHistory:markedQuizzes, messageHistory:messageHistory, quiz:{quiz:results[0].quiz, began:results[0].began}});
                                    }
                                });
                            }
                        });
                    });
                }
            })
        });
    });

    // Deletes one PDF and its quizzes.
    app.post('/delete_file', isAuthenticated, (req, res) => {
        // First, delete quizzes associated with the document
        let deleteQuizzesQuery = `
            DELETE FROM quizzes WHERE id IN (
                SELECT id FROM documents WHERE file_name = ?
            );
        `;
        db.query(deleteQuizzesQuery, [req.body.filename], (quizzesError, quizzesResults) => {
            if (quizzesError) {
                console.error('Error deleting quizzes', quizzesError);
                return res.status(500).send('Internal Server Error');
            }

            // After deleting quizzes, delete the document itself
            let deleteDocumentQuery = `
                DELETE FROM documents WHERE file_name = ?;
            `;
            db.query(deleteDocumentQuery, [req.body.filename], (documentError, documentResults) => {
                if (documentError) {
                    console.error('Error deleting document', documentError);
                    return res.status(500).send('Internal Server Error');
                }

                let filePath = path.join(paths.uploads, req.body.filename);
                fs.unlink(filePath, (unlinkError) => {
                    if (unlinkError) {
                        console.error('Error deleting file', unlinkError);
                        return res.status(500).send('Internal Server Error');
                    }

                    filePath = path.join(paths.embeddings, req.body.filename.replace(".pdf", ".pkl"));
                    fs.unlink(filePath, () => {
                        res.send('deleted successfully');
                    });
                });
            });
        });
    });


    // Route to handle login form submission
    // Receives a chat question about the open PDF.
    app.post('/message', (req, res) => {
        invokePythonQuestionProcessor(req, res);
    });

    // Counts how many real questions this PDF can support.
    app.post('/quiz_capacity', isAuthenticated, (req, res) => {
        const filename = String(req.body.filename || "");
        if (!filename.includes(req.session.userEmail)) {
            return res.status(400).json({ max: 0 });
        }
        const stem = filename.replace(/\.pdf$/, "");
        const child = runPython("local_quiz.py", [stem, "count"]);
        let output = "";
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stderr.on('data', (data) => {
            console.error(data.toString());
        });
        child.on('close', (code) => {
            const max = code === 0 ? parseInt(output.trim(), 10) : 0;
            res.json({ max: Number.isFinite(max) && max > 0 ? max : 0 });
        });
    });

    // Builds a new quiz for the open PDF.
    app.post('/create_quiz', isAuthenticated, (req, res) => {
        invokePythonMultiChoiceQuestionProcessor(req, res);
    });

    // Notes the moment a quiz was started, so the timer is fair.
    app.post('/start_quiz', isAuthenticated, (req, res) => {
        // First, select the quiz with the associated document ID and filename
        let selectQuery = `
            SELECT q.*
            FROM quizzes q
            JOIN documents d ON q.id = d.id
            WHERE q.marked = 0
            AND d.file_name = ?
        `;
        db.query(selectQuery, [req.body.filename], (error, results) => {
            if (error) {
                console.error('Error getting quiz status from quizzes table', error);
                return res.status(500).send('Internal Server Error');
            }

            // Check if a quiz is found for the given filename
            if (results.length > 0) {
                // Get the ID of the document associated with the filename
                const documentId = results[0].id;

                // Now update the began column for the matching quiz
                let updateQuery = `
                    UPDATE quizzes
                    SET began = ${req.body.time}
                    WHERE id = ?
                    AND marked = 0
                `;
                db.query(updateQuery, [documentId], (error, updateResult) => {
                    if (error) {
                        console.error('Error updating quiz status in quizzes table', error);
                        return res.status(500).send('Internal Server Error');
                    }
                    // Send response indicating success
                    return res.send('Quiz started successfully');
                });
            } else {
                // No quiz found for the given filename
                return res.status(404).send('Quiz not found for the given filename');
            }
        });
    });

    // Saves the finished quiz and its score.
    app.post('/mark_quiz', isAuthenticated, (req, res) => {
        // First, select the quiz with the associated document ID and filename
        let selectQuery = `
            SELECT q.*
            FROM quizzes q
            JOIN documents d ON q.id = d.id
            WHERE q.marked = 0
            AND d.file_name = ?
        `;
        db.query(selectQuery, [req.body.filename], (error, results) => {
            if (error) {
                console.error('Error getting quiz status from quizzes table', error);
                return res.status(500).send('Internal Server Error');
            }

            // Check if a quiz is found for the given filename
            if (results.length > 0) {
                // Get the ID of the document associated with the filename
                const documentId = results[0].id;

                // Now update the began column for the matching quiz
                let updateQuery = `
                    UPDATE quizzes
                    SET marked = 1,
                    submittedQuiz = ?
                    WHERE id = ?
                    && marked = 0
                `;
                db.query(updateQuery, [JSON.stringify(req.body.quiz), documentId], (error, updateResult) => {
                    if (error) {
                        console.error('Error updating quiz status in quizzes table', error);
                        return res.status(500).send('Internal Server Error');
                    }
                    // Send response indicating success
                    return res.send('Quiz marked successfully');
                });
            } else {
                // No quiz found for the given filename
                return res.status(404).send('Quiz not found for the given filename');
            }
        });
    });

    // Clears the chat for this PDF.
    app.post('/reset_history', isAuthenticated, (req, res) => {
        // First, select the quiz with the associated document ID and filename
        let query = `
            UPDATE documents SET messageHistory = '' WHERE file_name = ?
        `;
        db.query(query, [req.body.filename], (error, results) => {
            if (error) {
                console.error('Error updating chat history', error);
                return res.status(500).send('Internal Server Error');
            }
            res.send("update chat history successfully")
        });
    });


    // Route for the login page
    // Shows the sign-in page.
    app.get('/login', (req, res) => {
        //redirect to home if logged in already
        if(req.session && req.session.userEmail) {
            // User is authenticated
            console.log("authenticated login")
            res.redirect(req.app.get('baseUrl')+'/');
        }
        else{
            res.render(req.app.get('baseUrl')+'login');
        }

    });

    // Route to handle login form submission
    // Checks the email and password, then opens the library.
    app.post('/login', (req, res) => {
        var { email, password } = req.body;
        email.toLowerCase();
        email.replace(" ", "");

        // SQL query to retrieve the user's hashed password and salt from the database
        let selectUserQuery = 'SELECT password_hash, salt FROM users WHERE email = ?';

        // Execute the SQL query to retrieve the user's hashed password and salt
        global.db.query(selectUserQuery, [email], async (error, results, fields) => {
            if (error) {
                console.error('Error retrieving user:', error);
                res.render(req.app.get('baseUrl')+'login', { message: 'There was an error logging you in. Please try again later.', email: email });
                return;
            }

            // Check if user with the provided email exists
            if (results.length === 0) {
                console.log('User not found');
                res.render(req.app.get('baseUrl')+'login', { message: 'Invalid email or password' , email: email});
                return;
            }

            // Extract the hashed password and salt from the database results
            const { password_hash, salt } = results[0];

            try {
                // Compare the provided password with the hashed password from the database
                const passwordMatch = await bcrypt.compare(password, password_hash);

                if (passwordMatch) {
                    console.log('Login successful');
                    req.session.userEmail = email;
                    let selectUserQuery = 'SELECT fs FROM users WHERE email = ?';
                    global.db.query(selectUserQuery, [email], async (error, results) => {
                        req.session.fs = JSON.parse(results[0].fs);
                        res.redirect(req.app.get('baseUrl')+'/'); // Redirect to home page after successful login
                    });
                } else {
                    console.log('Invalid password');
                    res.render(req.app.get('baseUrl')+'login', { message: 'Invalid email or password' , email: email});
                }
            } catch (error) {
                console.error('Error comparing passwords:', error);
                res.render(req.app.get('baseUrl')+'login', { message: 'There was an error logging you in. Please try again later.' , email: email});
            }
        });
    });

    // Route for the login page
    // Shows the create-account page.
    app.get('/register', (req, res) => {
        //redirect to home if logged in already
        if(req.session && req.session.userEmail) {
            // User is authenticated
            console.log("authenticated login")
            res.redirect(req.app.get('baseUrl')+'/');
        }
        else{
            res.render(req.app.get('baseUrl')+'register');
        }
    });

    // Route to handle registration form submission
    // Creates an account and signs the person in.
    app.post('/register', async (req, res) => {
        var { email, password } = req.body;
        email.toLowerCase();
        email.replace(" ", "");

        try {
            var query = 'SELECT COUNT(*) AS count FROM users WHERE email = ?';
            // Execute the SQL query
            global.db.query(query, [email], async (error, results, fields) => {
                if (error) {
                    console.error('Error checking email:', error);
                    res.render(req.app.get('baseUrl')+'register', { message: 'There was an error processing your request. Please try again later.' , email: email});
                    return;
                }

                // Check if any rows were returned (count > 0 means email exists)
                const emailExists = results[0].count > 0;
                if(emailExists){
                    res.render(req.app.get('baseUrl')+'register', { message: 'This email is registered already, please login instead.' , email: email});
                    return; // Stop further execution
                }

                // Continue registration process
                // Generate a salt
                const saltRounds = 10; // Adjust the number of rounds according to your security needs
                const salt = await bcrypt.genSalt(saltRounds);

                // Hash the password with the salt
                const passwordHash = await bcrypt.hash(password, salt);

                // SQL query to insert user details into the users table
                const insertUserQuery = 'INSERT INTO users (email, password_hash, salt, fs) VALUES (?, ?, ?, ?)';

                // Execute the SQL query
                req.session.fs = {"Getting Started":{}};

                global.db.query(insertUserQuery, [email, passwordHash, salt, JSON.stringify(req.session.fs)], (error, results, fields) => {
                    if (error) {
                        console.error('Error inserting user:', error);
                        res.status(500).send('Error registering user');
                        return;
                    }
                    console.log('User registered successfully');
                    req.session.userEmail = email;

                    res.redirect(req.app.get('baseUrl')+'/'); // Redirect to home page after successful registration
                });
            });
        } catch (error) {
            console.error('Error hashing password:', error);
            res.render(req.app.get('baseUrl')+'register', { message: 'There was an error processing your request. Please try again later.' , email: email});
        }
    });

    // Route for logging out
    // Signs the person out.
    app.get('/logout', (req, res) => {
        // Clear the user session
        req.session.destroy(err => {
            if (err) {
                console.error('Error destroying session:', err);
                res.status(500).send('Error logging out');
                return;
            }
            console.log("User logged out.");
            // Redirect to the login page after logout
            res.redirect('/login');
        });
    });

    // Callback function that handles requests to the '/python' endpoint
    const localSummaryJobs = new Set();

    // Saves a finished summary onto the PDF's record.
    function saveSummary(storedFileName, userEmail, summary, callback) {
        const query = `
            UPDATE documents
            SET summary = ?
            WHERE file_name = ? AND email = ?
        `;
        global.db.query(query, [summary, storedFileName, userEmail], (error) => {
            callback(error);
        });
    }

    // Writes a summary on this computer when the cloud service is not available.
    function buildLocalSummary(storedFileName, callback) {
        const stem = storedFileName.replace(/\.pdf$/, "");
        if (localSummaryJobs.has(stem)) {
            return callback(null);
        }
        localSummaryJobs.add(stem);
        const child = runPython("local_summary.py", [stem]);
        let html = "";
        let errorOutput = "";
        child.stdout.on('data', (data) => {
            html += data.toString();
        });
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        child.on('close', (code) => {
            localSummaryJobs.delete(stem);
            if (code !== 0 || !html.trim()) {
                console.error(`Local summary failed for ${stem}: ${errorOutput || code}`);
                return callback(null);
            }
            callback(html.trim());
        });
    }

    // Starts turning a newly uploaded PDF into a summary.
    function invokePythonDocumentProcessor(req, res) {
        const storedFileName = req.file.filename;
        const userEmail = req.session.userEmail;
        const finishLocally = () => {
            buildLocalSummary(storedFileName, (html) => {
                if (!html) {
                    return;
                }
                saveSummary(storedFileName, userEmail, html, (error) => {
                    if (error) {
                        console.error(`Error saving local summary: ${error}`);
                        return;
                    }
                    console.log("Local summary saved.");
                });
            });
        };

        if (!global.process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log("No Google credentials found. Summarizing the PDF locally.");
            return finishLocally();
        }

        console.log("Spawning Python process");
        var process = runPython("doc_processing.py", [storedFileName.replace(".pdf", "")]);

        process.stdout.on('data', (data) => {
            console.log(data.toString());
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`Process exited with code: ${code}`);
                finishLocally();
            }
            else{invokePythonSummaryProcessor(req, res);}
        });
    };

    // Callback function that handles requests to the '/python' endpoint
    // Stores a new quiz so it can be taken later.
    function storeQuiz(filename, quiz, res) {
        let query = 'SELECT id FROM documents WHERE file_name = ?';
        global.db.query(query, [filename], (error, results) => {
            if (error) {
                console.error('Error getting id from documents for quiz', error);
                return res.status(500).send('Internal Server Error');
            }
            if (results.length === 0) {
                return res.status(404).send('Document not found');
            }

            const documentId = results[0].id;
            global.db.query("INSERT INTO quizzes (id, quiz) VALUES (?, ?)", [documentId, quiz], (insertError) => {
                if (insertError) {
                    console.error('Error adding quiz to db', insertError);
                    return res.status(500).send('Internal Server Error');
                }
                res.send({quiz: quiz, began: null});
            });
        });
    }

    // Builds quiz questions from facts that are actually in the PDF.
    function buildLocalQuiz(filename, numberOfQuestions, callback) {
        const stem = filename.replace(/\.pdf$/, "");
        const child = runPython("local_quiz.py", [stem, String(numberOfQuestions)]);
        let quiz = "";
        let errorOutput = "";
        child.stdout.on('data', (data) => {
            quiz += data.toString();
        });
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        child.on('close', (code) => {
            if (code !== 0 || !quiz.trim()) {
                console.error(`Local quiz failed: ${errorOutput || code}`);
                return callback(null);
            }
            try {
                JSON.parse(quiz);
            } catch (error) {
                console.error('Local quiz was not valid JSON:', error);
                return callback(null);
            }
            callback(quiz.trim());
        });
    }

    // Creates a quiz, using the cloud when it is set up and this computer otherwise.
    function invokePythonMultiChoiceQuestionProcessor(req, res) {
        const filename = req.body.filename;
        const numberOfQuestions = req.body.numberOfQuestions;
        const finishLocally = () => {
            buildLocalQuiz(filename, numberOfQuestions, (quiz) => {
                if (!quiz) {
                    return res.status(500).send('Internal Server Error');
                }
                storeQuiz(filename, quiz, res);
            });
        };

        if (!global.process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log("No Google credentials found. Creating the quiz locally.");
            return finishLocally();
        }

        var quiz = '';
        console.log("Spawning Python process");
        console.log(numberOfQuestions);
        var process = runPython("multichoicequestion_processing.py", [filename.replace(".pdf", ""), String(numberOfQuestions)]);

        process.stdout.on('data', (data) => {
            console.log(data.toString());
            quiz += data.toString().replaceAll("``` JSON", "").replaceAll("```", "");
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`Process exited with code: ${code}`);
                return finishLocally();
            }
            try {
                JSON.parse(quiz);
            } catch (error) {
                console.error('Error parsing quiz data:', error);
                return finishLocally();
            }
            storeQuiz(filename, quiz.trim(), res);
        });
    }

    // Callback function that handles requests to the '/python' endpoint
    // Asks the cloud to write the PDF summary.
    function invokePythonSummaryProcessor(req, res) {
        var summary;
        console.log("Spawning Python process");
        var process = runPython("summary_processing.py", [req.file.filename.replace(".pdf", "")]);

        process.stdout.on('data', (data) => {
            console.log(data.toString());
            summary = data.toString();
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`Process exited with code: ${code}`);
            }
            else {
                const filename = req.file.filename.replace(".pdf", "");
                const userEmail = req.session.userEmail;

                const query = `
                    UPDATE documents
                    SET summary = ?
                    WHERE file_name LIKE ? AND email = ?
                `;
                db.query(query, [summary, `%${filename}%`, userEmail], (error, results) => {
                    if (error) {
                        console.error(`Error updating summary in database: ${error}`);
                    } else {
                        console.log("Summary updated successfully in the database.");
                    }
                });
            }
        });
    };

    // Answers a chat question about the PDF.
    function invokePythonQuestionProcessor(req, res) {
        console.log(req.body.complete_history);
        console.log("Chat context: \n"+req.body.contextual_history+"\n Current Question: "+req.body.question)
        console.log("Spawning Python process");
        var process = runPython("question_processing.py", [req.body.filename.replace(".pdf", ""), `Chat History:\n${req.body.contextual_history}\nPrompt:\n${req.body.question}`]);
        let response = "";
        process.stdout.on('data', (data) => {
            console.log(data.toString());
            response = data.toString();
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`Process exited with code: ${code}`);
                res.send({message:"failed to generate a response at this moment"});
            }
            else{
                const filename = req.body.filename;
                const userEmail = req.session.userEmail;

                const query = `
                    SELECT messageHistory
                    FROM documents
                    WHERE file_name = ? AND email = ?
                `;

                // Fetch the existing messageHistory from the database
                db.query(query, [filename, userEmail], (error, results) => {
                    if (error) {
                        console.error(`Error fetching existing messageHistory: ${error}`);
                        return res.status(500).send({ error: 'Internal Server Error' });
                    }

                    let existingHistory = results[0] && results[0].messageHistory ? JSON.parse(results[0].messageHistory) : [];

                    // Construct the new message object
                    const newMessage = { Q: req.body.question, A: response };

                    // Append the new message to the existing message history
                    existingHistory.push(newMessage);

                    // Convert the updated message history back to JSON string
                    const updatedMessageHistory = JSON.stringify(existingHistory);

                    // Execute the update query
                    const updateQuery = `
                        UPDATE documents
                        SET messageHistory = ?
                        WHERE file_name = ? AND email = ?
                    `;
                    db.query(updateQuery, [updatedMessageHistory, filename, userEmail], (error, results) => {
                        if (error) {
                            console.error(`Error updating history in database: ${error}`);
                            return res.status(500).send({ error: 'Internal Server Error' });
                        }

                        console.log("History updated successfully in the database.");
                        res.send({ message: response });
                    });
                });

            }
        });
    };

    // Answers with "not found" when a page does not exist.
    app.use((req, res) => {
        res.status(404).send('404 - Not Found');
    });

    // Checks whether a saved file is still on disk.
    function fileExists(filePath) {
        return fs.existsSync(filePath);
    }
}