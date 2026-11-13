const botReplies = {
  help: "I can assist you with portal navigation, registration rules, or dashboard tools.",
  register: "Use 6-12 alphanumeric characters for your Employee/Register ID.",
  default: "Thanks for your message! Try asking about 'register' or 'help'."
};

function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const log = document.getElementById("chat-log");
  if (!input || !log) return;

  const text = input.value.trim();
  if (!text) return;

  const userDiv = document.createElement("div");
  userDiv.className = "user-msg";
  userDiv.textContent = text;
  log.appendChild(userDiv);

  const key = Object.keys(botReplies).find((k) => text.toLowerCase().includes(k)) || "default";
  const botDiv = document.createElement("div");
  botDiv.className = "bot-msg";
  botDiv.textContent = botReplies[key];
  log.appendChild(botDiv);

  input.value = "";
  log.scrollTop = log.scrollHeight;
}
