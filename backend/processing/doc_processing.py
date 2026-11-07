from __future__ import annotations
import sys
from tenacity import retry, stop_after_attempt, wait_random_exponential
from google.api_core.exceptions import InternalServerError, RetryError
from google.api_core.client_options import ClientOptions
from google.cloud.documentai_v1 import Document
from google.cloud import documentai, storage
from typing import Dict, List, Optional
import pandas as pd
import re
import textwrap
from vertexai.language_models import TextEmbeddingModel


from storage_paths import EMBEDDINGS, UPLOADS

file = sys.argv[1]

project_id = "summarizepro"
location = "us"
processor_id = "a7d60edf0e35ae07"
client_options = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")

# Set the GCS URI where you want to store the processed documents
gcs_output_uri = f"gs://sprobucket/output_{file}/"  # Must end with a trailing slash `/`

# Define the path to your large PDF file on GCS
gcs_input_uri = f"gs://sprobucket/{file}.pdf"  # Format: gs://bucket/directory/file.pdf

# Optional parameters
processor_version_id = None
input_mime_type = "application/pdf"
field_mask = "text"

# Set timeout for the operation
timeout = 10000  # Increase timeout if needed

# Sends the PDF to cloud storage so it can be read.
def upload_pdf_to_gcs(local_file_path: str, gcs_file_path: str):
    # Initialize the GCS client
    client = storage.Client()

    # Get the bucket
    bucket = client.bucket("sprobucket")
    # Create blob object with the destination path in GCS
    blob = bucket.blob(gcs_file_path)
    # Upload the file to GCS
    blob.upload_from_filename(local_file_path)

    print(f"File {local_file_path} uploaded to gs://sprobucket/{gcs_file_path}")

# Reads one PDF in the cloud and returns its layout.
def process_document(file_path: str) -> documentai.Document:
    client = documentai.DocumentProcessorServiceClient(client_options=client_options)

    # Read the file into memory
    with open(file_path, "rb") as image:
        image_content = image.read()

    # Load Binary Data into Document AI RawDocument Object
    raw_document = documentai.RawDocument(
        content=image_content, mime_type="application/pdf"
    )

    # Configure the process request
    request = documentai.ProcessRequest(name=f"projects/{project_id}/locations/{location}/processors/{processor_id}", raw_document=raw_document)

    result = client.process_document(request=request)

    return result.document

# Pulls the readable words out of one page layout.
def layout_to_text(layout: documentai.Document.Page.Layout, text: str) -> str:
    """
    Document AI identifies text in different parts of the document by their
    offsets in the entirety of the document"s text. This function converts
    offsets to a string.
    """
    # If a text segment spans several lines, it will
    # be stored in different text segments.
    return "".join(
        text[int(segment.start_index) : int(segment.end_index)]
        for segment in layout.text_anchor.text_segments
    )

# Reads a batch of PDF pages and collects their text.
def batch_process_documents(
    project_id: str,
    location: str,
    processor_id: str,
    gcs_output_uri: str,
    processor_version_id: Optional[str] = None,
    gcs_input_uri: Optional[str] = None,
    input_mime_type: Optional[str] = None,
    field_mask: Optional[str] = None,
    timeout: int = 400,
) -> None:
    opts = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")
    client = documentai.DocumentProcessorServiceClient(client_options=opts)

    # Define input documents
    gcs_document = documentai.GcsDocument(gcs_uri=gcs_input_uri, mime_type=input_mime_type)
    gcs_documents = documentai.GcsDocuments(documents=[gcs_document])
    input_config = documentai.BatchDocumentsInputConfig(gcs_documents=gcs_documents)

    # Define output configuration
    gcs_output_config = documentai.DocumentOutputConfig.GcsOutputConfig(
        gcs_uri=gcs_output_uri, field_mask=field_mask
    )
    output_config = documentai.DocumentOutputConfig(gcs_output_config=gcs_output_config)

    if processor_version_id:
        name = client.processor_version_path(
            project_id, location, processor_id, processor_version_id
        )
    else:
        name = client.processor_path(project_id, location, processor_id)

    request = documentai.BatchProcessRequest(
        name=name,
        input_documents=input_config,
        document_output_config=output_config,
    )

    try:
        print("Initiating batch processing...")
        operation = client.batch_process_documents(request)
        operation.result(timeout=timeout)
        print("Batch processing completed.")
    except (RetryError, InternalServerError) as e:
        print(f"Error during batch processing: {e}")

    aggregated_text = []

    # Retrieve output documents
    storage_client = storage.Client()
    for process in operation.metadata.individual_process_statuses:
        output_bucket, output_prefix = process.output_gcs_destination.split("gs://")[1].split("/", 1)
        output_blobs = storage_client.list_blobs(output_bucket, prefix=output_prefix)
        for blob in output_blobs:
            if blob.content_type == "application/json":
                # Download JSON file and process each chunk
                json_bytes = blob.download_as_bytes()
                document = Document.from_json(json_bytes, ignore_unknown_fields=True)
                aggregated_text.append(document.text)

    return aggregated_text

