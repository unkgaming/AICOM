import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if(!OPENAI_KEY) {
  console.error("Set OPENAI_API_KEY in .env");
  process.exit(1);
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body; // history optional
    // Simple OpenAI Chat Completion call (replace with your provider model)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // change if you prefer another model name
        messages: [
          ...(history || []),
          { role: "user", content: message }
        ],
        max_tokens: 400
      })
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "Sorry, no reply.";
    res.json({ reply: text, raw: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "chat failed", detail: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`Server listening ${port}`));
