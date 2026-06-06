const socket = io();

let myName = ""; 
const messagesDiv = document.getElementById("messages");

let isMultiSelectMode = false;
let selectedMessageIds = [];

let activeReplyParentId = null;
let globallyLoadedMessagesMap = {};

function createHeart() {
    const container = document.getElementById("heartBgContainer");
    if (!container) return;

    const heart = document.createElement("div");
    heart.className = "heart-element";
    heart.innerText = ["❤️", "💖", "💝", "💕", "🌸"][Math.floor(Math.random() * 5)];
    
    heart.style.left = Math.random() * 100 + "vw";
    heart.style.animationDuration = Math.random() * 3 + 4 + "s"; 
    heart.style.fontSize = Math.random() * 15 + 12 + "px"; 
    
    container.appendChild(heart);
    setTimeout(() => heart.remove(), 7000);
}
setInterval(createHeart, 500);

function joinChat(){
    const name = document.getElementById("usernameInput").value.trim();
    const passcode = document.getElementById("passcode").value;

    if(!name) {
        alert("Please enter your name.");
        return;
    }
    socket.emit("check-passcode", { name: name, code: passcode });
}

socket.on("access-granted", (data) => {
    myName = data.username;
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("chatScreen").style.display = "flex";
    scrollToBottom();
});

socket.on("access-denied", () => {
    alert("Access Denied: The space remains closed.");
});

function toggleMediaDrawer() {
    const drawer = document.getElementById("mediaDrawer");
    drawer.classList.toggle("open");
}

function sendSticker(stickerText) {
    const payload = activeReplyParentId ? { text: `[STICKER]: ${stickerText}`, parentId: activeReplyParentId } : `[STICKER]: ${stickerText}`;
    socket.emit("chat-message", payload);
    cancelReplyTracking();
    toggleMediaDrawer();
}

function handleLocalImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        const payload = activeReplyParentId ? { text: `[IMAGE]: ${dataUrl}`, parentId: activeReplyParentId } : `[IMAGE]: ${dataUrl}`;
        socket.emit("chat-message", payload);
        cancelReplyTracking();
        toggleMediaDrawer();
        document.getElementById("fileUploader").value = ""; 
    };
    reader.readAsDataURL(file);
}

function parseMessageContent(text) {
    if (typeof text !== "string") return "";
    if (text.startsWith("[STICKER]:")) {
        const content = text.replace("[STICKER]:", "");
        return `<div class="sticker-bubble">${content}</div>`;
    }
    if (text.startsWith("[IMAGE]:")) {
        const base64Data = text.replace("[IMAGE]:", "");
        return `<img src="${base64Data}" class="chat-image-preview" onload="scrollToBottom();"/>`;
    }
    const urlRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp|svg))/i;
    if (urlRegex.test(text)) {
        return `<img src="${text}" class="chat-image-preview" onload="scrollToBottom();" onerror="this.alt='Image Link'; text-decoration: underline;"/>`;
    }
    return text;
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function setupReplyTracking(id) {
    const targetMsg = globallyLoadedMessagesMap[id];
    if (!targetMsg) return;

    activeReplyParentId = id;
    document.getElementById("replyTargetUser").innerText = targetMsg.sender_name;
    
    let plainSummary = targetMsg.text;
    if (plainSummary.startsWith("[IMAGE]:")) plainSummary = "🖼️ Photo Note";
    if (plainSummary.startsWith("[STICKER]:")) plainSummary = "✨ Sticker Tab";
    
    document.getElementById("replyTargetText").innerText = plainSummary;
    document.getElementById("replyPreviewBar").classList.remove("hidden-reply-bar");
    document.getElementById("messageInput").focus();
}

function cancelReplyTracking() {
    activeReplyParentId = null;
    document.getElementById("replyPreviewBar").classList.add("hidden-reply-bar");
}

function dispatchReactionToggle(messageId, emoji) {
    socket.emit("toggle-reaction", { messageId, emoji });
}

