// Will execute if not processed yet
if(document.querySelector(".main-content-file").classList.contains("processing")){
    let element = document.createElement("div")
    element.className = "processing-overlay"
    document.body.appendChild(element)
    let dialogue = document.createElement("div");
    dialogue.className = "processing-card"
    dialogue.innerHTML = "<p>This file is still processing.</p><span>The page will refresh when the summary is ready.</span>"
    document.body.appendChild(dialogue)

    // Periodically checking if the file processing is complete
    setInterval(function(){
        fetch('/processing_check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "filename": document.querySelector("input[name='filename']").value.replace(/\.pdf$/, "")
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data === false) {
                window.location.reload();
            }
        })
        .catch(error => {
            console.error('Error checking processing status:', error);
        });
    }, 5000)
}
// If processed, execute rest of file
else{
    document.querySelector(".messages").scrollTop = document.querySelector(".messages").scrollHeight

    // Opens a folder or PDF when its card is clicked.
    function navigateToUrl(url) {
        window.location.href = url;
    }

    let currentQuiz;
    let finalAnswers;

    // Finds out how many questions this PDF can honestly support.
    function loadQuizCapacity(){
        const form = document.querySelector(".generate-quiz");
        if(!form){
            return;
        }
        const note = form.querySelector(".capacity-note");
        const picker = form.querySelector(".question-count");
        const range = form.querySelector("#questionCount");
        const value = form.querySelector(".count-value");
        const maximum = form.querySelector(".count-max");
        const button = form.querySelector(".creat-quiz");
        fetch("/quiz_capacity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: form.filename.value })
        })
        .then(response => response.json())
        .then(data => {
            const max = Number(data.max) || 0;
            if(max < 1){
                note.textContent = "This PDF does not contain enough facts for a quiz.";
                return;
            }
            range.max = String(max);
            range.value = String(max);
            maximum.textContent = String(max);
            value.textContent = String(max);
            note.textContent = max === 1
                ? "This PDF can support 1 question."
                : `This PDF can support up to ${max} questions. Choose any number from 1 to ${max}.`;
            picker.hidden = false;
            button.disabled = false;
            range.addEventListener("input", () => {
                value.textContent = range.value;
            });
        })
        .catch(() => {
            note.textContent = "The question limit could not be read. Please refresh and try again.";
        });
    }

    loadQuizCapacity();

    // Builds a new quiz with the number of questions the reader chose.
    function createQuiz(event){
        event.preventDefault();
        const requested = Number(event.srcElement["option"].value);
        if(!requested){
            return;
        }
    
        document.querySelector(".quiz-view").innerHTML = `
            <img class="loading" src="/images/quiz-loading.gif" alt="loading gif">
            <div class="loading-text">Creating the quiz!</div>
        `
    
        fetch("/create_quiz", {
            "method": "POST",
            "headers": {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            "body": JSON.stringify({"filename":event.srcElement["filename"].value, "numberOfQuestions":requested})
        })
        .then(response => {
            if (response.ok) {
                return response.json(); // Parse response body as JSON
            }
            else{
                throw new Error("Network response was not ok.");
            }
        })
        .then(data => {
            currentQuiz = data;
            const count = Object.keys(JSON.parse(data.quiz)).length;
            document.querySelector(".quiz-view").innerHTML = `<span class='attempt-quiz'>Once you begin, you have ${count} minutes to complete this quiz.<button onclick='displayQuiz()'>Begin?</button></span>`
        })
        .catch(error => {
            console.error("There was a problem with the request:", error);
            document.querySelector(".quiz-view").innerHTML = `<span class='attempt-quiz'>The quiz could not be created. Please try again.</span>`
        });
    }
    
    // Makes question text safe to show on the page.
    function escapeHtml(value){
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // Draws one answer choice, including a tick when the quiz is finished.
    function optionMarkup(part, letter, text, marked){
        let state = "";
        let checked = "";
        if(marked){
            const chosen = marked.selected === letter;
            const correct = marked.CA === letter;
            checked = chosen ? "checked" : "";
            state = [
                chosen ? "is-chosen" : "",
                correct ? "is-correct" : "",
                chosen && !correct ? "is-wrong" : ""
            ].filter(Boolean).join(" ");
        }
        return `
            <input name="${part}-answer" type="radio" id="${part}-${letter}" value="${letter}" hidden ${checked} ${marked ? "disabled" : ""}>
            <label class="answer-select ${state}" for="${part}-${letter}">
                <span class="tick" aria-hidden="true"></span>
                <span class="answer-copy">${escapeHtml(text)}</span>
            </label>
        `;
    }

    // Draws every question, showing one at a time until the quiz is over.
    function questionFields(quiz, markedQuiz){
        let html = "";
        let index = 0;
        for(let part in quiz){
            const item = markedQuiz ? markedQuiz[part] : quiz[part];
            html += `
                <div class="field" data-step="${index}" ${index === 0 ? "" : "hidden"}>
                    <div class='question-kicker'>From the document</div>
                    <div class='question'>${escapeHtml(item["Q"])}</div>
                    ${optionMarkup(part, "A", item["A"], markedQuiz && item)}
                    ${optionMarkup(part, "B", item["B"], markedQuiz && item)}
                    ${optionMarkup(part, "C", item["C"], markedQuiz && item)}
                    ${optionMarkup(part, "D", item["D"], markedQuiz && item)}
                    ${markedQuiz && item.selected === "none" ? '<div class="none-selected">You did not select an answer.</div>' : ""}
                    <input name="${part}-answer" type="radio" value="none" hidden ${markedQuiz ? "disabled" : "checked"}>
                </div>
            `;
            index++;
        }
        return html;
    }

    let quizStep = 0;

    // Shows the current question and updates the progress bar.
    function showQuizStep(){
        const fields = [...document.querySelectorAll(".do-quiz .field")];
        fields.forEach((field, index) => {
            field.hidden = index !== quizStep;
        });
        const progress = document.querySelector(".quiz-progress");
        const fill = document.querySelector(".quiz-progress-bar span");
        const next = document.querySelector(".quiz-next");
        const back = document.querySelector(".quiz-back");
        if(progress){
            progress.textContent = `Question ${quizStep + 1} of ${fields.length}`;
        }
        if(fill){
            fill.style.width = `${((quizStep + 1) / fields.length) * 100}%`;
        }
        if(back){
            back.disabled = quizStep === 0;
        }
        if(next){
            next.textContent = quizStep === fields.length - 1 ? "Finish" : "Next";
        }
    }

    // Checks that the reader has ticked an answer before moving on.
    function quizAnswered(){
        const field = document.querySelector(`.do-quiz .field[data-step="${quizStep}"]`);
        return field && field.querySelector('input[type="radio"]:checked').value !== "none";
    }

    // Moves to the next or previous question, or finishes on the last one.
    function moveQuiz(direction){
        const fields = document.querySelectorAll(".do-quiz .field");
        const hint = document.querySelector(".quiz-hint");
        if(direction > 0 && !quizAnswered()){
            if(hint){
                hint.hidden = false;
            }
            return;
        }
        if(direction > 0 && quizStep === fields.length - 1){
            submitEarly();
            return;
        }
        quizStep = Math.min(Math.max(quizStep + direction, 0), fields.length - 1);
        if(hint){
            hint.hidden = true;
        }
        showQuizStep();
    }

    // Puts the quiz on screen and starts the countdown.
    function displayQuiz(preLoaded = false){
        if(preLoaded){
            currentQuiz = JSON.parse(document.querySelector("#preloadedQuiz").textContent);
        }
    
        let quiz = JSON.parse(currentQuiz.quiz);
    
        let numberOfQuestions = 0;
        for(let part in quiz){
            numberOfQuestions++;
        }

        quizStep = 0;
        let newHTML = `
            <form class='do-quiz' onsubmit="event.preventDefault()">
                <div class='quiz-title'>
                    <span class="quiz-progress">Question 1 of ${numberOfQuestions}</span>
                    <span class="quiz-timer">${String(numberOfQuestions).padStart(2, "0")}:00</span>
                </div>
                <div class="quiz-progress-bar" aria-hidden="true"><span></span></div>
                ${questionFields(quiz)}
                <p class="quiz-hint" hidden>Tick an answer to continue.</p>
                <div class="quiz-nav">
                    <button class="quiz-back" type="button" onclick="moveQuiz(-1)">Back</button>
                    <button class="quiz-next" type="button" onclick="moveQuiz(1)">Next</button>
                </div>
            </form>
        `;
        document.querySelector(".quiz-view").innerHTML = newHTML;
        showQuizStep();
    
        if(currentQuiz["began"] == null){
            const timestamp = Date.now();
            currentQuiz.began = timestamp;
            fetch("/start_quiz", {
                "method": "POST",
                "headers": {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                "body": JSON.stringify({"filename":document.querySelector('input[name="filename"]').value, "time":timestamp})
            })
            .then(response => {
                if (response.ok) {
                    startTimer(timestamp, numberOfQuestions);
                }
                else{
                    throw new Error("Network response was not ok.");
                }
            })
            .catch(error => {
                // Handle errors
                console.error("There was a problem with the request:", error);
            });
        }
        else{
            startTimer(currentQuiz["began"], numberOfQuestions);
        }
    }
    
    var timerInterval;
    // Counts down one minute for each question.
    function startTimer(timestamp, limit){
        let timer = document.querySelector(".quiz-timer");
    
        limit = limit * 60 * 1000;
    
        let timeRemaining = limit; // Initial value for time remaining
    
        timerInterval = setInterval(() => {
            // Calculate the elapsed time since the timestamp
            const elapsedTime = Date.now() - timestamp;
    
            // Calculate the time remaining by subtracting the elapsed time from the time limit
            timeRemaining = Math.max(limit - elapsedTime, 0); // Ensure time remaining doesn't go negative
    
            // Check if time is up
            if (timeRemaining <= 0) {
                clearInterval(timerInterval); // Stop the interval
                finalAnswers = new FormData(document.querySelector(".do-quiz"))
                document.querySelector(".quiz-view").innerHTML = `<span class='attempt-quiz'>You have run out of time!<button onclick='submitQuiz()'>Submit quiz</button></span>`
            } else {
                timer.innerText = formatTime(timeRemaining);
            }
        }, 100);
    }
    
    // Ends the quiz early when the reader presses Finish.
    function submitEarly(){
        clearInterval(timerInterval);
        finalAnswers = new FormData(document.querySelector('.do-quiz'));
        submitQuiz();
    }
    
    // Opens a saved quiz from the Past quizzes list.
    function openQuizHistory(button){
        const savedScript = button.nextElementSibling;
        if(!savedScript){
            return;
        }
        let quizMarked = savedScript.textContent.trim();
        try {
            quizMarked = JSON.parse(quizMarked);
            if(typeof quizMarked === "string"){
                quizMarked = JSON.parse(quizMarked);
            }
        } catch (error) {
            console.error("Saved quiz could not be read:", error);
            return;
        }
        document.querySelectorAll(".historic-quiz.is-open").forEach((item) => item.classList.remove("is-open"));
        button.classList.add("is-open");
        submitQuiz(quizMarked, button.textContent.trim());
        document.getElementById("quiz").scrollIntoView({ block: "start" });
    }
    window.openQuizHistory = openQuizHistory;

    // Shows the score and which answers were right.
    function showFinishedQuiz(quizMarked, date){
        let marks = 0;
        let numberOfQuestions = 0;
        for (let part in quizMarked) {
            if(quizMarked[part]["result"]){
                marks++;
            }
            numberOfQuestions++;
        }
        const scoreColor = (marks / numberOfQuestions) > 0.5 ? "var(--ok)" : "var(--danger)";
        const heading = date ? `Quiz result<br>${date}` : "Quiz result";
        document.querySelector(".quiz-view").innerHTML = `<form class='do-quiz done'><div class='quiz-title'><span>${heading}</span><span style="color:${scoreColor}">${marks} / ${numberOfQuestions}</span></div>${questionFields(quizMarked, quizMarked)}</form><button type="button" class="creat-quiz new-quiz" onclick="startAnotherQuiz()">New quiz</button>`;
        document.querySelectorAll(".do-quiz.done .field").forEach((field) => { field.hidden = false; });
        const quizView = document.querySelector(".quiz-view");
        quizView.scrollTop = 0;
        quizView.scrollIntoView({ block: "nearest" });
    }

    // Marks the quiz that was just taken, or shows one that was saved earlier.
    function submitQuiz(pastQuiz = null, date = null){
        if(pastQuiz != null){
            let quizMarked = pastQuiz;
            if(typeof quizMarked === "string"){
                quizMarked = JSON.parse(quizMarked);
                if(typeof quizMarked === "string"){
                    quizMarked = JSON.parse(quizMarked);
                }
            }
            showFinishedQuiz(quizMarked, date);
        }
        else{
            let quizMarked = JSON.parse(currentQuiz.quiz);
            for (const [name, value] of finalAnswers.entries()) {
                const part = name.replace("-answer", "");
                quizMarked[part].result = quizMarked[part]["CA"] == value;
                quizMarked[part].selected = value;
            }
            showFinishedQuiz(quizMarked);
            pendingHistory = { began: currentQuiz.began || Date.now(), quiz: quizMarked };

            fetch("/mark_quiz", {
                "method": "POST",
                "headers": {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                "body": JSON.stringify({"filename":document.querySelector('input[name="filename"]').value, "quiz":quizMarked})
            })
            .then(response => {
                if (response.ok) {
                }
                else{
                    throw new Error("Network response was not ok.");
                }
            })
            .catch(error => {
                // Handle errors
                console.error("There was a problem with the request:", error);
            });
        }
    }

    let pendingHistory = null;

    // Writes the time of a finished quiz the same way the sidebar does.
    function formatQuizStamp(timestamp){
        const date = new Date(parseInt(timestamp, 10));
        const day = date.getDate().toString().padStart(2, "0");
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const year = date.getFullYear().toString().slice(-2);
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, "0");
        const amPm = hours >= 12 ? "pm" : "am";
        hours = hours % 12 || 12;
        return `${hours}:${minutes} ${amPm}, ${day}/${month}/${year}`;
    }

    // Adds the quiz just finished to Past quizzes.
    function recordFinishedQuiz(){
        if(!pendingHistory){
            return;
        }
        const history = document.querySelector(".quiz-history");
        if(!history || document.getElementById(String(pendingHistory.began))){
            pendingHistory = null;
            return;
        }
        const empty = history.querySelector(".no-quiz");
        if(empty){
            empty.remove();
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "historic-quiz";
        button.textContent = formatQuizStamp(pendingHistory.began);
        button.addEventListener("click", () => openQuizHistory(button));
        const saved = document.createElement("script");
        saved.type = "application/json";
        saved.id = String(pendingHistory.began);
        saved.textContent = JSON.stringify(pendingHistory.quiz);
        history.append(button, saved);
        button.scrollIntoView({ block: "nearest" });
        pendingHistory = null;
    }

    // Returns to the question picker and lists the quiz that was just finished.
    function startAnotherQuiz(){
        recordFinishedQuiz();
        const filename = document.querySelector('input[name="filename"]').value;
        document.querySelector(".quiz-view").innerHTML = `
            <span class="make-quiz-title"><img src="/images/quiz.png" alt=""> Multiple Choice<br>Quiz</span>
            <form onsubmit="createQuiz(event)" class="generate-quiz" action="/create_quiz" method="post">
                <p class="capacity-note">Reading this PDF for usable questions...</p>
                <div class="question-count" hidden>
                    <label class="count-label" for="questionCount">Questions</label>
                    <input type="range" id="questionCount" name="option" min="1" max="1" value="1" step="1">
                    <div class="count-scale">
                        <span>1</span>
                        <strong class="count-value">1</strong>
                        <span class="count-max">1</span>
                    </div>
                </div>
                <input hidden name="filename" type="text" value="${escapeHtml(filename)}">
                <button class="creat-quiz" disabled>Create Quiz</button>
            </form>
        `;
        loadQuizCapacity();
        document.getElementById("quiz").scrollIntoView({ block: "start" });
    }
    window.startAnotherQuiz = startAnotherQuiz;

    // Turns the countdown into minutes and seconds.
    function formatTime(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // Clears this PDF's chat.
    function resetHistory(){
        fetch("/reset_history", {
            "method": "POST",
            "headers": {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            "body": JSON.stringify({
                "filename": document.querySelector('input[name="filename"]').value,
            })
        })
        .then(response => {
            if (response.ok) {
                window.location.reload();
            } else {
                throw new Error("Network response was not ok.");
            }
        })
        .catch(error => {
            // Handle errors
            console.error("There was a problem with the request:", error);
        });
    }
    
    // Deletes this PDF after the reader confirms.
    function deleteFile(){
        var confirmed = window.confirm("Are you sure you want to delete this document?");
        if (confirmed) {
            fetch("/delete_file", {
                "method": "POST",
                "headers": {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                "body": JSON.stringify({
                    "filename": document.querySelector('input[name="filename"]').value,
                })
            })
            .then(response => {
                if (response.ok) {
                    window.location.href = "/home/"+document.querySelector('input[name="filename"]').value.split("&&d&&")[2];
                } else {
                    throw new Error("Network response was not ok.");
                }
            })
            .catch(error => {
                // Handle errors
                console.error("There was a problem with the request:", error);
            });
        }
    }

    document.querySelector(".chat-interact form").addEventListener("click", function(){
        document.querySelector(".chat-interact input[name='message']").focus();
    })

    document.querySelectorAll(".section-nav a[href^='#']").forEach((link) => {
        link.addEventListener("click", () => {
            document.querySelectorAll(".section-nav a").forEach((item) => item.classList.remove("is-current"));
            link.classList.add("is-current");
        });
    });

    // Sends the typed question and shows the reply in the chat.
    document.addEventListener("DOMContentLoaded", function() {
        // Get the form element
        var form = document.querySelector(".chat-container form");

        // Add event listener for form submission
        form.addEventListener("submit", function(event) {
            // Prevent the default form submission
            event.preventDefault();

            // Gather form data
            var formData = new FormData(form);
            let historiesEl = document.querySelectorAll(".chat-container .message");
            let histories = [];
            let completeHistory = [];
            let responseLoader;

            for(let history of historiesEl){
                if(!history.classList.contains("greeting")){
                    if(history.classList.contains("question")){
                        history = history.querySelector(".message-body");
                        histories.push("Q: "+history.innerText);
                        completeHistory.push("Q: "+history.innerHTML);
                    }else if(history.classList.contains("answer")){
                        history = history.querySelector(".message-body");
                        histories.push("A: "+history.innerText);
                        completeHistory.push("A: "+history.innerHTML);
                    }
                }
            }

            if(histories.length>3){
                histories.reverse().splice(4, histories.length);
                histories.reverse();
            }

            // Create a new div element
            let messageDiv = document.createElement('div');
            messageDiv.classList.add('message', 'question', 'animated');
            messageDiv.innerHTML = `
                <div class="message-header">
                    <span class="who">You</span>
                </div>
                <div class="message-body">
                    ${formData.get("message")}
                </div>
            `;
            document.querySelector(".chat-container .messages").appendChild(messageDiv);

            setTimeout(() => {
                messageDiv.classList.remove("animated");

                // Create a new div element
                messageDiv = document.createElement('div');
                messageDiv.classList.add('message', 'answer', 'animated');
                messageDiv.setAttribute("style", "animation: blink 2s infinite")
                messageDiv.innerHTML = `
                    <div class="message-header">
                        <span class="who">S</span> SummarizePro
                    </div>
                    <div class="message-body">
                        Thinking...
                    </div>
                `;
                document.querySelector(".chat-container .messages").appendChild(messageDiv);
    
                setTimeout(() => {
                    messageDiv.classList.remove("animated");
                }, 2500);
    
                const intervalId = setInterval(() => {
                    if (messageDiv && messageDiv.classList.contains("animated")) {
                        document.querySelector(".chat-container .messages").scrollTop = document.querySelector(".chat-container .messages").scrollHeight;
                    } else {
                        clearInterval(intervalId); // Stop the interval if the element doesn't have the class or doesn't exist
                    }
                }, 12);
    
                responseLoader = setInterval(() => {
                    let text = messageDiv.querySelector(".message-body");
                    if (text.innerText.startsWith("Thinking")) {
                        let dots = text.innerText.match(/\.{0,4}$/)[0];
                        let nextDots = dots.length < 4 ? dots + '.' : '';
                        text.innerText = `Thinking${nextDots}`;
                    }
                }, 1000);
            }, 2500);
    
            const intervalId = setInterval(() => {
                if (messageDiv && messageDiv.classList.contains("animated")) {
                    document.querySelector(".chat-container .messages").scrollTop = document.querySelector(".chat-container .messages").scrollHeight;
                } else {
                    clearInterval(intervalId); // Stop the interval if the element doesn't have the class or doesn't exist
                }
            }, 12);
    
            //clear value in input
            let input = document.querySelector(".chat-interact form input[name='message']");
            input.disabled = true;
            input.value = "";
            input.setAttribute("placeholder", "SummarizePro is generating a response...");
            let button = document.querySelector(".chat-interact form button");
            button.disabled = true;
            form.classList.add("is-busy");
    
            // Make a POST request
            fetch("/message", {
                "method": "POST",
                "headers": {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                "body": JSON.stringify({question:formData.get("message"), filename:formData.get("filename"), contextual_history:histories.join("\n"), complete_history:completeHistory})
            })
            .then(response => {
                // Handle response
                if (response.ok) {
                    return response.json(); // Parse response body as JSON
                }
                throw new Error("Network response was not ok.");
            })
            .then(data => {
                // Handle successful response
                clearInterval(responseLoader);
                messageDiv.setAttribute("style", "animation: none")
                messageDiv.querySelector(".message-body").innerHTML = data.message;

                input.disabled = false;
                button.disabled = false;
                form.classList.remove("is-busy");
                input.setAttribute("placeholder", "Type here to chat...");
            })
            .catch(error => {
                // Handle errors
                console.error("There was a problem with the request:", error);
            });
        });
    });

}
