/**
 * Model providers.
 *
 * The assistant was hardwired to Gemini for one reason — it has a free tier — but that is
 * a pricing accident, not an architectural one. The analyst only ever needs "send a system
 * prompt and a question, get text back", which every provider supports. Locking users to
 * one vendor also undercuts the point of bring-your-own-key: people who already pay for
 * OpenAI or Anthropic, or who run a local model for privacy, should not be told to go
 * create a Google account.
 *
 * "OpenAI-compatible" is deliberately included because it covers OpenRouter, Groq,
 * Together, DeepSeek, vLLM, LM Studio and Ollama in a single option.
 */
export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'compatible';

export type AIConfig = {
  provider: ProviderId;
  apiKey: string;
  model: string;
  /** Only used by the OpenAI-compatible option. */
  baseUrl?: string;
};

export const PROVIDERS: {
  id: ProviderId;
  label: string;
  defaultModel: string;
  keyUrl?: string;
  keyHint: string;
  needsBaseUrl?: boolean;
  note?: string;
}[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'Free tier available',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Paid, usually a fraction of a rupee per question',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-haiku-latest',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Paid',
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible / local',
    defaultModel: 'llama-3.3-70b-versatile',
    keyHint: 'OpenRouter, Groq, Together, Ollama, LM Studio, vLLM…',
    needsBaseUrl: true,
    note: 'A local model keeps everything on your machine. Point this at its base URL, e.g. http://localhost:11434/v1',
  },
];

function extractJsonBlock(text: string): string {
  // Providers without a strict JSON mode often wrap output in a code fence.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

async function readError(res: Response, provider: string) {
  const body = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    return `${provider} rejected that key. Check it is valid and has access to this model.`;
  }
  if (res.status === 429) {
    return `${provider} rate limit reached on your key. Wait a moment and retry.`;
  }
  if (res.status === 404) {
    return `${provider} does not recognise that model name. Check the model field.`;
  }
  return `${provider} returned HTTP ${res.status}. ${body.slice(0, 200)}`;
}

/** Send one prompt and return the model's text. `json` requests machine-readable output. */
export async function callModel(
  cfg: AIConfig,
  system: string,
  user: string,
  json: boolean,
): Promise<string> {
  const model = cfg.model.trim();

  if (cfg.provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: user }] }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: json ? { response_mime_type: 'application/json' } : {},
        }),
      },
    );
    if (!res.ok) throw new Error(await readError(res, 'Gemini'));
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('The model returned an empty response.');
    return json ? extractJsonBlock(text) : text;
  }

  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        // Anthropic blocks browser calls unless this opt-in is present.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: json ? `${system}\n\nRespond with raw JSON only. No prose, no code fences.` : system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Anthropic'));
    const j = await res.json();
    const text = j?.content?.[0]?.text;
    if (!text) throw new Error('The model returned an empty response.');
    return json ? extractJsonBlock(text) : text;
  }

  // OpenAI and anything speaking its chat-completions dialect.
  const base = (cfg.provider === 'openai' ? 'https://api.openai.com/v1' : cfg.baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('Set the API base URL for this provider.');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: json ? `${system}\n\nRespond with raw JSON only.` : system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    // Local and smaller servers often reject response_format; retry without it rather
    // than telling the user their setup is broken.
    if (json && (res.status === 400 || res.status === 422)) {
      const retry = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `${system}\n\nRespond with raw JSON only. No prose, no code fences.` },
            { role: 'user', content: user },
          ],
        }),
      });
      if (retry.ok) {
        const rj = await retry.json();
        return extractJsonBlock(rj?.choices?.[0]?.message?.content ?? '');
      }
    }
    throw new Error(await readError(res, cfg.provider === 'openai' ? 'OpenAI' : 'The API'));
  }
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty response.');
  return json ? extractJsonBlock(text) : text;
}
