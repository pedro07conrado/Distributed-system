let ws = null;
const monitoredHosts = new Map();

function addLog(containerId, message) {
  const log = document.getElementById(containerId);
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.appendChild(line);
  if (log.children.length > 200) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function connectWebSocket() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  const url = document.getElementById("serverUrl").value.trim();

  try {
    const connection = new WebSocket(url);
    ws = connection;
    document.getElementById("connectBtn").disabled = true;
    document.getElementById("disconnectBtn").disabled = false;

    connection.onopen = () => {
      addLog("connectionLog", "Conectado ao servidor WebSocket.");
      document.getElementById("firstMessageButton").disabled = false;
      document.getElementById("monitorBtn").disabled = false;
    };

    connection.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Objeto JSON esperado");
        }
      } catch {
        addLog("messageLog", "Erro: resposta JSON inválida do servidor.");
        return;
      }

      if (data.error) {
        addLog("messageLog", `Erro: ${data.error}`);
        return;
      }

      if (data.cmd === "repeat") {
        addLog("firstMessageLog", `Recebido: ${JSON.stringify(data)}`);
      } else {
        addLog("messageLog", `Recebido: ${JSON.stringify(data)}`);
      }

      if (typeof data.host === "string" && typeof data.tcp === "boolean") {
        updateHostStatus(data.host, data.tcp);
      }
    };

    connection.onerror = () => {
      addLog("connectionLog", "Erro na conexão.");
    };

    connection.onclose = () => {
      if (ws !== connection) return;
      ws = null;
      monitoredHosts.clear();
      document.getElementById("hostList").replaceChildren();
      addLog("connectionLog", "Desconectado do servidor.");
      document.getElementById("connectBtn").disabled = false;
      document.getElementById("disconnectBtn").disabled = true;
      document.getElementById("firstMessageButton").disabled = true;
      document.getElementById("monitorBtn").disabled = true;
    };
  } catch (error) {
    addLog("connectionLog", `Erro: ${error.message}`);
  }
}

function disconnectWebSocket() {
  if (ws) {
    ws.close();
    document.getElementById("disconnectBtn").disabled = true;
  }
}

function sendFirstMessage() {
  const message = document.getElementById("messageInput").value;
  if (!message) {
    alert("Digite uma mensagem.");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Conecte-se ao servidor primeiro.");
    return;
  }

  const command = { cmd: "repeat", message: message };
  ws.send(JSON.stringify(command));
  addLog("firstMessageLog", `Enviado: ${JSON.stringify(command)}`);
}

function monitorHost() {
  const host = document.getElementById("hostInput").value.trim().toLowerCase();
  const interval = Number(document.getElementById("intervalInput").value);
  const port = Number(document.getElementById("portInput").value);

  if (!host) {
    alert("Digite um host.");
    return;
  }
  if (!Number.isInteger(interval) || interval < 1 || interval > 3600) {
    alert("O intervalo deve ser um inteiro entre 1 e 3600 segundos.");
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    alert("A porta deve ser um inteiro entre 1 e 65535.");
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert("Conecte-se ao servidor primeiro.");
    return;
  }

  const command = { cmd: "monitor", host: host, interval: interval };
  if (port !== 443) command.port = port;
  ws.send(JSON.stringify(command));
  addLog("messageLog", `Enviado: ${JSON.stringify(command)}`);
}

function updateHostStatus(host, isOnline) {
  let status = monitoredHosts.get(host);
  if (!status) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = host;
    status = document.createElement("td");
    row.append(name, status);
    document.getElementById("hostList").appendChild(row);
    monitoredHosts.set(host, status);
  }
  status.textContent = isOnline ? "up" : "down";
}
