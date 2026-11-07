"""Build a multiple-choice quiz from facts that appear in a local PDF."""
import json
import random
import re
import sys

from local_summary import extract_text

MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
MONTH_PATTERN = "|".join(MONTHS)
FACT_PATTERNS = (
    ("percent", re.compile(r"\b\d+(?:\.\d+)?%")),
    ("email", re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")),
    ("date", re.compile(rf"\b(?:{MONTH_PATTERN})\s+\d{{4}}\b")),
    ("count", re.compile(r"\b\d{1,3}(?:,\d{3})+\b|\b\d+\b")),
)


# Reads the PDF and breaks it into sentences.
def document_sentences(stem):
    from storage_paths import UPLOADS
    pdf_path = UPLOADS / f"{stem}.pdf"
    if not pdf_path.is_file():
        raise FileNotFoundError(pdf_path)
    chunks = []
    for line in extract_text(pdf_path.read_bytes()):
        line = line.strip()
        if not line or re.match(r"Page \d+ of \d+$", line):
            continue
        # A short line with no fact is a heading, not a sentence fragment.
        if len(line) < 40 and not re.search(r"\d|[.!?@:]", line):
            continue
        chunks.append(line)
    parts = []
    continues = re.compile(r"\b(?:a|an|the|to|in|on|of|for|and|or|with|by|at|from)\s*$", re.I)
    for line in chunks:
        if parts and not re.search(r"[.!?]$", parts[-1]) and not continues.search(parts[-1]) and re.match(r"[A-Z]", line):
            parts[-1] += "."
        parts.append(line)
    text = re.sub(r"\s+", " ", " ".join(parts)).strip()
    sentences = []
    for piece in re.split(r"(?<=[.!?])\s+", text):
        sentence = piece.strip()
        if len(sentence.split()) >= 6:
            sentences.append(sentence)
    return sentences


# Finds percentages, emails, dates, and counts in one sentence.
def facts_in(sentence):
    found = []
    for kind, pattern in FACT_PATTERNS:
        for match in pattern.finditer(sentence):
            start, end = match.span()
            raw = match.group(0)
            if kind == "count":
                if re.fullmatch(r"(?:19|20)\d{2}", raw):
                    continue
                window = sentence[max(0, start - 8):start]
                if raw in {"1", "2", "3"} and re.search(r"Phase\s*$", window):
                    continue
            if any(start >= used_start and end <= used_end for _, used_start, used_end, _ in found):
                continue
            found.append((kind, start, end, raw))
    return found


# Checks whether a possible answer is already written in the PDF.
def appears_in(value, document):
    return value.lower() in document.lower()


# Writes a number in the same style as the original fact.
def render_number(value, original):
    text = f"{value:,}" if "," in original else str(value)
    if original.endswith("%"):
        text += "%"
    return text


# Makes wrong number choices that do not appear in the PDF.
def number_distractors(original, document):
    digits = int(original.replace(",", "").replace("%", ""))
    distractors = []
    for delta in (5, 10, 15, 20, 25, 40, 50, 100, 200, 500):
        for changed in (digits + delta, digits - delta):
            if changed <= 0 or changed == digits:
                continue
            text = render_number(changed, original)
            if text not in distractors and not appears_in(text, document):
                distractors.append(text)
            if len(distractors) == 3:
                return distractors
    return distractors


# Makes wrong dates that do not appear in the PDF.
def date_distractors(original, document):
    month, year = original.split()
    year = int(year)
    index = MONTHS.index(month)
    distractors = []
    for shift in (1, -1, 2, -2, 3, 4, 5, -3):
        text = f"{MONTHS[(index + shift) % 12]} {year}"
        if text != original and text not in distractors and not appears_in(text, document):
            distractors.append(text)
    for shifted_year in (year + 1, year - 1, year + 2):
        text = f"{month} {shifted_year}"
        if text not in distractors and not appears_in(text, document):
            distractors.append(text)
    return distractors[:3]


# Makes wrong email addresses that do not appear in the PDF.
def email_distractors(original, document):
    local, domain = original.split("@", 1)
    candidates = [
        f"help@{domain}",
        f"support@{domain}",
        f"alerts@{domain}",
        f"{local}@example.com",
        f"security@campus.example",
    ]
    return [item for item in candidates if item.lower() != original.lower() and not appears_in(item, document)][:3]


# Chooses the right kind of wrong answers for a fact.
def distractors_for(kind, original, document):
    if kind in {"percent", "count"}:
        return number_distractors(original, document)
    if kind == "date":
        return date_distractors(original, document)
    if kind == "email":
        return email_distractors(original, document)
    return []


# Turns one fact into a multiple-choice question.
def cloze_question(sentence, fact, document):
    kind, start, end, original = fact
    wrong = distractors_for(kind, original, document)
    if len(wrong) < 3:
        return None
    prompt = f"{sentence[:start]}____{sentence[end:]}"
    prompt = re.sub(r"\s+", " ", prompt).strip()
    options = [original, *wrong[:3]]
    random.shuffle(options)
    letters = ["A", "B", "C", "D"]
    return {
        "Q": prompt,
        "A": options[0],
        "B": options[1],
        "C": options[2],
        "D": options[3],
        "CA": letters[options.index(original)],
    }


# Collects every usable question from the PDF.
def question_pool(sentences):
    document = " ".join(sentences)
    pool = []
    seen = set()
    for sentence in sentences:
        for fact in facts_in(sentence):
            question = cloze_question(sentence, fact, document)
            if not question or question["Q"] in seen:
                continue
            seen.add(question["Q"])
            pool.append(question)
    return pool


# Keeps only as many questions as the reader asked for.
def build_quiz(sentences, count):
    pool = question_pool(sentences)
    if not pool:
        return {}
    requested = max(1, min(int(count), len(pool)))
    random.shuffle(pool)
    chosen = pool[:requested]
    return {f"Q{index + 1}": question for index, question in enumerate(chosen)}


# Builds the quiz, or just reports how many questions are possible.
def main():
    if len(sys.argv) < 3:
        print("usage: local_quiz.py <filename> <count|count-only>", file=sys.stderr)
        return 1
    stem = sys.argv[1][:-4] if sys.argv[1].endswith(".pdf") else sys.argv[1]
    try:
        sentences = document_sentences(stem)
    except FileNotFoundError as error:
        print(error, file=sys.stderr)
        return 1
    if sys.argv[2] == "count":
        print(len(question_pool(sentences)))
        return 0
    quiz = build_quiz(sentences, sys.argv[2])
    if not quiz:
        print("no facts found in the pdf", file=sys.stderr)
        return 1
    print(json.dumps(quiz))
    return 0


if __name__ == "__main__":
    sys.exit(main())
