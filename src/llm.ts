/**
 * Talking to a local language model, for character conversations.
 *
 * Three ways to run one, chosen in the AI settings:
 *  - 'server': a model server on this computer with an OpenAI-style API
 *    (Ollama at http://localhost:11434/v1, LM Studio at http://localhost:1234/v1, llama.cpp...).
 *  - 'browser': WebLLM, running the model inside the browser on the GPU (WebGPU).
 *    The model is downloaded once and cached by the browser.
 *  - 'none': no model; characters answer with written lines.
 *
 * Nothing is ever sent anywhere but the user's own machine.
 */

export type Backend = 'none' | 'server' | 'browser';

export interface LLMSettings {
  backend: Backend;
  /** Base URL of the OpenAI-compatible server, e.g. http://localhost:11434/v1 */
  url: string;
  /** Model name on the server, e.g. llama3.2 or qwen2.5:3b */
  model: string;
  /** WebLLM model id. */
  browserModel: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const BROWSER_MODELS: { id: string; label: string }[] = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B (about 1 GB, quick)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (about 2 GB, better)' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B (about 2 GB, better)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (under 1 GB, fastest)' },
];

const KEY = 'swarajya-llm';
const DEFAULTS: LLMSettings = {
  backend: 'none', url: 'http://localhost:11434/v1', model: 'llama3.2', browserModel: BROWSER_MODELS[0].id,
};

export function loadSettings(): LLMSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: LLMSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private browsing: settings last for this session only
  }
  settings = s;
  if (s.backend !== 'browser' || s.browserModel !== loadedModel) {
    void webllm?.unload?.();
    webllm = null;
    loadedModel = '';
  }
}

let settings = loadSettings();
export const llmSettings = () => settings;

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

// ---------------------------------------------------------------- in-browser (WebLLM)

interface WebLLMEngine {
  chat: { completions: { create(req: unknown): Promise<AsyncIterable<{ choices: { delta: { content?: string } }[] }>> } };
  unload?(): Promise<void>;
}
let webllm: WebLLMEngine | null = null;
let loadedModel = '';
let loading: Promise<WebLLMEngine> | null = null;

/** Loads (downloading the first time) the in-browser model. Reports progress 0..1 with a note. */
export function loadBrowserModel(onProgress: (frac: number, note: string) => void): Promise<WebLLMEngine> {
  if (webllm && loadedModel === settings.browserModel) return Promise.resolve(webllm);
  if (loading) return loading;
  const id = settings.browserModel;
  loading = import('@mlc-ai/web-llm').then(async (m) => {
    const engine = await m.CreateMLCEngine(id, {
      initProgressCallback: (r: { progress: number; text: string }) => onProgress(r.progress, r.text),
    });
    webllm = engine as unknown as WebLLMEngine;
    loadedModel = id;
    return webllm;
  }).finally(() => {
    loading = null;
  });
  return loading;
}

export const browserModelReady = () => !!webllm && loadedModel === settings.browserModel;

// ---------------------------------------------------------------- one call for all backends

/**
 * Sends a conversation to the model and streams the reply. Returns the full text.
 * Throws a readable Error when the model can't be reached.
 */
export async function chat(messages: ChatMessage[], onToken?: (soFar: string) => void, signal?: AbortSignal): Promise<string> {
  const s = settings;
  if (s.backend === 'browser') {
    const engine = await loadBrowserModel(() => {});
    const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.8, max_tokens: 220 });
    let text = '';
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      text += chunk.choices[0]?.delta?.content ?? '';
      onToken?.(text);
    }
    return text;
  }
  if (s.backend === 'server') {
    let res: Response;
    try {
      res = await fetch(`${s.url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: s.model, messages, stream: true, temperature: 0.8, max_tokens: 220 }),
        signal,
      });
    } catch {
      throw new Error(`Couldn't reach the model server at ${s.url}. Is it running, and does it allow this page? (For Ollama, start it with OLLAMA_ORIGINS="*".)`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`The model server answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}. Check the model name ("${s.model}").`);
    }
    // Server-sent events: lines of "data: {json}".
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          text += j.choices?.[0]?.delta?.content ?? '';
          onToken?.(text);
        } catch {
          // a partial line; the rest arrives in the next chunk
        }
      }
    }
    return text;
  }
  throw new Error('No language model is set up.');
}

/** A quick check that the configured backend answers. */
export async function testConnection(): Promise<string> {
  const reply = await chat([
    { role: 'system', content: 'Reply with one short sentence.' },
    { role: 'user', content: 'Say hello as a Maratha herald in 1670.' },
  ]);
  // Drop the opinion line the characters are asked for, if the model added one here too.
  return reply.replace(/\n?\s*OPINION\s*[:=].*$/is, '').trim() || '(an empty reply)';
}
