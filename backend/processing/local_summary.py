"""Build an HTML summary from a local PDF when cloud processing is unavailable."""
import re
import sys
import zlib


# Turns a packed PDF chunk back into normal data.
def ascii85_decode(data):
    data = re.sub(br"\s+", b"", data)
    if data.endswith(b"~>"):
        data = data[:-2]
    output = bytearray()
    for offset in range(0, len(data), 5):
        chunk = data[offset:offset + 5]
        padding = 5 - len(chunk)
        if padding:
            chunk += b"u" * padding
        value = 0
        for byte in chunk:
            value = value * 85 + (byte - 33)
        decoded = value.to_bytes(4, "big")
        output.extend(decoded if not padding else decoded[:4 - padding])
    return bytes(output)


# Unpacks one piece of the PDF so its words can be read.
def decode_stream(dictionary, stream):
    if b"ASCII85Decode" in dictionary:
        stream = ascii85_decode(stream)
    if b"FlateDecode" in dictionary:
        stream = zlib.decompress(stream)
    return stream


# Cleans up text that was stored inside the PDF.
def unescape_pdf_string(value):
    output = []
    index = 0
    while index < len(value):
        character = value[index]
        if character != "\\":
            output.append(character)
            index += 1
            continue
        index += 1
        if index >= len(value):
            break
        escaped = value[index]
        mapping = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "(": "(", ")": ")", "\\": "\\"}
        if escaped in mapping:
            output.append(mapping[escaped])
            index += 1
        elif escaped.isdigit():
            octal = escaped
            index += 1
            while index < len(value) and value[index].isdigit() and len(octal) < 3:
                octal += value[index]
                index += 1
            output.append(chr(int(octal, 8)))
        else:
            output.append(escaped)
            index += 1
    return "".join(output)


# Reads the words out of the PDF.
def extract_text(pdf_bytes):
    lines = []
    for match in re.finditer(br"stream\r?\n", pdf_bytes):
        end = pdf_bytes.find(b"endstream", match.end())
        if end == -1:
            continue
        dictionary = pdf_bytes[max(0, match.start() - 500):match.start()]
        try:
            content = decode_stream(dictionary, pdf_bytes[match.end():end].strip(b"\r\n"))
        except Exception:
            continue
        if not isinstance(content, (bytes, bytearray)):
            continue
        for raw in re.findall(br"\((?:\\.|[^\\)])*\)\s*Tj", content):
            literal = raw.decode("latin1")
            text = unescape_pdf_string(literal[1:literal.rfind(")")])
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                lines.append(text)
    return lines


# Makes text safe to show on the web page.
def html_escape(value):
    return (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# Turns the PDF lines into a simple summary.
def to_html(lines):
    if not lines:
        return "<p>This file is ready. No selectable text was found to summarize.</p>"
    title = lines[0]
    body = " ".join(lines[1:])
    body = re.sub(r"\s*Page \d+ of \d+\s*", " ", body).strip()
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", body) if sentence.strip()]
    parts = [f"<h3>{html_escape(title)}</h3>"]
    paragraph = []
    for sentence in sentences:
        paragraph.append(html_escape(sentence))
        if len(paragraph) == 3:
            parts.append("<p>" + " ".join(paragraph) + "</p>")
            paragraph = []
    if paragraph:
        parts.append("<p>" + " ".join(paragraph) + "</p>")
    return "\n".join(parts)


# Builds the summary and prints it for the app to save.
def main():
    if len(sys.argv) < 2:
        print("missing filename", file=sys.stderr)
        return 1
    stem = sys.argv[1]
    if stem.endswith(".pdf"):
        stem = stem[:-4]
    from storage_paths import UPLOADS
    pdf_path = UPLOADS / f"{stem}.pdf"
    if not pdf_path.is_file():
        print(f"missing pdf {pdf_path}", file=sys.stderr)
        return 1
    print(to_html(extract_text(pdf_path.read_bytes())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
