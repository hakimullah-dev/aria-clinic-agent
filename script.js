// ── CONFIG ───────────────────────────────────────────
const WEBHOOK = '/api/aria';

// ── STATE ─────────────────────────────────────────────
let isListening  = false;
let isProcessing = false;
let recognition;
let audioCtx;

// ── MEMORY: session + conversation history ────────────
let sessionId           = 'sess_' + crypto.randomUUID();
let conversationHistory = [];

// ── DOM REFS ──────────────────────────────────────────
const chatWindow      = document.getElementById('chatWindow');
const textInput       = document.getElementById('textInput');
const micBtn          = document.getElementById('micBtn');
const micLabel        = document.getElementById('micLabel');
const micIcon         = document.getElementById('micIcon');
const typingIndicator = document.getElementById('typingIndicator');
const statusText      = document.getElementById('statusText');
const statusDot       = document.querySelector('.status-dot');
const avatar          = document.getElementById('avatar');
const avatarRing      = document.getElementById('avatarRing');

// ── ON LOAD ───────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    speakBrowser("G'day! I'm Aria, your receptionist at Greenfield Medical Centre. How can I help you today?");
  }, 800);
});

// ── KEYBOARD ──────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter') sendText();
}

// ── SEND TEXT ─────────────────────────────────────────
function sendText() {
  const msg = textInput.value.trim();
  if (!msg || isProcessing) return;
  textInput.value = '';
  sendToAria(msg);
}

// ── MIC TOGGLE ────────────────────────────────────────
function toggleListening() {
  if (isProcessing) return;
  isListening ? stopListening() : startListening();
}

function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Voice input requires Chrome browser. Please type your message instead.');
    return;
  }

  recognition = new SR();
  recognition.lang           = 'en-AU';
  recognition.continuous     = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isListening = true;
    setUI('listening');
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    textInput.value  = transcript;
    stopListening();
    sendToAria(transcript);
  };

  recognition.onerror = () => {
    stopListening();
    setUI('idle');
  };

  recognition.onend = () => {
    isListening = false;
    if (!isProcessing) setUI('idle');
  };

  recognition.start();
}

function stopListening() {
  if (recognition) recognition.stop();
  isListening = false;
}

// ── MARKDOWN RENDERER ─────────────────────────────────
// Converts basic markdown to clean HTML for chat bubbles
function renderMarkdown(text) {
  if (!text) return '';

  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    // Bullet list lines: "- item" or "• item"
    .replace(/^[•\-]\s+(.+)$/gm, '<li>$1</li>')
    // Numbered list: "1. item"
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>(\n|$))+/g, (match) => `<ul style="margin:6px 0 6px 16px;padding:0">${match}</ul>`)
    // Line breaks
    .replace(/\n/g, '<br>');
}

// ── MAIN: SEND TO n8n ─────────────────────────────────
async function sendToAria(userText) {
  if (!userText || isProcessing) return;

  addMessage('user', userText);
  isProcessing = true;
  setUI('processing');
  showTyping(true);

  // Calculate today's date on the frontend as a backup for GPT
  const now = new Date();
  const todayISO     = now.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowISO  = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });

  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:         userText,
        session_id:   sessionId,
        history:      conversationHistory,
        today_date:   todayISO,      // ← FIX: send real date to n8n
        tomorrow_date: tomorrowISO   // ← FIX: send real tomorrow date
      })
    });

    if (!res.ok) throw new Error('Network error: ' + res.status);

    const data = await res.json();
    showTyping(false);

    // Save updated history returned by n8n
    if (data.history && Array.isArray(data.history)) {
      conversationHistory = data.history;
    }

    const replyText = data.text || "Sorry, I didn't catch that. Could you please try again?";
    addMessage('aria', replyText);

    if (data.audio) {
      await playBase64Audio(data.audio);
    } else {
      speakBrowser(replyText);
    }

  } catch (err) {
    console.error('Aria error:', err);
    showTyping(false);
    const errMsg = "Sorry, I'm having a little trouble connecting right now. Please try again or call us on (02) 9876 5432.";
    addMessage('aria', errMsg);
    speakBrowser(errMsg);
  } finally {
    isProcessing = false;
    textInput.value = '';
    setUI('idle');
  }
}

