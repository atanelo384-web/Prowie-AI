// app.js
let currentUser = null;
let db = null;
let auth = null;
let currentChatId = null;
let messagesList = [];
let isSending = false;

let rootElement, messagesContainer, authButtonsDiv, historyListDiv, sendBtn, messageInput;

function initFirebase() {
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        
        // Enable Google Provider
        window.googleProvider = new firebase.auth.GoogleAuthProvider();
        
        console.log("[OK] Firebase connected with Google Auth");
        return true;
    } catch(e) {
        console.error("Firebase error:", e);
        return false;
    }
}

function updateAuthUI() {
    if (!authButtonsDiv) return;
    if (currentUser) {
        const displayName = currentUser.displayName || currentUser.email || "User";
        const initial = displayName.charAt(0).toUpperCase();
        const photoURL = currentUser.photoURL;
        
        authButtonsDiv.innerHTML = `
            <div class="user-info">
                ${photoURL ? `<img src="${photoURL}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">` : `<div class="user-avatar">${initial}</div>`}
                <span style="font-size:0.85rem; max-width:150px; overflow:hidden; text-overflow:ellipsis;">${displayName.split(' ')[0]}</span>
                <button id="logoutBtn" class="btn" style="background:#2d374f;">[ Exit ]</button>
            </div>
        `;
        document.getElementById('logoutBtn')?.addEventListener('click', () => auth.signOut());
    } else {
        authButtonsDiv.innerHTML = `
            <button id="googleSignInBtn" class="btn btn-primary">[ G ] Login with Google</button>
        `;
        document.getElementById('googleSignInBtn')?.addEventListener('click', () => {
            auth.signInWithPopup(window.googleProvider).catch(err => alert("[ERROR] " + err.message));
        });
    }
}

function showNotification(msg, isError = false) {
    const notif = document.createElement('div');
    notif.textContent = msg;
    notif.style.cssText = `position:fixed; bottom:20px; right:20px; background:${isError ? '#dc2626' : '#2b5fef'}; padding:12px 24px; border-radius:40px; z-index:2000; animation:fadeSlideUp 0.3s ease; font-family:monospace;`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

async function loadChatHistory() {
    if (!currentUser || !db) {
        if(historyListDiv) historyListDiv.innerHTML = '<div style="padding:1rem;opacity:0.6;">[ Locked ] Sign in with Google</div>';
        return;
    }
    try {
        const snapshot = await db.collection('users').doc(currentUser.uid).collection('chats').orderBy('updatedAt', 'desc').get();
        const history = [];
        snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
        renderHistoryList(history);
    } catch(e) { console.warn(e); }
}

function renderHistoryList(chats) {
    if (!historyListDiv) return;
    if (!chats.length) {
        historyListDiv.innerHTML = '<div style="padding:1rem;opacity:0.6;">[ Empty ] No chats yet</div>';
        return;
    }
    historyListDiv.innerHTML = chats.map(chat => `
        <div class="history-item ${currentChatId === chat.id ? 'active' : ''}" data-id="${chat.id}">
            <div class="history-preview">${escapeHtml(chat.title || 'New chat')}</div>
            <div class="history-date">${chat.updatedAt?.toDate?.()?.toLocaleString() || 'just now'}</div>
        </div>
    `).join('');
    document.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', () => loadChatSession(el.dataset.id));
    });
}

async function loadChatSession(chatId) {
    if (!currentUser || !db) return;
    try {
        const docRef = db.collection('users').doc(currentUser.uid).collection('chats').doc(chatId);
        const doc = await docRef.get();
        if (doc.exists) {
            const data = doc.data();
            messagesList = data.messages || [];
            currentChatId = chatId;
            renderMessagesToUI();
            loadChatHistory();
        }
    } catch(e) { console.error(e); }
}

async function saveCurrentChat() {
    if (!currentUser || !db) return;
    if (!messagesList.length) return;
    const title = messagesList.length > 0 ? messagesList[0].content.substring(0, 35) + (messagesList[0].content.length > 35 ? '...' : '') : 'New chat';
    const chatData = { title, messages: messagesList, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try {
        if (!currentChatId) {
            const newRef = db.collection('users').doc(currentUser.uid).collection('chats').doc();
            currentChatId = newRef.id;
            await newRef.set({ ...chatData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        } else {
            await db.collection('users').doc(currentUser.uid).collection('chats').doc(currentChatId).update(chatData);
        }
        loadChatHistory();
    } catch(e) { console.error(e); }
}

async function createNewChat() {
    if (!currentUser) { 
        showNotification("[LOGIN] Please sign in with Google first", true);
        return;
    }
    currentChatId = null;
    messagesList = [];
    messagesList.push({ role: 'assistant', content: "[NEX] Hello! I'm Gemini AI. Ask me anything!" });
    renderMessagesToUI();
    await saveCurrentChat();
    loadChatHistory();
}

async function clearAllHistory() {
    if (!currentUser || !db) return;
    if (confirm('[WARNING] Delete ALL chats?')) {
        const coll = db.collection('users').doc(currentUser.uid).collection('chats');
        const snap = await coll.get();
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        currentChatId = null;
        messagesList = [];
        messagesList.push({ role: 'assistant', content: "[NEX] History cleared. Start new dialog!" });
        renderMessagesToUI();
        loadChatHistory();
    }
}

function renderMessagesToUI() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';
    messagesList.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role}`;
        const avatar = msg.role === 'user' ? '[U]' : '[AI]';
        messageDiv.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-bubble">${escapeHtml(msg.content)}</div>`;
        messagesContainer.appendChild(messageDiv);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if(m==='&') return '&amp;';
        if(m==='<') return '&lt;';
        if(m==='>') return '&gt;';
        return m;
    });
}

