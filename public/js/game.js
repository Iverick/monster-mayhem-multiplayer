let userId = null;
// This variable is used to store all players and their positions
// allPlayers = { 
//  "playerId1": "username1",
//  "playerId2": "username2"
// }
let allPlayers = {};
let playersTurnCompleted = {};
let playerIndices = [];
// This variable is used to store all monsters and their positions received from the server
let monsters = {};
let stats = {};
let selectedMonsterId = null;
let justMoved = false;

// Get access to the root div#board element on index.html page
// Which will be later populated with rows of hexagons
const board = document.getElementById("board");
const waitingTurnMsg = document.getElementById("waiting-turn-msg");
const startButton = document.getElementById('start-button');
const leaveLobbyButton = document.getElementById("leave-lobby-button");
const waitingMessage = document.getElementById('waiting-message');
const playerStatsContainer = document.getElementById('player-stats');
const gameHintsContainer = document.getElementById('game-hints');
const endTurnButtonContainer = document.getElementById('end-turn');
const endTurnButton = document.getElementById('end-turn-button');

const monsterIcons = {
  vampire: "🧛",
  werewolf: "🐺",
  ghost: "👻"
};

// Setup number of rows and columns
const rows = 10;
const cols = 10;

const socket = new WebSocket(`ws://${window.location.host}`);

// This function used to create a single square div element
function createTile(row, col) {
  const tile = document.createElement("div");
  tile.classList.add("tile");
  tile.dataset.row = row;
  tile.dataset.col = col;
  return tile;
}

// This is the main function of the script
// It sets up a playing board with HTML elements
function setupBoard() {
  // Loop over the number of rows and populate them with hexagons
  for (let row = 0; row < rows; row++) {
    const rowElement = document.createElement("div");
    rowElement.classList.add("row");

    // This loop used to add squares to each row using createHex function
    // Number of hexagons equals the declared number of columns
    for (let col = 0; col < cols; col++) {
      const tile = createTile(row, col);
      rowElement.appendChild(tile);
    }

    // Append each row to the root element
    board.appendChild(rowElement);
  }
}

// This function is used to display player stats in the child components of the declared player-stats placeholder
function displayPlayerStats() {
  Object.keys(stats).forEach((id, index) => {
    const playerStats = stats[id];
    const position = index % 2 === 0 ? "even" : "odd";

    // Populate the player stats container elements with the player stats
    document.getElementById(`player-${position}-username`).textContent = playerStats.username;
    document.getElementById(`player-${position}-games`).textContent = playerStats.games;
    document.getElementById(`player-${position}-wins`).textContent = playerStats.wins;
    document.getElementById(`player-${position}-losses`).textContent = playerStats.losses;
  });

  // Call this function to make player-stats placeholder visible
  toggleStatsVisibility();
}

// This function is used to draw monsters on the board
function drawMonsters() {
  clearMonsters();

  for (const id in monsters) {
    const { playerId: ownerId, type, position, hasMoved } = monsters[id];
    const hex = document.querySelector(
      `.tile[data-row="${position.row}"][data-col="${position.col}"]`
    );
    if (hex) {
      const playerIndex = playerIndices.indexOf(ownerId); 

      hex.classList.add("monster", `player-${playerIndex % 2 === 0 ? 'even' : 'odd'}`);
      if (hasMoved && String(ownerId) === String(userId)) hex.classList.add("monster-moved");
      
      // Create an <i> tag for the monster icon
      const icon = document.createElement("div");
      icon.classList.add("monster-icon");
      icon.dataset.monsterId = id;
      icon.textContent = monsterIcons[type];

      // Clear previous content and append new icon
      hex.innerHTML = ""; // Instead of .textContent = ...
      hex.appendChild(icon);
    }

    if (String(ownerId) === String(userId)) {
      // First remove the old listener if it exists
      hex.removeEventListener("click", hex._clickHandler);

      // Create and store a new named click handler
      const handler = () => selectMonster(id, hex);
      hex._clickHandler = handler;

      hex.addEventListener("click", handler);
    }
  }
}

// This function is used to clear all monsters from the board
function clearMonsters() {
  const tiles = document.querySelectorAll(".tile");

  tiles.forEach(tile => {
    // Remove all monster-related classes and icons from the square grid
    tile.classList.remove("monster", "player-even", "player-odd", "monster-selected", "monster-moved");

    // Remove any monster icons
    const icon = tile.querySelector("div.monster-icon");
    if (icon) {
      icon.remove();
    }

    // Remove old event handlers
    if (tile._clickHandler) {
      tile.removeEventListener("click", tile._clickHandler);
      delete tile._clickHandler;
    }
  });
}

function selectMonster(monsterId, tile) {
  // If the monster is already selected, deselect it and return
  if (justMoved) {
    return;
  }

  const selectedMonster = monsters[monsterId];

  // Prevent selecting a monster that has already moved
  if (selectedMonster.hasMoved) {
    return;
  }

  if (selectedMonsterId === monsterId) {
    deselectMonster();
    clearPathHighlights();
    return;
  }
  
  deselectMonster();
  clearPathHighlights();

  selectedMonsterId = monsterId;
  const { position } = selectedMonster;
  tile.classList.add("monster-selected");

  // Call the highlightValidPath function to highlight the valid path for the selected monster
  highlightValidPath(position.row, position.col);
}

