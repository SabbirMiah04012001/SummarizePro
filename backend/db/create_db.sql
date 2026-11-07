-- Create the sumpro database if it doesn't exist
CREATE DATABASE IF NOT EXISTS spro;

-- Switch to the sumpro database
USE spro;

CREATE USER 'appuser'@'localhost' IDENTIFIED WITH mysql_native_password BY 'app2027';
GRANT ALL PRIVILEGES ON spro.* TO 'appuser'@'localhost';

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),  -- Store hashed password (nullable if using Google login)
    salt VARCHAR(255),           -- Store salt for password hashing (nullable if using Google login)
    google_id VARCHAR(255),      -- Store Google ID (nullable if using custom login)
    google_email VARCHAR(255),   -- Store Google email (nullable if using custom login)
    fs TEXT
);

CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    summary TEXT,
    messageHistory TEXT,
    FOREIGN KEY (email) REFERENCES users(email)
);

CREATE TABLE IF NOT EXISTS quizzes (
    id INT,
    began TEXT DEFAULT NULL,
    quiz TEXT,
    submittedQuiz TEXT,
    marked INT DEFAULT 0,
    FOREIGN KEY (id) REFERENCES documents(id)
);