async function sendMessageToGemini(userMsg) {
    if (isSending) { showNotification("[WAIT] Please wait for response", true); return; }
    if (!currentUser) { showNotification("[LOGIN] Sign in with Google first", true); return; }
    
    isSending = true;
    if (sendBtn) sendBtn.disabled = true;
    
    messagesList.push({ role: 'user', content: userMsg });
    renderMessagesToUI();
    await saveCurrentChat();
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `<div class="message-avatar">[AI]</div><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    try {
        // Build conversation history for Gemini
        const conversationHistory = messagesList.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));
        
        const requestBody = {
            contents: conversationHistory,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
                topP: 0.95
            }
        };
        
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Gemini API error: ${errorData.error?.message || response.status}`);
        }
        
        const data = await response.json();
        const assistantReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "[ERROR] No response from Gemini";
        
        typingDiv.remove();
        messagesList.push({ role: 'assistant', content: assistantReply });
        renderMessagesToUI();
        await saveCurrentChat();
        
    } catch(error) {
        console.error("Gemini Error:", error);
        typingDiv.remove();
        messagesList.push({ role: 'assistant', content: `[ERROR] ${error.message}` });
        renderMessagesToUI();
        showNotification(`[ERROR] ${error.message}`, true);
    } finally {
        isSending = false;
        if (sendBtn) sendBtn.disabled = false;
    }
}

function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || isSending) return;
    messageInput.value = '';
    sendMessageToGemini(text);
}

function buildUI() {
    rootElement = document.getElementById('appRoot');
    rootElement.innerHTML = `
        <div class="navbar">
            <div class="logo"><div class="logo-icon">[G]</div><div class="logo-text">Nex Gemini AI</div></div>
            <div class="user-area" id="userArea"></div>
        </div>
        <div class="main-layout">
            <div class="history-sidebar">
                <div class="history-header"><span class="history-title">[ HISTORY ]</span><button id="clearHistoryBtn" class="clear-history">[X] Clear</button></div>
                <button id="newChatBtn" class="new-chat-btn">[+] New dialog</button>
                <div id="historyList" class="history-list"></div>
            </div>
            <div class="chat-area">
                <div id="messagesContainer" class="messages-container"></div>
                <div class="input-area">
                    <div class="input-group">
                        <input type="text" id="messageInput" placeholder="[ Gemini AI ] Type your message..." autocomplete="off">
                        <button id="sendBtn" class="send-btn">[ Send ]</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    messagesContainer = document.getElementById('messagesContainer');
    authButtonsDiv = document.getElementById('userArea');
    historyListDiv = document.getElementById('historyList');
    sendBtn = document.getElementById('sendBtn');
    messageInput = document.getElementById('messageInput');
    
    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => clearAllHistory());
    document.getElementById('newChatBtn')?.addEventListener('click', () => createNewChat());
    sendBtn.addEventListener('click', () => handleSendMessage());
    messageInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleSendMessage(); });
}

function subscribeAuth() {
    if (!auth) return;
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        updateAuthUI();
        if (user) {
            messagesList = [];
            currentChatId = null;
            messagesList.push({ role: 'assistant', content: `[NEX] Welcome ${user.displayName || user.email}! I'm Gemini AI. History saved in Firebase.` });
            renderMessagesToUI();
            await loadChatHistory();
            showNotification(`[WELCOME] Hello ${user.displayName?.split(' ')[0] || 'User'}!`);
        } else {
            if(historyListDiv) historyListDiv.innerHTML = '<div style="padding:1rem;">[ Login ] Sign in with Google</div>';
            messagesList = [];
            messagesList.push({ role: 'assistant', content: "[NEX] Hello! Sign in with Google button above to use Gemini AI and save chats." });
            renderMessagesToUI();
            currentChatId = null;
        }
    });
}

window.onload = () => {
    buildUI();
    const firebaseOk = initFirebase();
    if (firebaseOk && auth) subscribeAuth();
    else alert("[ERROR] Firebase init failed");
};
