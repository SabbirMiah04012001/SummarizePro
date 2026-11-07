const currentPlace = decodeURIComponent(window.location.pathname).split("/").filter(Boolean).pop();
document.querySelectorAll(".dialog-place").forEach((place) => {
    place.textContent = currentPlace && currentPlace !== "home" ? currentPlace : "Library";
});
document.querySelectorAll(".folderPathVar").forEach((input) => {
    input.value = window.location.href;
});


// Check processing status periodically
let processingChecker = setInterval(checkProcessingStatus, 5000); // Check every 5 seconds (5000 milliseconds)

// Opens the folder or PDF the reader clicked.
function navigateToUrl(url) {
    window.location.href = url;
}

let processingCheckerEnder = setInterval(() => {
    if(!document.querySelector(".processing")){
        clearInterval(processingChecker);
        clearInterval(processingCheckerEnder);
    }
}, 5000)

// Opens one popup and closes any other.
function openDialog(dialog) {
    closeDialogs();
    const popup = document.getElementById("popupContainer");
    popup.hidden = false;
    dialog.hidden = false;
    const field = dialog.querySelector("input[type=text]");
    if (field) {
        field.focus();
    }
}

// Closes the folder and upload popups.
function closeDialogs() {
    document.getElementById("popupContainer").hidden = true;
    document.querySelectorAll(".popupContent").forEach((dialog) => {
        dialog.hidden = true;
    });
}

// Opens the upload popup.
function uploadFile() {
    openDialog(document.querySelector(".uploadDialogue"));
}

// Opens the new-folder popup.
function createFolder() {
    openDialog(document.querySelector(".createFolderDialogue"));
}

document.getElementById("popupContainer").addEventListener("click", (event) => {
    if (event.target.id === "popupContainer") {
        closeDialogs();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeDialogs();
    }
});

//updates filename when new file selected
document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('fileInput');
    const fileNameSpan = document.querySelector('.fileInputLabelName');

    fileInput.addEventListener('change', function() {
        if (fileInput.files.length > 0) {
            // Update the span with the selected file name
            fileNameSpan.textContent = fileInput.files[0].name;
        } else {
            // No file selected, revert to default text
            fileNameSpan.textContent = "Select a file...";
        }
    });
});

// Replaces the loading icon once a PDF summary is ready.
function checkProcessingStatus() {
    if (document.querySelector(".processing")) {
        const processingIcon = document.querySelector(".processing");
        const displayName = processingIcon.parentNode.querySelector("span").textContent.trim();
        const folderPath = decodeURIComponent(window.location.pathname).split("/home/")[1] || "";
        fetch('/processing_check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                "filename": "&&d&&" + folderPath + "&&d&&" + displayName
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data === false) {
                processingIcon.setAttribute("src", processingIcon.getAttribute("src").replace("file_loading_icon.gif", "file_icon.png"))
                processingIcon.classList.remove("processing");
            }
        })
        .catch(error => {
            console.error('Error checking processing status:', error);
        });
    }
}

document.querySelectorAll(".bin").forEach((button) => {
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const storedFile = button.dataset.file;
        const folderName = button.dataset.folder;
        const label = button.getAttribute("aria-label").replace("Delete ", "");
        const message = storedFile
            ? `Delete "${label}"?`
            : `Delete the folder "${label}" and everything inside it?`;
        if (!window.confirm(message)) {
            return;
        }
        const request = storedFile
            ? fetch("/delete_file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: storedFile })
            })
            : fetch("/delete_folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: folderName, path: window.location.href })
            });
        request.then((response) => {
            if (!response.ok) {
                throw new Error("Delete failed");
            }
            window.location.reload();
        }).catch(() => {
            window.alert("That item could not be deleted.");
        });
    });
});

document.querySelector(".top-search").addEventListener("input", function(event) {
    const inputValue = event.target.value.toLowerCase(); // Convert input value to lowercase for case-insensitive comparison

    const fileExplorerDivs = document.querySelectorAll(".file-explorer div");

    fileExplorerDivs.forEach(div => {
        const divInnerText = div.innerText.toLowerCase(); // Convert inner text to lowercase

        if (divInnerText.includes(inputValue)) {
            div.style.display = "";
        } else {
            div.style.display = "none";
        }
    });
});