// ── PLAY ELEVENLABS AUDIO (base64 mp3) ───────────────
async function playBase64Audio(base64) {
  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const buffer = await audioCtx.decodeAudioData(bytes.buffer);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    setSpeaking(true);

    return new Promise((resolve) => {
      source.onended = () => { setSpeaking(false); resolve(); };
      source.start(0);
    });

  } catch (e) {
    console.error('Audio playback error:', e);
    setSpeaking(false);
  }
}

// ── BROWSER TTS FALLBACK ──────────────────────────────
function speakBrowser(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  // Strip any markdown before speaking
  const plainText = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^[•\-]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '');

  const utterance  = new SpeechSynthesisUtterance(plainText);
  utterance.lang   = 'en-AU';
  utterance.rate   = 0.92;
  utterance.pitch  = 1.05;

  const voices  = speechSynthesis.getVoices();
  const auVoice = voices.find(v =>
    v.lang === 'en-AU' ||
    v.name.includes('Australian') ||
    v.name.includes('Karen') ||
    v.name.includes('Catherine') ||
    v.name.includes('Zira')
  );
  if (auVoice) utterance.voice = auVoice;

  setSpeaking(true);
  utterance.onend   = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);
  speechSynthesis.speak(utterance);
}

window.speechSynthesis.onvoiceschanged = () => {};

// ── UI STATE MACHINE ──────────────────────────────────
function setUI(state) {
  micBtn.classList.remove('listening', 'processing');

  switch (state) {
    case 'listening':
      micBtn.classList.add('listening');
      micLabel.textContent   = 'Listening... tap to stop';
      statusText.textContent = 'Listening...';
      statusDot.className    = 'status-dot listening';
      break;

    case 'processing':
      micBtn.classList.add('processing');
      micLabel.textContent   = 'Processing...';
      statusText.textContent = 'Aria is thinking...';
      statusDot.className    = 'status-dot thinking';
      break;

    default:
      micLabel.textContent   = 'Tap to speak';
      statusText.textContent = 'Online & Ready';
      statusDot.className    = 'status-dot';
      break;
  }
}

function setSpeaking(active) {
  if (active) {
    avatar.classList.add('speaking');
    avatarRing.classList.add('speaking');
    statusText.textContent = 'Aria is speaking...';
  } else {
    avatar.classList.remove('speaking');
    avatarRing.classList.remove('speaking');
    statusText.textContent = 'Online & Ready';
  }
}

function showTyping(show) {
  typingIndicator.classList.toggle('active', show);
  if (show) chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ── ADD MESSAGE ───────────────────────────────────────
function addMessage(role, text) {
  const wrap     = document.createElement('div');
  wrap.className = `message ${role === 'aria' ? 'aria-msg' : 'user-msg'}`;

  const av       = document.createElement('div');
  av.className   = 'msg-avatar';
  av.textContent = role === 'aria' ? 'A' : 'You';

  const bubble     = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (role === 'aria') {
    // FIX: render markdown for Aria's messages
    bubble.innerHTML = renderMarkdown(text);
  } else {
    // User messages stay as plain text (safe — no innerHTML for user input)
    bubble.textContent = text;
  }

  wrap.appendChild(av);
  wrap.appendChild(bubble);

  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ── CLEAR CHAT ────────────────────────────────────────
function clearChat() {
  // Reset session and history on clear
  sessionId           = 'sess_' + crypto.randomUUID();
  conversationHistory = [];

  chatWindow.innerHTML = '';
  addMessage('aria', "Chat cleared! How can I help you today?");
}