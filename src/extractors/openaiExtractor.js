import { extractionSchema } from "./schema.js";
import { extractionPrompt } from "./prompt.js";

function getOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text) return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

export async function extractPdf(buffer, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the server.");

  const model = process.env.OPENAI_MODEL || "gpt-5.6";
  const base64 = buffer.toString("base64");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          {
            type: "input_file",
            filename: filename || "document.pdf",
            file_data: `data:application/pdf;base64,${base64}`,
            detail: "high"
          },
          { type: "input_text", text: extractionPrompt }
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "form_qc_extraction",
          strict: true,
          schema: extractionSchema
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Document extraction failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  const outputText = getOutputText(payload);
  if (!outputText) throw new Error("The extraction service returned no structured output.");

  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error("The extraction service returned invalid JSON.");
  }
}
