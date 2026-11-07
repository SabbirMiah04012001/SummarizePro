# SummarizePro

SummarizePro helps you study a PDF. You upload a document, read a short summary, take a quiz made only from facts in that file, and ask questions about it in chat.

Open the app in your browser. On this computer that address is [http://127.0.0.1:3000](http://127.0.0.1:3000).

## What to install

Install these programs first:

- [Node.js](https://nodejs.org/), which includes npm
- [Python 3](https://www.python.org/downloads/)
- MySQL or MariaDB, listening on `127.0.0.1` port `3307`

In the project folder, download the Node packages with:

```bash
npm install
```

That installs:

- `bcrypt`, to store passwords safely
- `body-parser`, to read form data
- `ejs`, to build the pages
- `express`, to run the website
- `express-session`, to keep you signed in
- `multer`, to accept PDF uploads
- `mysql`, to talk to the database

Summaries and quizzes on this computer use only Python’s built-in tools, so they do not need extra Python packages.

Chat, and reading a PDF through Google, need these Python packages:

```bash
pip3 install google-cloud-documentai google-cloud-storage tenacity pandas numpy vertexai
```

Create the database from `backend/db/create_db.sql`, then start the app with `npm start`.

## Create an account

1. On the sign-in page, choose **Register here**.
2. Enter your email.
3. Choose a password of at least 6 characters, then type it again under **Confirm Password**.
4. If the two passwords differ, the form says **Passwords do not match** and will not continue.
5. Choose **Register**. You are signed in and taken to your library.

Already have an account? Choose **Login here** and sign in with the same email and password.

## Your library

The library is your home page. The left panel shows **Library**, your email, and **Log out**.

- **New folder** creates a folder in the place you are viewing. Names can use letters, numbers, spaces, dots, underscores, and dashes. **Cancel** closes the box without creating anything.
- **+ Upload PDF** asks for a title and a PDF file, then saves it in the current folder. While the summary is being prepared, the file shows as **Processing**. When it is ready, it shows **Ready**.
- Click a folder to open it. Click a file to study it.
- The search box filters the folders and files on the current page.
- Rest the pointer on a folder or file to show a red bin in the corner. Click it and confirm to delete. Deleting a folder also deletes everything inside it.
- **Back** in the top bar returns you to the folder you came from.

## Study a PDF

Opening a file shows four sections. Use the left panel to jump to one, or scroll the page.

### Summary

This is a short reading of the PDF. It stays with the file, so you do not regenerate it each visit.

### Quiz

1. The page reads the PDF and tells you the highest number of questions it can support. You can choose any number from 1 up to that maximum.
2. Choose **Create Quiz**, then **Begin**.
3. Answer one question at a time. Tick an answer, then choose **Next**. **Back** returns to the previous question. On the last question, **Finish** ends the quiz.
4. You have one minute per question. If time runs out, submit the quiz to see the result.
5. The result shows your score and marks the correct choice. A wrong tick is shown as well.
6. Choose **New quiz** to pick a new number of questions and start again. The quiz you just finished appears under **Past quizzes** on the left. Click a past quiz to open that result again.

Questions use only facts that appear in the PDF. If a file does not contain enough of those facts, the page says a quiz cannot be made.

### Chat

Type a question about the PDF and send it. The reply appears under your question. **Clear chat** removes the conversation for this file. The summary above is not deleted.

### Document

This is the original PDF, so you can check a line while you read the summary or take a quiz.

**Delete** in the top bar removes this PDF after you confirm. You return to the folder it was in.

## Sign out

Choose **Log out** in the left panel. The next visit asks you to sign in again.