function deselectMonster() {
  // If there is a selected monster, remove the selected class from it, clear the selectedMonsterId variable
  // and clear the path highlights
  clearPathHighlights();

  if (selectedMonsterId) {
    const { position } = monsters[selectedMonsterId];
    const tile = document.querySelector(`.tile[data-row="${position.row}"][data-col="${position.col}"]`);
    if (tile) {
      tile.classList.remove("monster-selected");
    }
  }

  selectedMonsterId = null;
}

// This function is used to highlight the valid path for the selected monster
function highlightValidPath(row, col) {
  // Clear any previous highlights
  clearPathHighlights();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Setup variable required for finding the valid hexes for diagonal movement
      const rowDiff = Math.abs(row - r);
      const colDiff = Math.abs(col - c);

      // The move is valid if it is either straight or up to two squares diagonally
      const isStraight = r === row || c === col;
      const isDiagonal = rowDiff === colDiff && rowDiff <= 2;
      const isValidMove = isStraight || isDiagonal;

      // Highlight hexes that are valid moves and assign it click event to move the monster
      if (isValidMove && !isBlockedByEnemy(row, col, r, c)) {
        const tile = document.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
        if (tile) {
          tile.classList.add("highlight-path");
          tile.addEventListener("click", handleMoveClick);
        }
      }
    }
  }
}

// Function removes highlight-path class from hexes
function clearPathHighlights() {
  document.querySelectorAll(".highlight-path").forEach((tile) => {
    tile.classList.remove("highlight-path");
    tile.removeEventListener("click", handleMoveClick);
  });
}

function handleMoveClick(event) {
  const target = event.currentTarget;
  if (!target.classList.contains("highlight-path") || !selectedMonsterId) return;
  
  // Get the row and column of the clicked hexagon
  const row = parseInt(target.dataset.row, 10);
  const col = parseInt(target.dataset.col, 10);

  // Check if one of your own monsters already occupies (row, col)
  const tileHasUserMonster = findUserMonsterAt(monsters, userId, row, col);
  if (tileHasUserMonster) {
    alert("Cannot move into a tile occupied by your own monster");
    return;
  }

  // Emit move event to the server with the selected monster ID and new position
  socket.send(JSON.stringify({
    type: "move",
    monsterId: selectedMonsterId,
    position: { row, col },
    userId,
  }));
  
  // Deselect monster and clear highlights
  selectedMonsterId = null;
  clearPathHighlights();
  deselectMonster();

  justMoved = true;
  setTimeout(() => {
    justMoved = false;
  }, 0);
}

// startButton click handler that sends a message to the server to start the game
startButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "start", id: userId }));
});

endTurnButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "endTurnButton" }));
});

leaveLobbyButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "playerLeft", userId }));
  window.location.href = "/";
});

// This function is used to create a WebSocket connection on the browser window load
// and listen for incoming messages
window.onload = () => {
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // On init message we initialize client with its userId
      if (message.type === "init") {
        console.log("Init message received", message);
        userId = message.id;
      }

      // Update the allPlayers object if there is a player joined of left the lobby
      if (message.type === "playerJoined" || message.type === "playerLeftLobby") {
        console.log("Player joined ", message);
        allPlayers = message.data.allPlayers;
        toggleControlsOverlay();
      }

      if (message.type === "start") {
        console.log("Game start ", message);

        monsters = message.data.monsters;
        stats = message.data.stats;
        playersTurnCompleted = message.data.playersTurnCompleted;
        playerIndices = Object.keys(allPlayers);

        //Remove overlay here so it no longer displayed for all players
        document.getElementById('game-controls').style.display = 'none';
        // Setup the board with hexagons and add the character for every player to the starting position
        setupBoard();
        drawMonsters();
        displayPlayerStats();
        displayGameHints();
        displayEndTurnButton();
        toggleBoardAvailability();
      }

      // On update message update the monsters object and redraw monsters on the board
      if (message.type === "update") {
        console.log("Updated monsters received: ", message.monsters);
        monsters = message.monsters;
        playersTurnCompleted = message.playersTurnCompleted;
        drawMonsters();
        toggleBoardAvailability();
        toggleEndButtonAvailability();
      }

      // On remove message we remove the character from the board and delete it from allPlayers object
      // This is used when a player disconnects and we need to remove their character from the game
      if (message.type === "gamePaused") {
        alert(`Player ${message.leftPlayerUsername} left the game! You can restart it later.`);
        window.location.href = "/"; // Redirect to the profile page
      }

      // On gameOver message we alert the user about the game result and redirect to the profile page
      if (message.type === "gameOver") {
        const { winner, loser } = message;

        // Alert the user about the game result
        if (username === winner) {
          alert(`🎉 Congratulations! You won the game against ${loser}.`);
        } else {
          alert(`😢 Game over!  You lost against ${winner}.`);
        }

        // Redirect to the profile page after the game is over
        window.location.href = "/me";
      }
    } catch (e) {
      // Right now errors will be passed as a plain text and displayed as an alert
      alert(event.data);
      window.location.href = "/";
    }
  };
};

socket.onopen = () => {
  socket.send(JSON.stringify({
    type: "identify",
    username,
    pausedGameId: gameId,
  }));
}
