import { bar, h, hideModal, showModal, swatch } from '../ui';
import {
  BROWSER_MODELS, browserModelReady, chat, type ChatMessage, hasWebGPU, llmSettings, loadBrowserModel, type LLMSettings,
  saveSettings, testConnection,
} from '../llm';
import {
  actionsFor, applyDelta, attitude, attitudeWord, meName, parseReply, persona, personaWords, playerTitle, remember, resolveAction,
  greeting, intentFromText, scriptedDecision, scriptedReply, systemPrompt, type Talk, type TalkKind, topicAnswer, topicsFor,
} from './characters';
import { chronicle, type ChronKind } from './chronicle';
import { understand } from './dialogue';
import { type Army, type GameState, type General, generalRank, PLAYER, provinceUnder, RANK_NAMES, TRAITS, unitsMen } from './state';

/**
 * The conversation window: the character's portrait line and mood, the
 * exchange so far, a box to say anything, and buttons for formal proposals.
 * Replies stream in from the local language model (or written lines without one).
 */
export function openTalk(s: GameState, kind: TalkKind, gen: General, faction: number, army: Army | null, mine: Army | null, onChange: () => void): Promise<Talk> {
  const t: Talk = { kind, gen, faction, army, mine, history: [], gained: 0, outcomes: [], settled: false, fight: false };
  const f = s.factions[faction];
  const ai = llmSettings().backend !== 'none';
  return new Promise((resolve) => {
    const logEl = h('div', { class: 'talk-log' });
    const moodEl = h('div', {});
    const statusEl = h('div', { class: 'muted talk-status' });
    const input = h('input', { type: 'text', class: 'talk-input', placeholder: ai ? `Speak to ${gen.name}…` : `Speak to ${gen.name}… (set lines: no AI set up)`, maxlength: '300' }) as HTMLInputElement;
    const send = h('button', { class: 'primary small' }, 'Say') as HTMLButtonElement;
    const actionsEl = h('div', { class: 'btns' });
    const topicsEl = h('div', { class: 'btns talk-topics' });
    let busy = false;
    let closed = false;
    const ctrl = new AbortController();

    const line = (who: 'me' | 'them' | 'note', text: string) => {
      const el = h('div', { class: `talk-line ${who}` },
        who === 'note' ? null : h('b', {}, who === 'me' ? `${meName(s)}: ` : `${gen.name}: `), h('span', {}, text));
      logEl.append(el);
      logEl.scrollTop = logEl.scrollHeight;
      return el.lastChild as HTMLElement;
    };
    const refreshMood = () => {
      const a = attitude(s, t);
      moodEl.replaceChildren(
        h('div', { class: 'row muted' }, h('span', {}, `Mood: ${attitudeWord(a)}`), h('span', {}, `Opinion of you ${a > 0 ? '+' : ''}${Math.round(a)}`)),
        bar((a + 100) / 200, a > 15 ? '#8fd16b' : a > -15 ? '#e8c14a' : '#e3604f'),
      );
    };
    const setBusy = (b: boolean) => {
      busy = b;
      input.disabled = b || closed;
      send.disabled = b || closed;
      for (const btn of actionsEl.querySelectorAll('button')) (btn as HTMLButtonElement).disabled = b || closed;
    };
    const renderActions = () => {
      actionsEl.replaceChildren(...actionsFor(s, t).map((act) => h('button', {
        class: 'small', title: act.help, onclick: () => void propose(act.id, act.label),
      }, act.label)));
    };

    /** Asks the character to speak (model or set lines); returns the speech. */
    const speak = async (userText: string, scripted: () => string, scoreIt: boolean): Promise<string> => {
      const span = line('them', '…');
      if (!ai) {
        const said = scripted();
        span.textContent = said;
        t.history.push({ role: 'user', content: userText }, { role: 'assistant', content: said });
        return said;
      }
      try {
        if (llmSettings().backend === 'browser' && !browserModelReady()) {
          statusEl.textContent = 'Loading the in-browser model (the first time it downloads; later it starts from the cache)…';
          await loadBrowserModel((p, note) => {
            statusEl.textContent = `Loading model: ${Math.round(p * 100)}% · ${note.slice(0, 80)}`;
          });
          statusEl.textContent = '';
        }
        const msgs: ChatMessage[] = [{ role: 'system', content: systemPrompt(s, t) }, ...t.history, { role: 'user', content: userText }];
        const full = await chat(msgs, (so) => {
          span.textContent = parseReply(so).say;
          logEl.scrollTop = logEl.scrollHeight;
        }, ctrl.signal);
        const { say, delta } = parseReply(full);
        span.textContent = say;
        t.history.push({ role: 'user', content: userText }, { role: 'assistant', content: say });
        if (scoreIt && delta) {
          const d = applyDelta(s, t, delta);
          if (d) line('note', d > 0 ? `${gen.name} thinks better of you.` : `${gen.name} thinks less of you.`);
        }
        return say;
      } catch (err) {
        statusEl.textContent = (err as Error).message;
        const said = scripted();
        span.textContent = said;
        return said;
      }
    };

    const say = async () => {
      const text = input.value.trim();
      if (!text || busy || closed) return;
      input.value = '';
      line('me', text);
      setBusy(true);
      let scored = 0;
      // Without a model, the written-dialogue engine reads what you said; with one, it still spots offers.
      const heard = understand(s, t, text);
      if (ai) t.pending = null;
      await speak(text, () => {
        scored = heard.delta;
        return heard.say;
      }, true);
      if (!ai && scored) {
        const d = applyDelta(s, t, scored);
        if (d) line('note', d > 0 ? `${gen.name} thinks better of you.` : `${gen.name} thinks less of you.`);
      }
      // Did you just make him an offer in plain words? Put it on the table.
      const act = heard.offer ?? intentFromText(s, t, text);
      if (act && !closed) {
        const chip = h('button', { class: 'small primary talk-chip', onclick: () => { chip.remove(); void propose(act.id, act.label); } }, `→ ${act.label}`);
        logEl.append(h('div', { class: 'talk-line note' }, chip));
        logEl.scrollTop = logEl.scrollHeight;
      }
      refreshMood();
      setBusy(false);
      input.focus();
    };

    const ask = async (topic: { id: string; ask: string }) => {
      if (busy || closed) return;
      line('me', topic.ask);
      setBusy(true);
      await speak(topic.ask, () => topicAnswer(s, t, topic.id), false);
      refreshMood();
      setBusy(false);
    };

    const propose = async (id: string, label: string) => {
      if (busy || closed) return;
      line('me', `(${label})`);
      setBusy(true);
      const r = resolveAction(s, t, id);
      if (r.text) line('note', r.text);
      if (r.accepted && r.text && id !== 'gift' && id !== 'share' && id !== 'royal-gift' && id !== 'challenge') {
        const where = t.army ? ` near ${s.provinces[provinceUnder(s, t.army, t.army.node)].name}` : '';
        const ck: ChronKind = id === 'surrender' ? 'capture' : id === 'men' || id === 'report' ? 'court' : 'diplomacy';
        const how = kind === 'parley' ? `At a parley${where}, ` : kind === 'audience' ? `As envoy to the ${f.short}, ` : kind === 'liege' ? 'Before the Raje at Raigad, ' : '';
        chronicle(s, ck, `${how}${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}`.replace(/^(.)/, (c) => c.toUpperCase()));
      }
      else if (!r.accepted) line('note', `Refused: ${r.brief.split('Reason: ')[1] ?? ''}.`);
      await speak(`[${meName(s)} formally proposes: ${label}.] ${r.brief} Voice this decision in character, in one or two sentences.`, () => scriptedDecision(t, r), false);
      onChange();
      refreshMood();
      renderActions();
      setBusy(false);
      if (r.ends) {
        closed = true;
        setBusy(true);
        line('note', t.settled ? 'The matter is settled.' : t.fight ? 'The talks are over.'
          : kind === 'counsel' ? `${gen.name} rides off to his army.` : kind === 'liege' ? 'The Raje dismisses you.' : 'The audience is at an end.');
      }
    };

    send.addEventListener('click', () => void say());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void say();
    });

    const g = gen;
    const header = h('div', { class: 'talk-head' },
      h('div', {}, swatch(f.color), h('b', {}, `${g.name}`), h('span', { class: 'muted' }, ` of the house of ${g.house}`)),
      h('div', { class: 'muted' }, kind === 'liege' ? `Raja of the ${f.name}, your liege` : kind === 'audience' ? `Sovereign of the ${f.name}` : faction === PLAYER ? `A commander of the Raje · ${RANK_NAMES[generalRank(g)]}${army ? ` · ${Math.round(unitsMen(army.units))} men` : ''}` : `Commander of the ${f.short}${army ? ` · ${Math.round(unitsMen(army.units))} men` : ''}`),
      h('div', { class: 'muted', style: 'font-size:12.5px' }, `${TRAITS[g.trait].name} · ${personaWords(g)}`),
      moodEl,
    );
    const body = h('div', { class: 'talk' },
      header, logEl,
      h('div', { class: 'talk-row' }, input, send),
      topicsEl,
      h('div', { class: 'muted', style: 'font-size:12.5px' }, 'Formal proposals (decided by the state of things and his opinion of you):'),
      actionsEl, statusEl,
    );
    const finish = () => {
      ctrl.abort();
      hideModal();
      remember(s, t);
      onChange();
      resolve(t);
    };
    showModal(kind === 'liege' ? `Before ${g.name} at Raigad` : kind === 'audience' ? `Audience with ${g.name}` : kind === 'parley' ? `Parley with ${g.name}` : `With ${g.name}`, body,
      [{ label: 'End the talk', primary: true, onClick: finish }], { wide: true });
    refreshMood();
    renderActions();
    topicsEl.replaceChildren(h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Ask:'),
      ...topicsFor(s, t).map((tp) => h('button', { class: 'small', onclick: () => void ask(tp) }, tp.label)));
    persona(g);
    // The opening: they greet you (or don't).
    setBusy(true);
    const me = meName(s);
    const opening = kind === 'audience'
      ? `[${playerTitle(s)} is received at your court as envoy of the Marathas.] Greet him in character.`
      : kind === 'parley' ? `[${me} rides out under a flag of truce to speak with you between the armies.] Greet him in character.`
        : kind === 'liege' ? `[${me}, one of your captains, comes before you at Raigad.] Greet him in character.`
          : `[${me}, a fellow captain of the Raje, rides into your camp.] Greet him in character.`;
    void speak(opening, () => greeting(s, t), false).then(() => {
      setBusy(false);
      input.focus();
    });
  });
}

