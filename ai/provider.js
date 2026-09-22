const { buildSupportContext } = require('./supportContext');
const { buildSystemPrompt } = require('./systemPrompt');
const { fallbackReply } = require('./fallback');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_CONTEXT_PRODUCTS = 40;
const MAX_REPLY_TOKENS = 300;
const TIMEOUT_MS = 15000;

function isConfigured() {
  return Boolean(process.env.AI_API_KEY);
}

function createTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { controller, timer };
}

async function generateSupportReply({ messages, context } = {}) {
  if (!isConfigured()) {
    const supportContext = context || await buildSupportContext();
    const lastUserMessage = Array.isArray(messages)
      ? [...messages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string')
      : null;
    return {
      ok: true,
      reply: fallbackReply(lastUserMessage?.content || '', supportContext),
      mode: 'deterministic'
    };
  }

  try {
    const supportContext = context || await buildSupportContext();
    const system = buildSystemPrompt(supportContext);

    const normalizedMessages = Array.isArray(messages)
      ? messages
          .filter(m => m && typeof m === 'object')
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .filter(m => typeof m.content === 'string')
          .map(m => ({
            role: m.role,
            content: m.content.slice(0, 1000)
          }))
      : [];

    const { controller, timer } = createTimeout();

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.AI_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            ...normalizedMessages
          ],
          max_tokens: MAX_REPLY_TOKENS,
          temperature: 0.2
        })
      });

      if (!response.ok) {
        return {
          ok: false,
          code: 'AI_PROVIDER_ERROR'
        };
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content;

      if (typeof reply !== 'string' || !reply.trim()) {
        return {
          ok: false,
          code: 'AI_INVALID_RESPONSE'
        };
      }

      return {
        ok: true,
        reply: reply.trim()
      };
    } catch (error) {
      return {
        ok: false,
        code: error?.name === 'AbortError'
          ? 'AI_PROVIDER_ERROR'
          : 'AI_PROVIDER_ERROR'
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      code: 'AI_PROVIDER_ERROR'
    };
  }
}

module.exports = {
  isConfigured,
  generateSupportReply,
  MAX_CONTEXT_PRODUCTS,
  MAX_REPLY_TOKENS,
  TIMEOUT_MS
};
