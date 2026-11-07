# SummarizePro layout

The app is split into pages and assets, the Node/Python server, and files written at runtime. Start it from the project root with `npm start` (`node backend/index.js`).

```
SummarizePro-master/
├── package.json                 npm name, dependencies, start script
├── package-lock.json
├── README.md                    how to use SummarizePro
├── STRUCTURE.md                 this tree
│
├── frontend/                    what the browser loads
│   ├── views/
│   │   ├── login.ejs            sign-in page
│   │   ├── register.ejs         account form
│   │   ├── home.ejs             library: folders, files, search
│   │   └── file.ejs             PDF, summary, quiz, and chat
│   └── public/                  Express static root
│       ├── favicon.ico
│       ├── css/
│       │   └── style.css        layout, theme, sidebar, library cards
│       ├── js/
│       │   ├── home.js          folder navigation, search, processing poll
│       │   └── file.js          quiz, chat, and processing overlay
│       └── images/
│           ├── file_icon.png
│           ├── file_loading_icon.gif
│           ├── quiz.png
│           ├── quiz-loading.gif
│           └── send.png
│
├── backend/                     server process
│   ├── index.js                 Express, session, MySQL pool, static and view mounts
│   ├── paths.js                 absolute paths for views, static files, uploads, embeddings
│   ├── routes/
│   │   └── main.js              auth, library, upload, summary, quiz, and chat routes
│   ├── processing/              Python jobs spawned by the routes
│   │   ├── storage_paths.py     resolves storage/uploads and storage/embeddings
│   │   ├── local_summary.py     stdlib PDF summary used without Google credentials
│   │   ├── local_quiz.py        stdlib multiple-choice quiz
│   │   ├── doc_processing.py    Document AI upload and embedding job
│   │   ├── summary_processing.py
│   │   ├── multichoicequestion_processing.py
│   │   └── question_processing.py
│   └── db/
│       └── create_db.sql        users, documents, quizzes
│
└── storage/                     user files on disk
    ├── uploads/                 PDFs named email&&d&&timestamp&&d&&folder&&d&&title.pdf
    └── embeddings/              pickle files written by the cloud document job
```

`node_modules/` stays at the project root and is not part of this tree.

`backend/index.js` serves `frontend/public` as static files and renders `frontend/views`. Uploaded PDFs are stored in `storage/uploads` and exposed at `/uploads` only when the session email is in the filename. Python scripts run with `backend/processing` as their working directory and read PDFs through `storage_paths.py`.
