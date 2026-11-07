const express = require('express');
const session = require('express-session');
const paths = require('./paths');
const mysql = require('mysql');
const crypto = require('crypto');

// Generating secret key
const secretKey = crypto.randomBytes(32).toString('hex');

const app = express();
const port = 3000;

app.set('baseUrl', '');

app.use(session({
    secret: secretKey,
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days in milliseconds
      },
}));

// Middleware to parse the request body for form submissions
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// A pool replaces dead connections instead of crashing the process.
const dbConnection = mysql.createPool({
    host: '127.0.0.1',
    port: 3307,
    user: 'appuser',
    password: 'app2027',
    database: 'spro',
    connectionLimit: 10,
});
dbConnection.on('error', (err) => {
    console.error('MySQL pool error: ' + (err.code || err.message));
});
dbConnection.query('SELECT 1', (err) => {
    if (err) {
        console.error('Error connecting to MySQL: ' + err.stack);
        return;
    }
    console.log('Connected to MySQL pool');
});
global.db = dbConnection;

// Lets someone open a PDF only if it belongs to their account.
function isAuthorized(req, res, next) {
    const requestedFile = req.originalUrl;
    const userEmail = req.session.userEmail;
    // Check if the requested file belongs to the authenticated user
    if (requestedFile.includes(userEmail)) {
        return next(); // User is authorized, continue
    }
    res.status(403).send('Unauthorized'); // Send 403 Forbidden if user is not authorized
};

app.use(express.static(paths.publicDir));
app.use('/uploads', isAuthorized, express.static(paths.uploads));

app.set('view engine', 'ejs');
app.set('views', paths.views);

require("./routes/main")(app);

// Starting the server
app.listen(port, '127.0.0.1', () => console.log(`SummarizePro is live on port ${port}!`))
