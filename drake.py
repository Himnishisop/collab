from flask import Flask, request, jsonify
from openai import OpenAI
import os

app = Flask(__name__)

client = OpenAI(
    api_key=os.environ.get("ddc-a4f-c964629239ac4b1eba7b5a8a57e94a38"),
    base_url="https://api.a4f.co/v1"
)

MODEL_NAME = "provider-6/gpt-oss-20b"

@app.route("/")
def home():
    return "Drake Assistant Backend Running 🔥"

@app.route("/ask", methods=["POST"])
def ask():
    data = request.json
    user_message = data.get("message")

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": user_message}
        ]
    )

    reply = response.choices[0].message.content.strip()
    return jsonify({"reply": reply})
