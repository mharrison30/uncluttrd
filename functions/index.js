const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { toFile } = require("openai/uploads");

const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");

exports.analyzePhoto = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10 },
  async (request) => {
    const { imageBase64, prompt } = request.data || {};

    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing image or prompt.");
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const text = message.content.find((b) => b.type === "text")?.text || "";
      return { text };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Analysis failed.");
    }
  }
);

exports.generateNextAction = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10 },
  async (request) => {
    const { beforeImageBase64, afterImageBase64, prompt } = request.data || {};

    if (!beforeImageBase64 || !afterImageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing before/after image or prompt.");
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: beforeImageBase64,
                },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: afterImageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const text = message.content.find((b) => b.type === "text")?.text || "";
      return { text };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Next action generation failed.");
    }
  }
);

exports.generateVisualization = onCall(
  { secrets: [OPENAI_KEY], maxInstances: 10, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const { imageBase64, prompt } = request.data || {};

    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing image or prompt.");
    }

    const openai = new OpenAI({ apiKey: OPENAI_KEY.value() });

    try {
      const imageBuffer = Buffer.from(imageBase64, "base64");
      const imageFile = await toFile(imageBuffer, "photo.png", {
        type: "image/png",
      });

      const result = await openai.images.edit({
        model: "gpt-image-2",
        image: imageFile,
        prompt: prompt,
        size: "1024x1024",
        quality: "low",
      });

      const b64 = result.data?.[0]?.b64_json || "";
      return { b64 };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Visualization failed.");
    }
  }
);