function renderReactionsTray(messageId, reactionMap) {
    let container = document.querySelector(`#msg-${messageId} .reactions-display-tray`);
    if (!container) return;
    container.innerHTML = "";

    if (!reactionMap || Object.keys(reactionMap).length === 0) return;

    Object.keys(reactionMap).forEach(emoji => {
        const usersList = reactionMap[emoji];
        if (!usersList || usersList.length === 0) return;

        const badge = document.createElement("div");
        badge.className = "reaction-badge";
        if (usersList.includes(myName)) badge.classList.add("i-reacted");
        
        badge.innerHTML = `${emoji} <span>${usersList.length}</span>`;
        badge.title = `Reacted by: ${usersList.join(", ")}`;
        badge.onclick = (e) => {
            e.stopPropagation();
            dispatchReactionToggle(messageId, emoji);
        };
        
        container.appendChild(badge);
    });
}

function addMessage(msg){
    globallyLoadedMessagesMap[msg.id] = msg;

    const div = document.createElement("div");
    div.className = "message";
    div.id = "msg-" + msg.id;

    if(msg.sender_name === myName) {
        div.classList.add("my-message");
    }

    div.addEventListener("click", (e) => {
        if (e.target.closest(".msg-actions") || e.target.closest(".reactions-quick-dock") || e.target.closest(".reactions-display-tray") || e.target.tagName === "INPUT" || e.target.classList.contains("confirm-yes") || e.target.classList.contains("confirm-no")) return;
        
        if (isMultiSelectMode) {
            handleSelectMessageBubble(msg.id, msg.sender_name);
        } else {
            const actions = div.querySelector(".msg-actions");
            if (actions && !e.target.closest(".msg-actions") && !e.target.closest(".reactions-display-tray")) {
                const wasOpen = actions.style.display === "flex";
                document.querySelectorAll(".msg-actions").forEach(el => el.style.display = "none");
                actions.style.display = wasOpen ? "none" : "flex";
            }
        }
    });

    let parentQuoteHTML = "";
    if (msg.parent_id && globallyLoadedMessagesMap[msg.parent_id]) {
        const parent = globallyLoadedMessagesMap[msg.parent_id];
        let previewContent = parent.text;
        if (previewContent.startsWith("[IMAGE]:")) previewContent = "🖼️ Photo";
        if (previewContent.startsWith("[STICKER]:")) previewContent = "✨ Sticker";
        
        parentQuoteHTML = `
            <div class="reply-quote-wrapper" onclick="const pEl = document.getElementById('msg-${msg.parent_id}'); if(pEl) pEl.scrollIntoView({behavior: 'smooth', block: 'center'});">
                <div class="quote-user">${parent.sender_name}</div>
                <div class="quote-excerpt">${previewContent}</div>
            </div>
        `;
    }

    let actionHTML = "";
    if (!isMultiSelectMode) {
        const isOwner = msg.sender_name === myName;
        actionHTML = `
            <div class="msg-actions">
                <div class="reactions-quick-dock">
                    <span onclick="dispatchReactionToggle(${msg.id}, '❤️')">❤️</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '😘')">😘</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '🤗')">🤗</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '😂')">😂</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '🥺')">🥺</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '😭')">😭</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '🥲')">🥲</span>
                    <span onclick="dispatchReactionToggle(${msg.id}, '👍')">👍</span>
                </div>
                <span class="replyActionBtn" onclick="setupReplyTracking(${msg.id})" title="Reply">↩️</span>
                ${isOwner ? `<span class="editBtn" onclick="editMessage(${msg.id})" title="Edit">✏️</span>` : ""}
                ${isOwner ? `<span class="deleteBtn" onclick="askUnsend(${msg.id})" title="Unsend">×</span>` : ""}
            </div>`;
    }

    const processedText = parseMessageContent(msg.text);

    div.innerHTML = `
        ${actionHTML}
        ${parentQuoteHTML}
        <div class="sender-name">${msg.sender_name}</div>
        <div class="msg-text">${processedText}</div>
        <div class="reactions-display-tray"></div>
        <div class="time">${msg.created_at}</div>
    `;

    messagesDiv.appendChild(div);
    
    let reactionMap = msg.reactions || {};
    if (typeof reactionMap === "string") {
        try { reactionMap = JSON.parse(reactionMap || "{}"); } catch(e) { reactionMap = {}; }
    }
    renderReactionsTray(msg.id, reactionMap);
    scrollToBottom();
}

