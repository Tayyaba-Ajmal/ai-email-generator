/* =========================================================
   T's — AI Email Assistant
   ========================================================= */

(() => {
  'use strict';

  /* ---------------------------------------------------------
     STORAGE KEYS
  --------------------------------------------------------- */
  const LS_CHATS = 'ts_chats_v1';
  const LS_SETTINGS = 'ts_settings_v1';
  const LS_THEME = 'ts_theme_v1';

  /* ---------------------------------------------------------
     PROVIDER PRESETS
  --------------------------------------------------------- */
  const PROVIDER_PRESETS = {
    groq: {
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile'
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-4o-mini'
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini'
    },
    local: {
      baseUrl: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3.1'
    },
    custom: {
      baseUrl: '',
      model: ''
    }
  };

  function isLocalHost(url){
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url || '');
  }

  function isKeyConfigured(){
    return !!settings.apiKey;
  }

  /* ---------------------------------------------------------
     MODE CONFIG
  --------------------------------------------------------- */
  const MODES = {
    generate: {
      label: 'Generate',
      icon: 'bi-pencil-square',
      placeholder: 'Describe the email you need — recipient, purpose, key points…',
      needsOriginal: false,
      system: (ctx) => `You are T's, an elite professional email-writing assistant. Write a complete, ready-to-send email based on the user's brief.
Recipient/context: ${ctx.recipient || 'not specified'}.
Subject/topic: ${ctx.subject || 'infer from the brief'}.
Tone: ${ctx.tone}. Length: ${ctx.length}.
Rules: Include an appropriate subject line at the top prefixed with "Subject:". Write only the email itself — no preamble, no explanation, no markdown formatting, no quotation marks around it. Sound human, warm where appropriate, and precise. Sign off simply as "[Your name]" unless a sender name is given.`
    },
    reply: {
      label: 'Reply',
      icon: 'bi-reply',
      placeholder: 'What should the reply say? Paste the original email in Context below.',
      needsOriginal: true,
      system: (ctx) => `You are T's, an elite professional email-writing assistant. Write a reply to the original email provided below, based on the user's instructions.
Original email:
"""${ctx.original || '(not provided)'}"""
Recipient/context: ${ctx.recipient || 'infer from the original email'}.
Tone: ${ctx.tone}. Length: ${ctx.length}.
Rules: Include "Subject: Re: ..." at the top if a subject can be inferred. Write only the reply itself, no preamble or explanation, no markdown. Address the key points of the original email directly. Sign off as "[Your name]" unless given.`
    },
    improve: {
      label: 'Improve',
      icon: 'bi-stars',
      placeholder: 'Paste the email to improve in Context below, and describe anything specific to fix.',
      needsOriginal: true,
      system: (ctx) => `You are T's, an elite email-editing assistant. Improve the grammar, clarity, structure and professionalism of the following email while preserving its original intent and meaning.
Email to improve:
"""${ctx.original || '(not provided)'}"""
Target tone: ${ctx.tone}. Target length: ${ctx.length}.
Rules: Return only the improved email, no preamble, no explanation, no markdown, no commentary about what changed unless explicitly asked.`
    },
    rewrite: {
      label: 'Rewrite',
      icon: 'bi-arrow-repeat',
      placeholder: 'Paste the email to rewrite in Context below, and describe the desired style.',
      needsOriginal: true,
      system: (ctx) => `You are T's, an elite email-writing assistant. Rewrite the following email substantially, changing its tone and phrasing while keeping the core message and any facts intact.
Original email:
"""${ctx.original || '(not provided)'}"""
Target tone: ${ctx.tone}. Target length: ${ctx.length}.
Rules: Return only the rewritten email, no preamble, no explanation, no markdown.`
    },
    summarize: {
      label: 'Summarize',
      icon: 'bi-list-task',
      placeholder: 'Paste the email or thread to summarize in Context below.',
      needsOriginal: true,
      system: (ctx) => `You are T's, an assistant that summarizes email threads for busy professionals. Summarize the following email or thread into a short, skimmable summary.
Email/thread:
"""${ctx.original || '(not provided)'}"""
Rules: Use concise bullet points. Call out: key ask(s), decisions made, deadlines/dates, and required next actions with owners if named. Keep it under ${ctx.length === 'short' ? '80' : ctx.length === 'long' ? '220' : '140'} words. No preamble, no markdown headers — plain bullet lines starting with "•".`
    }
  };

  const SUGGESTIONS = [
    { mode: 'generate', icon: 'bi-briefcase', title: 'Cold outreach to a prospect', desc: 'Introduce your product to a potential client', prompt: 'Write a cold outreach email introducing our analytics platform to a VP of Marketing at a mid-size retail company. Focus on how it saves time on reporting.' },
    { mode: 'reply', icon: 'bi-hourglass-split', title: 'Firm but polite follow-up', desc: 'Nudge someone who has gone quiet', prompt: 'Write a firm but polite follow-up asking for a status update, since I have not heard back in two weeks.' },
    { mode: 'improve', icon: 'bi-stars', title: 'Polish a rushed draft', desc: 'Fix tone, grammar and structure', prompt: 'Clean this up and make it sound more professional and confident, without changing the meaning.' },
    { mode: 'generate', icon: 'bi-emoji-frown', title: 'Graceful decline', desc: 'Turn down a meeting or offer kindly', prompt: 'Write an email declining a meeting invitation gracefully, citing a scheduling conflict, and offering two alternative times next week.' }
  ];

  /* ---------------------------------------------------------
     STATE
  --------------------------------------------------------- */
  let chats = loadChats();
  let currentChatId = chats.length ? chats[0].id : null;
  let currentMode = 'generate';
  let settings = loadSettings();
  let isStreaming = false;

  /* ---------------------------------------------------------
     DOM REFS
  --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const chatScroll = $('#chatScroll');
  const messagesEl = $('#messages');
  const landingState = $('#landingState');
  const suggestionGrid = $('#suggestionGrid');
  const chatTitleEl = $('#chatTitle');
  const currentModePill = $('#currentModePill');

  const composerInput = $('#composerInput');
  const sendBtn = $('#sendBtn');
  const toneSelect = $('#toneSelect');
  const lengthSelect = $('#lengthSelect');
  const contextToggle = $('#contextToggle');
  const contextPanel = $('#contextPanel');
  const ctxRecipient = $('#ctxRecipient');
  const ctxSubject = $('#ctxSubject');
  const ctxOriginal = $('#ctxOriginal');

  const toastStack = $('#toastStack');

  /* ---------------------------------------------------------
     UTIL
  --------------------------------------------------------- */
  function uid(){ return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function loadChats(){
    try{
      const raw = localStorage.getItem(LS_CHATS);
      return raw ? JSON.parse(raw) : [];
    }catch(e){ return []; }
  }
  function saveChats(){
    try{ localStorage.setItem(LS_CHATS, JSON.stringify(chats)); }catch(e){}
  }
  function loadSettings(){
    const defaults = {
      provider: 'groq',
      baseUrl: PROVIDER_PRESETS.groq.baseUrl,
      model: PROVIDER_PRESETS.groq.model,
      apiKey: '',
      temperature: 0.7,
      maxTokens: 900
    };
    try{
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
    }catch(e){ return defaults; }
  }
  function saveSettings(){
    try{ localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }catch(e){}
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, type = 'ok'){
    const el = document.createElement('div');
    el.className = `toast-item${type === 'error' ? ' error' : ''}`;
    el.innerHTML = `<i class="bi ${type === 'error' ? 'bi-exclamation-triangle' : 'bi-check-circle'}"></i><span>${escapeHtml(message)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function autoResize(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }

  /* ---------------------------------------------------------
     CHAT MODEL HELPERS
  --------------------------------------------------------- */
  function getCurrentChat(){
    return chats.find(c => c.id === currentChatId) || null;
  }

  function createChat(mode){
    const chat = {
      id: uid(),
      title: 'Untitled draft',
      mode: mode || 'generate',
      createdAt: Date.now(),
      messages: []
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
    return chat;
  }

  function ensureChat(){
    let chat = getCurrentChat();
    if(!chat){ chat = createChat(currentMode); }
    return chat;
  }

  function deleteChat(id){
    chats = chats.filter(c => c.id !== id);
    saveChats();
    if(currentChatId === id){
      currentChatId = chats.length ? chats[0].id : null;
    }
    renderAll();
  }

  function clearAllChats(){
    chats = [];
    currentChatId = null;
    saveChats();
    renderAll();
  }

  function setChatTitleFromFirstMessage(chat, text){
    if(chat.title === 'Untitled draft'){
      const clean = text.trim().replace(/\s+/g, ' ');
      chat.title = clean.length > 42 ? clean.slice(0, 42) + '…' : (clean || 'Untitled draft');
    }
  }

  /* ---------------------------------------------------------
     RENDERING
  --------------------------------------------------------- */
  function renderAll(){
    renderSidebarHistory();
    renderModeActiveStates();
    renderChatArea();
  }

  function renderSidebarHistory(){
    const targets = [$('#historyList'), $('#historyListMobile')];
    targets.forEach(target => {
      if(!target) return;
      target.innerHTML = '';
      if(!chats.length){
        target.innerHTML = `<div class="history-empty">No drafts yet — start one above.</div>`;
        return;
      }
      chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `history-item${chat.id === currentChatId ? ' active' : ''}`;
        const modeIcon = MODES[chat.mode] ? MODES[chat.mode].icon : 'bi-envelope';
        item.innerHTML = `
          <i class="bi ${modeIcon} hist-icon"></i>
          <span class="hist-title">${escapeHtml(chat.title)}</span>
          <button class="hist-del" title="Delete draft"><i class="bi bi-x-lg"></i></button>
        `;
        item.addEventListener('click', (e) => {
          if(e.target.closest('.hist-del')) return;
          currentChatId = chat.id;
          currentMode = chat.mode;
          renderAll();
        });
        item.querySelector('.hist-del').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteChat(chat.id);
        });
        target.appendChild(item);
      });
    });
  }

  function renderModeActiveStates(){
    $$('.mode-item').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === currentMode));
    $$('.chip').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === currentMode));
    const mode = MODES[currentMode];
    currentModePill.innerHTML = `<i class="bi ${mode.icon}"></i> ${mode.label}`;
    composerInput.placeholder = mode.placeholder;
  }

  function renderChatArea(){
    const chat = getCurrentChat();
    messagesEl.innerHTML = '';

    if(!chat || !chat.messages.length){
      landingState.style.display = '';
      chatTitleEl.textContent = 'Untitled draft';
      renderSuggestions();
      return;
    }

    landingState.style.display = 'none';
    chatTitleEl.textContent = chat.title;

    chat.messages.forEach(msg => renderMessage(msg));
    scrollToBottom();
  }

  function renderSuggestions(){
    suggestionGrid.innerHTML = '';
    SUGGESTIONS.forEach(s => {
      const card = document.createElement('button');
      card.className = 'suggestion-card';
      card.innerHTML = `
        <div class="sc-icon"><i class="bi ${s.icon}"></i></div>
        <div class="sc-title">${escapeHtml(s.title)}</div>
        <div class="sc-desc">${escapeHtml(s.desc)}</div>
      `;
      card.addEventListener('click', () => {
        setMode(s.mode);
        composerInput.value = s.prompt;
        autoResize(composerInput);
        composerInput.focus();
      });
      suggestionGrid.appendChild(card);
    });
  }

  function renderMessage(msg){
    const wrap = document.createElement('div');
    wrap.className = `msg ${msg.role === 'user' ? 'user' : 'ai'}`;
    wrap.dataset.msgId = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = msg.role === 'user' ? '<i class="bi bi-person"></i>' : '<span>T</span>';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = new Date(msg.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if(msg.role === 'user'){
      meta.innerHTML = `<span class="msg-mode-tag">${MODES[msg.mode]?.label || 'Generate'}</span><span>${time}</span>`;
    } else {
      meta.innerHTML = `<span>T's</span><span>${time}</span>`;
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content;

    body.appendChild(meta);
    body.appendChild(bubble);

    if(msg.role === 'ai'){
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = `
        <button class="msg-action-btn act-copy"><i class="bi bi-clipboard"></i> Copy</button>
        <button class="msg-action-btn act-regen"><i class="bi bi-arrow-clockwise"></i> Regenerate</button>
      `;
      actions.querySelector('.act-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(msg.content).then(() => showToast('Email copied to clipboard'));
      });
      actions.querySelector('.act-regen').addEventListener('click', () => regenerateFrom(msg.id));
      body.appendChild(actions);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    return wrap;
  }

  function scrollToBottom(){
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
  }

  /* ---------------------------------------------------------
     MODE SWITCHING
  --------------------------------------------------------- */
  function setMode(mode){
    currentMode = mode;
    const chat = getCurrentChat();
    if(chat && !chat.messages.length){ chat.mode = mode; saveChats(); }
    renderModeActiveStates();
    if(MODES[mode].needsOriginal && !contextPanel.classList.contains('open')){
      toggleContextPanel(true);
    }
  }

  function toggleContextPanel(force){
    const open = typeof force === 'boolean' ? force : !contextPanel.classList.contains('open');
    contextPanel.classList.toggle('open', open);
    contextToggle.classList.toggle('active', open);
  }

  /* ---------------------------------------------------------
     SENDING / AI CALL
  --------------------------------------------------------- */
  async function handleSend(){
    if(isStreaming) return;
    const text = composerInput.value.trim();
    if(!text){ composerInput.focus(); return; }

    const localHost = isLocalHost(settings.baseUrl);
    if(!settings.baseUrl || !settings.model || (!isKeyConfigured() && !localHost)){
      showToast(localHost ? 'Set a model name in settings first' : 'Add your API key in settings before sending', 'error');
      const modal = bootstrap.Modal.getOrCreateInstance($('#settingsModal'));
      modal.show();
      return;
    }

    const chat = ensureChat();
    chat.mode = currentMode;

    const ctx = {
      tone: toneSelect.value,
      length: lengthSelect.value,
      recipient: ctxRecipient.value.trim(),
      subject: ctxSubject.value.trim(),
      original: ctxOriginal.value.trim()
    };

    const userMsg = {
      id: uid(),
      role: 'user',
      mode: currentMode,
      content: text,
      ts: Date.now()
    };
    chat.messages.push(userMsg);
    setChatTitleFromFirstMessage(chat, text);
    saveChats();

    landingState.style.display = 'none';
    chatTitleEl.textContent = chat.title;
    renderMessage(userMsg);
    renderSidebarHistory();
    scrollToBottom();

    composerInput.value = '';
    autoResize(composerInput);

    await streamAIResponse(chat, text, ctx);
  }

  function buildMessagesPayload(chat, latestUserText, ctx){
    const modeConfig = MODES[chat.mode] || MODES.generate;
    const systemPrompt = modeConfig.system(ctx);

    // Include recent conversational history for continuity (ChatGPT-like follow-ups)
    const history = chat.messages
      .slice(-8, -1) // exclude the just-pushed user message, keep short window
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));

    return [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: latestUserText }
    ];
  }

  async function streamAIResponse(chat, latestUserText, ctx){
    isStreaming = true;
    sendBtn.disabled = true;

    const aiMsg = { id: uid(), role: 'ai', content: '', ts: Date.now() };
    chat.messages.push(aiMsg);
    const msgEl = renderMessage(aiMsg);
    const bubble = msgEl.querySelector('.msg-bubble');
    const actions = msgEl.querySelector('.msg-actions');
    bubble.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
    scrollToBottom();

    const payload = {
      model: settings.model,
      messages: buildMessagesPayload(chat, latestUserText, ctx),
      temperature: Number(settings.temperature) || 0.7,
      max_tokens: Number(settings.maxTokens) || 900,
      stream: true
    };

    try{
      const headers = { 'Content-Type': 'application/json' };
      if(settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

      const res = await fetch(settings.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if(!res.ok || !res.body){
        const errText = await safeReadError(res);
        throw new Error(errText || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffered = '';
      let full = '';
      bubble.textContent = '';
      bubble.classList.add('cursor-blink');

      while(true){
        const { value, done } = await reader.read();
        if(done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop();

        for(const line of lines){
          const trimmed = line.trim();
          if(!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if(dataStr === '[DONE]') continue;
          try{
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta?.content
              ?? json.choices?.[0]?.message?.content
              ?? '';
            if(delta){
              full += delta;
              bubble.textContent = full;
              scrollToBottom();
            }
          }catch(e){ /* ignore malformed partial chunk */ }
        }
      }

      bubble.classList.remove('cursor-blink');

      if(!full.trim()){
        full = "I couldn't generate a response from that provider. Double-check the model name and API key in Settings.";
      }
      aiMsg.content = full;
      bubble.textContent = full;
      actions.classList.add('show');
      saveChats();

    }catch(err){
      bubble.classList.remove('cursor-blink');
      const msg = (err && err.message) ? err.message : 'Something went wrong reaching the AI provider.';
      bubble.innerHTML = `<span style="color:var(--accent-2)"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(msg)}</span>`;
      aiMsg.content = '';
      showToast('Could not reach the AI provider — check Settings', 'error');
      saveChats();
    } finally {
      isStreaming = false;
      sendBtn.disabled = false;
      scrollToBottom();
    }
  }

  async function safeReadError(res){
    try{
      const j = await res.json();
      return j?.error?.message || j?.message || `Request failed (${res.status})`;
    }catch(e){
      return `Request failed (${res.status}). This provider may not allow direct browser requests (CORS).`;
    }
  }

  async function regenerateFrom(aiMsgId){
    if(isStreaming) return;
    const chat = getCurrentChat();
    if(!chat) return;
    const idx = chat.messages.findIndex(m => m.id === aiMsgId);
    if(idx < 1) return;
    // find preceding user message
    let userIdx = idx - 1;
    while(userIdx >= 0 && chat.messages[userIdx].role !== 'user') userIdx--;
    if(userIdx < 0) return;
    const userText = chat.messages[userIdx].content;

    // remove the old AI message (and any after it) from model + DOM
    chat.messages.splice(idx, 1);
    saveChats();
    renderChatArea();

    const ctx = {
      tone: toneSelect.value,
      length: lengthSelect.value,
      recipient: ctxRecipient.value.trim(),
      subject: ctxSubject.value.trim(),
      original: ctxOriginal.value.trim()
    };
    await streamAIResponse(chat, userText, ctx);
  }

  /* ---------------------------------------------------------
     THEME
  --------------------------------------------------------- */
  function applyTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    try{ localStorage.setItem(LS_THEME, theme); }catch(e){}
    $$('.footer-icon-btn i.bi-moon-stars, .footer-icon-btn i.bi-sun').forEach(icon => {
      icon.className = theme === 'dark' ? 'bi bi-moon-stars' : 'bi bi-sun';
    });
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------------------------------------------------------
     SETTINGS MODAL
  --------------------------------------------------------- */
  function openSettingsModal(){
    $('#apiBaseUrl').value = settings.baseUrl;
    $('#apiModel').value = settings.model;
    $('#apiKey').value = settings.apiKey;
    $('#temperatureRange').value = settings.temperature;
    $('#temperatureValue').textContent = settings.temperature;
    $('#maxTokens').value = settings.maxTokens;
    $$('.provider-btn').forEach(b => b.classList.toggle('active', b.dataset.provider === settings.provider));
    bootstrap.Modal.getOrCreateInstance($('#settingsModal')).show();
  }

  function saveSettingsFromModal(){
    settings.baseUrl = $('#apiBaseUrl').value.trim();
    settings.model = $('#apiModel').value.trim();
    settings.apiKey = $('#apiKey').value.trim();
    settings.temperature = parseFloat($('#temperatureRange').value);
    settings.maxTokens = parseInt($('#maxTokens').value, 10) || 900;
    saveSettings();
    showToast('Settings saved');
    bootstrap.Modal.getOrCreateInstance($('#settingsModal')).hide();
  }

  async function testConnection(){
    const baseUrl = $('#apiBaseUrl').value.trim();
    const model = $('#apiModel').value.trim();
    const apiKey = $('#apiKey').value.trim();
    const localHost = isLocalHost(baseUrl);
    if(!baseUrl || !model || (!apiKey && !localHost)){
      showToast('Fill in base URL, model and API key first', 'error');
      return;
    }
    const btn = $('#testConnectionBtn');
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Testing…`;
    btn.disabled = true;
    try{
      const headers = { 'Content-Type': 'application/json' };
      if(apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
          max_tokens: 5
        })
      });
      if(res.ok){
        showToast('Connection successful');
      } else {
        const errText = await safeReadError(res);
        showToast(errText, 'error');
      }
    }catch(e){
      showToast('Network/CORS error reaching provider', 'error');
    } finally {
      btn.innerHTML = original;
      btn.disabled = false;
    }
  }

  /* ---------------------------------------------------------
     EXPORT
  --------------------------------------------------------- */
  function exportChat(){
    const chat = getCurrentChat();
    if(!chat || !chat.messages.length){ showToast('Nothing to export yet', 'error'); return; }
    const lines = chat.messages.map(m => `${m.role === 'user' ? 'YOU' : 'MISSIVE'} — ${new Date(m.ts).toLocaleString()}\n${m.content}\n`);
    const blob = new Blob([lines.join('\n---\n\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chat.title.replace(/[^\w\-]+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Draft exported');
  }

  /* ---------------------------------------------------------
     EVENT WIRING
  --------------------------------------------------------- */
  function wireModeButtons(){
    $$('.mode-item, .chip').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
  }

  function wireNewChat(){
    ['#newChatBtn', '#newChatBtnMobile'].forEach(sel => {
      const btn = $(sel);
      if(btn) btn.addEventListener('click', () => {
        createChat(currentMode);
        composerInput.value = '';
        ctxOriginal.value = '';
        ctxRecipient.value = '';
        ctxSubject.value = '';
        renderAll();
        composerInput.focus();
        const off = bootstrap.Offcanvas.getInstance($('#mobileSidebar'));
        if(off) off.hide();
      });
    });
  }

  function wireThemeToggle(){
    ['#themeToggleBtn', '#themeToggleBtnMobile'].forEach(sel => {
      const btn = $(sel);
      if(btn) btn.addEventListener('click', toggleTheme);
    });
  }

  function wireClearAll(){
    ['#clearAllBtn', '#clearAllBtnMobile'].forEach(sel => {
      const btn = $(sel);
      if(btn) btn.addEventListener('click', () => {
        if(confirm('Delete all drafting history? This cannot be undone.')) clearAllChats();
      });
    });
  }

  function wireSettingsButtons(){
    ['#settingsBtn', '#settingsBtnMobile'].forEach(sel => {
      const btn = $(sel);
      if(btn) btn.addEventListener('click', openSettingsModal);
    });
    $('#saveSettingsBtn').addEventListener('click', saveSettingsFromModal);
    $('#testConnectionBtn').addEventListener('click', testConnection);

    $$('.provider-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.provider-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = PROVIDER_PRESETS[btn.dataset.provider];
        settings.provider = btn.dataset.provider;
        if(preset){
          $('#apiBaseUrl').value = preset.baseUrl;
          $('#apiModel').value = preset.model;
        }
      });
    });

    $('#temperatureRange').addEventListener('input', (e) => {
      $('#temperatureValue').textContent = e.target.value;
    });

    $('#toggleKeyVisibility').addEventListener('click', () => {
      const input = $('#apiKey');
      const icon = $('#toggleKeyVisibility i');
      if(input.type === 'password'){ input.type = 'text'; icon.className = 'bi bi-eye-slash'; }
      else { input.type = 'password'; icon.className = 'bi bi-eye'; }
    });
  }
  function wireComposer(){
    composerInput.addEventListener('input', () => autoResize(composerInput));
    composerInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        handleSend();
      }
    });
    sendBtn.addEventListener('click', handleSend);
    contextToggle.addEventListener('click', () => toggleContextPanel());
  }

  function wireTopbar(){
    $('#exportBtn').addEventListener('click', exportChat);
    $('#clearChatBtn').addEventListener('click', () => {
      const chat = getCurrentChat();
      if(!chat) return;
      if(chat.messages.length && !confirm('Clear all messages in this draft?')) return;
      chat.messages = [];
      chat.title = 'Untitled draft';
      saveChats();
      renderAll();
    });
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  function init(){
    const savedTheme = (() => { try{ return localStorage.getItem(LS_THEME); }catch(e){ return null; } })();
    applyTheme(savedTheme || 'dark');

    wireModeButtons();
    wireNewChat();
    wireThemeToggle();
    wireClearAll();
    wireSettingsButtons();
    wireComposer();
    wireTopbar();

    if(getCurrentChat()){
      currentMode = getCurrentChat().mode;
    }

    renderAll();
    autoResize(composerInput);

    if(!isKeyConfigured() && !isLocalHost(settings.baseUrl)){
      setTimeout(() => showToast('Add an API key in Settings to start generating emails'), 700);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
