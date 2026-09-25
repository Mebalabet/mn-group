/* AI support widget: fully self-contained, own state object
   (aiChatState), never reads or writes the storefront's `state` object
   or the modal overlay system. No call to /api/ai/chat happens on page
   load or on opening the panel — only when the visitor sends a message.
   Extracted unchanged from public/index.html. */
let aiChatState = { history: [], sending: false, opened: false };

function renderAiMessages(){
  const body = document.getElementById('aiPanelBody');
  body.innerHTML = aiChatState.history.map(m=>{
    const cls = m.role==='user' ? 'user' : (m.role==='system-note' ? 'system-note' : 'assistant');
    return `<div class="ai-msg ${cls}">${esc(m.content)}</div>`;
  }).join('') + (aiChatState.sending ? `<div class="ai-msg assistant">…</div>` : '');
  body.scrollTop = body.scrollHeight;
}

function toggleAiPanel(){
  const panel = document.getElementById('aiPanel');
  const open = panel.classList.toggle('open');
  if(open && !aiChatState.opened){
    aiChatState.opened = true;
    aiChatState.history.push({ role:'system-note', content:'Ask about MN Group products, pricing, categories, or services. This assistant only answers from published site information.' });
    renderAiMessages();
  }
  if(open) document.getElementById('aiInput').focus();
}

async function sendAiMessage(){
  if(aiChatState.sending) return;
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if(!text) return;
  input.value = '';
  aiChatState.history.push({ role:'user', content:text });
  aiChatState.sending = true;
  document.getElementById('aiSendBtn').disabled = true;
  renderAiMessages();
  try{
    // Only the last few real user/assistant turns are sent — system-note
    // entries (the local welcome message) are UI-only and never sent to
    // the server or the AI provider.
    const toSend = aiChatState.history.filter(m=>m.role==='user'||m.role==='assistant').slice(-12);
    const res = await fetch('/api/ai/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ messages: toSend }),
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      aiChatState.history.push({ role:'system-note', content: data.error || 'AI support is currently unavailable — please try again later.' });
    } else {
      aiChatState.history.push({ role:'assistant', content: data.reply });
    }
  }catch(e){
    aiChatState.history.push({ role:'system-note', content:'AI support is currently unavailable — please check your connection and try again.' });
  }finally{
    aiChatState.sending = false;
    document.getElementById('aiSendBtn').disabled = false;
    renderAiMessages();
  }
}