socket.on("load-messages", (messages) => {
    messagesDiv.innerHTML = "";
    globallyLoadedMessagesMap = {};
    messages.forEach(addMessage);
});

socket.on("chat-message", addMessage);

socket.on("reaction-updated", (data) => {
    if (globallyLoadedMessagesMap[data.messageId]) {
        globallyLoadedMessagesMap[data.messageId].reactions = data.reactions;
    }
    renderReactionsTray(data.messageId, data.reactions);
});

function sendMessage(){
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if(text === "") return;

    if (activeReplyParentId) {
        socket.emit("chat-message", { text: text, parentId: activeReplyParentId });
        cancelReplyTracking();
    } else {
        socket.emit("chat-message", text);
    }
    input.value = "";
}

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("messageInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") {
        socket.emit("typing");
    } else {
        sendMessage();
    }
});

let typingTimeout;
socket.on("typing", (username) => {
    const typing = document.getElementById("typingIndicator");
    typing.innerText = `💕 ${username} is typing something sweet...`;

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typing.innerText = "";
    }, 1500);
});

socket.on("online-users", (count) => {
    document.getElementById("onlineUsers").innerText = "Connected: " + count;
});

function toggleMultiSelectMode() {
    if (isMultiSelectMode) disableMultiSelectMode();
    else enableMultiSelectMode();
}

function enableMultiSelectMode() {
    cancelReplyTracking();
    isMultiSelectMode = true;
    selectedMessageIds = [];
    document.getElementById("multiSelectBar").classList.remove("hidden-bar");
    document.getElementById("multiSelectToggleBtn").classList.add("active-toggle");
    resetSelectionTrayButtons(); 
    
    document.querySelectorAll(".msg-actions").forEach(el => el.style.display = "none");
    document.querySelectorAll(".message").forEach(el => el.classList.add("selectable-context"));
}

function disableMultiSelectMode() {
    isMultiSelectMode = false;
    document.getElementById("multiSelectBar").classList.add("hidden-bar");
    document.getElementById("multiSelectToggleBtn").classList.remove("active-toggle");
    
    document.querySelectorAll(".message").forEach(el => {
        el.classList.remove("selectable-context");
        el.classList.remove("bubble-selected");
    });
    document.querySelectorAll(".msg-actions").forEach(el => el.style.display = "none");
    selectedMessageIds = [];
}

function handleSelectMessageBubble(id, senderName) {
    if (senderName !== myName) return; 
    const el = document.getElementById(`msg-${id}`);
    const index = selectedMessageIds.indexOf(id);

    if (index > -1) {
        selectedMessageIds.splice(index, 1);
        if (el) el.classList.remove("bubble-selected");
    } else {
        selectedMessageIds.push(id);
        if (el) el.classList.add("bubble-selected");
    }
    document.getElementById("selectCountLabel").innerText = `${selectedMessageIds.length} selected`;
}

function resetSelectionTrayButtons() {
    document.getElementById("selectCountLabel").innerText = `${selectedMessageIds.length} selected`;
    document.querySelector(".multi-select-buttons").innerHTML = `
        <button class="action-unsend-btn" onclick="unsendSelectedMessages()">Unsend Selected ❌</button>
        <button class="action-cancel-btn" onclick="disableMultiSelectMode()">Cancel</button>
    `;
}

function unsendSelectedMessages() {
    if (selectedMessageIds.length === 0) return;
    const countLabel = document.getElementById("selectCountLabel");
    const buttonsContainer = document.querySelector(".multi-select-buttons");

    countLabel.innerText = `Remove ${selectedMessageIds.length} notes permanently?`;
    buttonsContainer.innerHTML = `
        <button class="action-unsend-btn" id="execute-multi-unsend" style="background: #ff3333;">Yes, Unsend</button>
        <button class="action-cancel-btn" id="abort-multi-unsend">No</button>
    `;

    document.getElementById("execute-multi-unsend").addEventListener("click", () => {
        socket.emit("delete-messages", selectedMessageIds);
        disableMultiSelectMode();
    });
    document.getElementById("abort-multi-unsend").addEventListener("click", () => {
        disableMultiSelectMode();
    });
}

