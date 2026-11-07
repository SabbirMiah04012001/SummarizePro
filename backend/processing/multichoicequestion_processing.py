from __future__ import annotations
import sys
import random
import pandas as pd
from typing import Tuple
from vertexai.language_models import TextEmbeddingModel, TextGenerationModel

from storage_paths import EMBEDDINGS

file = sys.argv[1]
number = sys.argv[2]

pdf_data_sample = pd.read_pickle(str(EMBEDDINGS / f"{file}.pkl"))

generation_model = TextGenerationModel.from_pretrained("text-bison")
embedding_model = TextEmbeddingModel.from_pretrained("textembedding-gecko")

parameters = {
    "temperature": 1.0,  # Set temperature to 1.0 for moderate randomness in token selection
    "max_output_tokens": 2048,
    "top_p": 0.8,  # Use top-p sampling with a value of 0.8 for diversity in token selection
    "top_k": 40  # Set top-k to 40 for a balanced selection of tokens
}

# Asks the cloud writing service, and tries again if it is busy.
def text_generation_model_with_backoff(prompt):
    return generation_model.predict(prompt, **parameters).text

# Turns pieces of the PDF into searchable notes.
def embedding_model_with_backoff(text=[]):
    embeddings = embedding_model.get_embeddings(text)
    return [each.values for each in embeddings][0]

# Picks the parts of the PDF that can become quiz questions.
def get_summary_from_document(
    vector_store: pd.DataFrame, summary_length: int = 3
) -> Tuple[str, pd.DataFrame]:
    vector_store["importance_score"] = [random.random() for _ in range(len(vector_store))]
    top_chunks = vector_store.sort_values(by="importance_score", ascending=False)[
        :summary_length
    ]["chunks"].values
    summary = "\n".join(top_chunks)
    return summary

# Writes the multiple-choice quiz from those parts.
def generate_quiz(prompt: str, summary: str) -> str:
    response = text_generation_model_with_backoff(prompt=prompt)
    return response

summary = get_summary_from_document(pdf_data_sample, summary_length=3)

prompt = "Generate a random Multiple choice quiz from this PDF ("+number+" questions). format it as json object like: {Q1:Q:'question', A:'answer, B:'answer, C:'answer, D:'answer, CA:correct answer letter}\n Context:\n"+summary+"\n"
response = generate_quiz(prompt, summary)
print(response)
