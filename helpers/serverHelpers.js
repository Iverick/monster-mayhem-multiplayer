const WebSocket = require("ws");

// Function allows to get the username by playerId
function getUsernameById(id, playerIdToUsername) {
  return playerIdToUsername[id];
}

// Helper function to broadcast a message to all clients
function broadcastAll(message, wss) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

// Helper function to broadcast a message to all clients except the sender
function broadcastExcept(exceptClient, message, wss) {
  const str = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client !== exceptClient && client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  });
}

module.exports = {
  getUsernameById,
  broadcastAll,
  broadcastExcept,
}