/** Settings for the language model that voices the characters. */
export function openAISettings(onDone?: () => void) {
  const cur: LLMSettings = { ...llmSettings() };
  const gpu = hasWebGPU();
  const result = h('div', { class: 'muted', style: 'min-height:1.2em' });
  const radio = (v: LLMSettings['backend'], label: string, note: string, disabled = false) => h('label', { class: 'ai-opt' },
    h('input', { type: 'radio', name: 'backend', value: v, checked: cur.backend === v, disabled, onchange: () => { cur.backend = v; } }),
    h('b', {}, ` ${label}`), h('div', { class: 'muted', style: 'font-size:12.5px;margin-left:20px' }, note));
  const url = h('input', { type: 'text', value: cur.url, class: 'talk-input', oninput: (e: Event) => { cur.url = (e.target as HTMLInputElement).value; } });
  const model = h('input', { type: 'text', value: cur.model, class: 'talk-input', oninput: (e: Event) => { cur.model = (e.target as HTMLInputElement).value; } });
  const bm = h('select', { onchange: (e: Event) => { cur.browserModel = (e.target as HTMLSelectElement).value; } },
    ...BROWSER_MODELS.map((m) => h('option', { value: m.id, selected: m.id === cur.browserModel }, m.label)));
  showModal('Characters: AI settings', h('div', { class: 'stack' },
    h('p', {}, 'Commanders and rulers can answer you in their own words, voiced by a language model running on your own computer. Nothing is sent anywhere else.'),
    radio('none', 'No AI', 'Characters answer with written lines. Proposals still work.'),
    radio('server', 'Local model server (Ollama, LM Studio…)', 'Best quality. Runs a model on this computer.'),
    h('div', { style: 'margin-left:20px' },
      h('div', { class: 'muted' }, 'Server URL (OpenAI-style API):'), url,
      h('div', { class: 'muted' }, 'Model name:'), model,
      h('div', { class: 'muted', style: 'font-size:12px' },
        'Ollama: install it, run "ollama pull llama3.2", then start it with OLLAMA_ORIGINS="*" ollama serve, and use http://localhost:11434/v1. LM Studio: start its server (with CORS on) and use http://localhost:1234/v1.')),
    radio('browser', 'In the browser (WebLLM)', gpu ? 'No install: the model runs on your graphics card inside the browser. It downloads once (about 1–2 GB), then loads from the cache.' : 'Needs WebGPU, which this browser does not have (try a recent Chrome or Edge).', !gpu),
    h('div', { style: 'margin-left:20px' }, bm),
    result,
  ), [
    { label: 'Test', onClick: () => {
      saveSettings(cur);
      result.textContent = cur.backend === 'browser' ? 'Loading the model (this can take a while the first time)…' : 'Asking the model…';
      const go = cur.backend === 'browser'
        ? loadBrowserModel((p, note) => { result.textContent = `Loading: ${Math.round(p * 100)}% · ${note.slice(0, 70)}`; }).then(() => testConnection())
        : testConnection();
      go.then((r) => { result.textContent = `✓ ${r}`; }).catch((e) => { result.textContent = `✗ ${(e as Error).message}`; });
    } },
    { label: 'Save', primary: true, onClick: () => { saveSettings(cur); hideModal(); onDone?.(); } },
  ], { wide: true });
}
