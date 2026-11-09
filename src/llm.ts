/**
 * Talking to a local language model, for character conversations.
 *
 * Three ways to run one, chosen in the AI settings:
 *  - 'server': a model server on this computer with an OpenAI-style API
 *    (Ollama at http://localhost:11434/v1, LM Studio at http://localhost:1234/v1, llama.cpp...).
 *  - 'browser': WebLLM, running the model inside the browser on the GPU (WebGPU).
 *    The model is downloaded once and cached by the browser.
 *  - 'chrome': the AI built into Chrome (Gemini Nano, the Prompt API): nothing to install.
 *  - 'none': no model; characters answer with written lines.
 *
 * Nothing is ever sent anywhere but the user's own machine.
 */

export type Backend = 'none' | 'server' | 'browser' | 'chrome';

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
    const saved = localStorage.getItem(KEY);
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch {
    // no storage: fall through
  }
  // First time: if the browser has an AI built in, the characters use it from the start.
  return { ...DEFAULTS, backend: chromeAI() ? 'chrome' : 'none' };
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

// ---------------------------------------------------------------- Chrome's built-in AI (Prompt API)

interface ChromeLM {
  availability(opts?: unknown): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts: unknown): Promise<{ promptStreaming(input: string, opts?: unknown): AsyncIterable<string>; destroy(): void }>;
}
// A function declaration (hoisted), since the settings are loaded before this line runs.
function chromeAI(): ChromeLM | null {
  return (globalThis as unknown as { LanguageModel?: ChromeLM }).LanguageModel ?? null;
}

/** Is Chrome's built-in model usable here (or downloadable by Chrome itself)? */
export async function chromeAIStatus(): Promise<string> {
  const lm = chromeAI();
  if (!lm) return 'unavailable';
  try {
    return await lm.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  } catch {
    return 'unavailable';
  }
}

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
  if (s.backend === 'chrome') {
    const lm = chromeAI();
    if (!lm) throw new Error("This browser has no built-in AI. Choose another kind in the AI settings.");
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const rest = messages.filter((m) => m.role !== 'system');
    const last = rest.pop();
    const session = await lm.create({
      initialPrompts: [{ role: 'system', content: system }, ...rest],
      expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
      signal,
    });
    try {
      let text = '';
      for await (const chunk of session.promptStreaming(last?.content ?? '', { signal })) {
        // Older Chrome streams the whole text so far; newer streams pieces.
        text = chunk.startsWith(text) ? chunk : text + chunk;
        onToken?.(text);
      }
      return text;
    } finally {
      session.destroy();
    }
  }
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

// ---------------------------------------------------------------- one-click setup

/**
 * Finds a way to run a model on this computer, in order: Chrome's built-in AI; a model server
 * already running (Ollama on 11434, LM Studio on 1234), choosing a model it has; else, with
 * WebGPU, the in-browser model (after `confirmDownload` agrees). Saves and returns the choice,
 * or throws an Error that explains what to install.
 */
export async function autoSetup(note: (msg: string) => void, confirmDownload: (what: string) => Promise<boolean>): Promise<LLMSettings> {
  const cur = loadSettings();
  note("Looking for Chrome's built-in AI…");
  const c = await chromeAIStatus();
  const useChrome = c === 'available' || c === 'downloading'
    || (c === 'downloadable' && await confirmDownload("Chrome has an AI built in, but must download its model first (once, about 2 GB, done by Chrome itself). Download it now?"));
  if (useChrome) {
    if (c !== 'available') {
      // Starting the download needs this click; Chrome then fetches the model in the background.
      note("Chrome is downloading its built-in AI model…");
      try {
        const session = await chromeAI()!.create({
          expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
          monitor(m: EventTarget) {
            m.addEventListener('downloadprogress', (e) => note(`Chrome is downloading its built-in AI model: ${Math.round(((e as unknown as { loaded: number }).loaded ?? 0) * 100)}%`));
          },
        });
        session.destroy();
      } catch (e) {
        note(`Chrome could not prepare its AI (${(e as Error).message}). Looking for other options…`);
      }
    }
    if (await chromeAIStatus() !== 'unavailable') {
      const s = { ...cur, backend: 'chrome' as Backend };
      saveSettings(s);
      return s;
    }
  }
  note('Looking for a model server on this computer (Ollama, LM Studio)…');
  for (const base of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://localhost:1234']) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 1500);
      const res = await fetch(`${base}/v1/models`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const ids: string[] = ((await res.json()).data ?? []).map((m: { id: string }) => m.id);
      if (!ids.length) {
        note(`Found a model server at ${base}, but it has no models. Run "ollama pull llama3.2" first.`);
        continue;
      }
      const prefer = ['llama3.2', 'llama3.1', 'qwen2.5', 'gemma', 'mistral', 'phi'];
      const model = prefer.map((p) => ids.find((i) => i.toLowerCase().includes(p))).find(Boolean) ?? ids[0];
      const s = { ...cur, backend: 'server' as Backend, url: `${base}/v1`, model };
      saveSettings(s);
      return s;
    } catch {
      // nothing there (or the browser blocked it): try the next
    }
  }
  if (hasWebGPU() && await confirmDownload('No AI was found on this computer, but this browser can run one itself. Download a small model now (about 1 GB, once; it is cached afterwards)?')) {
    const s = { ...cur, backend: 'browser' as Backend };
    saveSettings(s);
    return s;
  }
  throw new Error('No AI found on this computer. The easiest way: install Ollama (ollama.com), run "ollama pull llama3.2", start it with OLLAMA_ORIGINS="*" ollama serve, then press Turn on AI again. Or use a recent Chrome or Edge, which can run a model inside the browser.');
}
