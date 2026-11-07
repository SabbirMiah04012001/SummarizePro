from __future__ import annotations
import sys
from tenacity import retry, stop_after_attempt, wait_random_exponential
import numpy as np
import pandas as pd
from typing import Tuple
from vertexai.language_models import TextEmbeddingModel, TextGenerationModel

from storage_paths import EMBEDDINGS

file = sys.argv[1]
question = sys.argv[2]

pdf_data_sample = pd.read_pickle(str(EMBEDDINGS / f"{file}.pkl"))

generation_model = TextGenerationModel.from_pretrained("text-bison")
embedding_model = TextEmbeddingModel.from_pretrained("textembedding-gecko")

parameters = {
    "temperature": 1.0,  # Set temperature to 1.0 for moderate randomness in token selection
    "max_output_tokens": 2048,
    "top_p": 0.8,  # Use top-p sampling with a value of 0.8 for diversity in token selection
    "top_k": 40  # Set top-k to 40 for a balanced selection of tokens
}

# This decorator is used to handle exceptions and apply exponential backoff in case of ResourceExhausted errors.
# It means the function will be retried with increasing time intervals in case of this specific exception.
@retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(5))
# Asks the cloud writing service, and tries again if it is busy.
def text_generation_model_with_backoff(prompt):
    return generation_model.predict(prompt, **parameters).text


@retry(wait=wait_random_exponential(min=10, max=120), stop=stop_after_attempt(5))
# Turns pieces of the PDF into searchable notes.
def embedding_model_with_backoff(text=[]):
    embeddings = embedding_model.get_embeddings(text)
    return [each.values for each in embeddings][0]

# Finds the part of the PDF that answers the reader's question.
def get_context_from_question(
    question: str, vector_store: pd.DataFrame, sort_index_value: int = 2
) -> Tuple[str, pd.DataFrame]:
    query_vector = np.array(embedding_model_with_backoff([question]))
    vector_store["dot_product"] = vector_store["embedding"].apply(
        lambda row: np.dot(row, query_vector)
    )
    top_matched = vector_store.sort_values(by="dot_product", ascending=False)[
        :sort_index_value
    ].index
    top_matched_df = vector_store.loc[top_matched, ["file_name", "chunks"]]
    context = "\n".join(top_matched_df["chunks"].values)
    return context, top_matched_df

# get the custom relevant chunks from all the chunks in vector store.
context, top_matched_df = get_context_from_question(
    question,
    vector_store=pdf_data_sample,
    sort_index_value=2,  # Top N results to pick from embedding vector search
)
# top 5 data that has been picked by model based on user question. This becomes the context.
top_matched_df

# Prompt for Q&A which takes the custom context found in last step.
prompt = f"""
          Predefined:\n
          You're a friendly, and concise chatbot.\n
          You format your responses using HTML tags (assume it is inside of a div) for better readability.\n
          If a prompt does not make sense, you let it be known in your response.
          You refer to chat history for more context when needed.\n
          Context: \n {context}?\n
          {question} \n
          Response:
        """
# Call the PaLM API on the prompt.
print(text_generation_model_with_backoff(prompt).replace("```html", "").replace("```", ""))