function askUnsend(id) {
    if (isMultiSelectMode) return;
    const msgElement = document.querySelector(`#msg-${id} .msg-text`);
    if (msgElement.querySelector('.inline-edit-input')) return;
    
    const originalContent = msgElement.innerHTML;
    const actionPanel = document.querySelector(`#msg-${id} .msg-actions`);
    if (actionPanel) actionPanel.style.display = 'none';

    msgElement.innerHTML = `
        <div class="inline-confirm-container">
            <span>Unsend this love note?</span>
            <div class="inline-confirm-buttons">
                <strong class="confirm-yes" id="inline-yes-${id}">Yes</strong>
                <span class="confirm-no" id="cancel-unsend-${id}">Cancel</span>
            </div>
        </div>
    `;

    document.getElementById(`inline-yes-${id}`).addEventListener('click', () => {
        socket.emit("delete-messages", [id]);
    });
    document.getElementById(`cancel-unsend-${id}`).addEventListener('click', () => {
        msgElement.innerHTML = originalContent;
        if (actionPanel) actionPanel.style.display = 'flex';
    });
}

function editMessage(id) {
    if (isMultiSelectMode) return;
    const msgElement = document.querySelector(`#msg-${id} .msg-text`);
    if (msgElement.querySelector('img') || msgElement.querySelector('.sticker-bubble') || msgElement.querySelector('.reply-quote-wrapper')) return;
    if (msgElement.querySelector('.inline-edit-input') || msgElement.querySelector('.inline-confirm-container')) return;

    const oldText = msgElement.innerText;
    msgElement.innerHTML = `
        <div class="inline-edit-container">
            <input type="text" class="inline-edit-input" value="${oldText}">
            <div class="inline-edit-hint">Press Enter to Save, Esc to Cancel</div>
        </div>
    `;
    
    const input = msgElement.querySelector('.inline-edit-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const newText = input.value.trim();
            if (newText !== "" && newText !== oldText) {
                socket.emit("edit-message", { id: id, newText: newText });
            } else {
                msgElement.innerText = oldText;
            }
        } else if (e.key === 'Escape') {
            msgElement.innerText = oldText;
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (msgElement.querySelector('.inline-edit-input')) {
                msgElement.innerText = oldText;
            }
        }, 1500);
    });
}

socket.on("message-edited", (data) => {
    const msgText = document.querySelector(`#msg-${data.id} .msg-text`);
    if (msgText) msgText.innerText = data.text;
});

socket.on("messages-deleted", (ids) => {
    if (!Array.isArray(ids)) return;
    ids.forEach(id => {
        const msg = document.getElementById("msg-" + id);
        if (msg) msg.remove();
        delete globallyLoadedMessagesMap[id];
    });
});

document.getElementById("darkModeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
});

if (window.visualViewport) {
    const adjustLayoutForMobileKeyboard = () => {
        const chatScreen = document.getElementById("chatScreen");
        if (!chatScreen || chatScreen.style.display === "none") return;

        const currentViewportHeight = window.visualViewport.height;
        chatScreen.style.height = `${currentViewportHeight}px`;

        if (window.visualViewport.offsetTop > 0) {
            chatScreen.style.transform = `translateY(${window.visualViewport.offsetTop}px)`;
        } else {
            chatScreen.style.transform = "none";
        }
        
        scrollToBottom();
    };

    window.visualViewport.addEventListener("resize", adjustLayoutForMobileKeyboard);
    window.visualViewport.addEventListener("scroll", adjustLayoutForMobileKeyboard);
    
    document.getElementById("messageInput").addEventListener("focus", () => {
        setTimeout(adjustLayoutForMobileKeyboard, 200);
    });
}