# Removes temporary cloud files after the PDF has been read.
# Removes temporary cloud files after the PDF has been read.
def delete_files_in_bucket(bucket_name: str, prefix: str):
    """Deletes files in a Google Cloud Storage bucket with the given prefix."""
    storage_client = storage.Client()
    bucket = storage_client.get_bucket(bucket_name)
    blobs = bucket.list_blobs(prefix=prefix)
    for blob in blobs:
        blob.delete()
        print(f"Deleted {blob.name}.")

#call the function to upload the PDF file to GCS
upload_pdf_to_gcs(str(UPLOADS / f"{file}.pdf"), f"{file}.pdf")

#process PDF
document_chunks = text=batch_process_documents(
    project_id,
    location,
    processor_id,
    gcs_output_uri,
    processor_version_id,
    gcs_input_uri,
    input_mime_type,
    field_mask,
    timeout,
)

# Call the function to delete the files in the bucket
delete_files_in_bucket("sprobucket", f"output_{file}/")
delete_files_in_bucket("sprobucket", f"{file}")

extracted_data: List[Dict] = []

# Loop through each chunk and create a dictionary with metadata and content.
for chunk_number, chunk_content in enumerate(document_chunks, start=1):
    # Append the chunk information to the extracted_data list.
    extracted_data.append(
        {
            "file_name": "test.pdf",
            "chunk_number": chunk_number,
            "content": chunk_content,
        }
    )

print(extracted_data)
pdf_data = (
    pd.DataFrame.from_dict(extracted_data)
    .sort_values(by=["file_name"])
    .reset_index(drop=True)
)

pdf_data.head()

# Define the maximum number of characters in each chunk.
chunk_size = 5000

pdf_data_sample = pdf_data.copy()

# Remove all non-alphabets and numbers from the data to clean it up.
# This is harsh cleaning. You can define your custom logic for cleansing here.
pdf_data_sample["content"] = pdf_data_sample["content"].apply(
    lambda x: re.sub("[^A-Za-z0-9]+", " ", x)
)

# Apply chunk splitting logic to each row of content in the DataFrame.
pdf_data_sample["chunks"] = pdf_data_sample["content"].apply(
    lambda row: textwrap.wrap(row, width=chunk_size)
)

# Now, each row in 'chunks' contains list of all chunks and hence we need to explode them into individual rows.
pdf_data_sample = pdf_data_sample.explode("chunks")

# Sort and reset index
pdf_data_sample = pdf_data_sample.sort_values(by=["file_name"]).reset_index(drop=True)
pdf_data_sample.head()

print("The original dataframe has :", pdf_data.shape[0], " rows without chunking")
print("The chunked dataframe has :", pdf_data_sample.shape[0], " rows with chunking")

embedding_model = TextEmbeddingModel.from_pretrained("textembedding-gecko")

# This decorator is used to handle exceptions and apply exponential backoff in case of ResourceExhausted errors.
# It means the function will be retried with increasing time intervals in case of this specific exception.
@retry(wait=wait_random_exponential(min=10, max=120), stop=stop_after_attempt(5))
# Turns the PDF text into searchable notes.
def embedding_model_with_backoff(text=[]):
    embeddings = embedding_model.get_embeddings(text)
    return [each.values for each in embeddings][0]

pdf_data_sample = pdf_data_sample.dropna(subset=['chunks'])

pdf_data_sample["embedding"] = pdf_data_sample["chunks"].apply(
    lambda x: embedding_model_with_backoff([x])
)
print(pdf_data_sample["embedding"])
pdf_data_sample.head(2)


# Save embeddings to a Numpy binary file
EMBEDDINGS.mkdir(parents=True, exist_ok=True)
pdf_data_sample.to_pickle(str(EMBEDDINGS / f"{file}.pkl"))

print("Embeddings saved successfully.")