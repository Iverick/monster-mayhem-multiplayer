let userId = null;
// This variable is used to store all players and their positions
// allPlayers = { 
//  "playerId1": "username1",
//  "playerId2": "username2"
// }
let allPlayers = {};
let playersTurnCompleted = {};
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
const waitingMessage = document.getElementById('waiting-message');
const playerStatsContainer = document.getElementById('player-stats');
const gameHintsContainer = document.getElementById('game-hints');
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

// This function used to create a single hex div element
function createHex(row, col) {
  const hex = document.createElement("div");
  hex.classList.add("hex");
  hex.dataset.row = row;
  hex.dataset.col = col;
  hex.textContent = ``;

  return hex;
}

// This is the main function of the script
// It sets up a playing board with HTML elements
function setupBoard() {
  // Loop over the number of rows and populate them with hexagons
  for (let row = 0; row < rows; row++) {
    const rowElement = document.createElement("div");
    rowElement.classList.add("row");

    // Apply a different stylesheet if the row is odd
    // This ensures there are no gaps between hexagons
    if (row % 2 != 0) {
      rowElement.classList.add("odd");
    }

    // This loop used to add hexagons to each row using createHex function
    // Number of hexagons equals the declared number of columns
    for (let col = 0; col < cols; col++) {
      const hex = createHex(row, col);
      rowElement.appendChild(hex);
    }

    // Append each row to the root element
    board.appendChild(rowElement);
  }
}

// This function is used to display player stats in the child components of the declared player-stats placeholder
function displayPlayerStats() {
  console.log("Player stats: ", stats);

  for (const id in stats) {
    const playerStats = stats[id];
    const position = id % 2 === 0 ? "even" : "odd";

    // Populate the player stats container elements with the player stats
    document.getElementById(`player-${position}-username`).textContent = playerStats.username;
    document.getElementById(`player-${position}-games`).textContent = playerStats.games;
    document.getElementById(`player-${position}-wins`).textContent = playerStats.wins;
    document.getElementById(`player-${position}-losses`).textContent = playerStats.losses;
  }

  // Call this function to make player-stats placeholder visible
  toggleStatsVisibility();
}

function displayGameHints() {
  const playerColor = userId % 2 === 0 ? "red" : "blue";
  const playerColorIndicator = document.getElementById("player-color-indicator");
  playerColorIndicator.textContent = `${playerColor}`;
  playerColorIndicator.style.color = `${playerColor}`;

  toggleHintsVisibility();
}

// This function is used to draw monsters on the board
function drawMonsters() {
  clearMonsters();

  for (const id in monsters) {
    const { playerId: ownerId, type, position, hasMoved } = monsters[id];
    // console.log("151: Monster data", `{ownerId: ${ownerId}, type: ${type}, position: ${position}}`);
    const hex = document.querySelector(
      `.hex[data-row="${position.row}"][data-col="${position.col}"]`
    );
    if (hex) {
      hex.classList.add("monster", `player-${ownerId % 2 === 0 ? 'even' : 'odd'}`);
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

    if (parseInt(ownerId) === parseInt(userId)) {
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
  const hexes = document.querySelectorAll(".hex");

  hexes.forEach(hex => {
    // Remove all monster-related classes and icons from the hexagon grid
    hex.classList.remove("monster", "player-even", "player-odd", "monster-selected", "monster-moved");

    // Remove any monster icons
    const icon = hex.querySelector("div.monster-icon");
    if (icon) {
      icon.remove();
    }
  });
}

function selectMonster(monsterId, hex) {
  // If the monster is already selected, deselect it and return
  // console.log("123. justMoved check: ", justMoved);
  if (justMoved) {
    return;
  }

  const selectedMonster = monsters[monsterId];

  // Prevent selecting a monster that has already moved
  if (selectedMonster.hasMoved) {
    alert("You can move monster only once per turn!");
    return;
  }

  // console.log("128. Monster selected:", monsters[monsterId]);
  // console.log("129. ID of previously selected monster:", selectedMonsterId);
  // console.log("130. Selecting the same monster: ", selectedMonsterId === monsterId);

  if (selectedMonsterId === monsterId) {
    deselectMonster();
    clearPathHighlights();
    return;
  }
  
  deselectMonster();
  clearPathHighlights();

  selectedMonsterId = monsterId;
  // console.log("141. Monsters object: ", monsters);
  // console.log("142. selectedMonsterId: ", selectedMonsterId);
  const { position } = selectedMonster;
  hex.classList.add("monster-selected");

  // Call the highlightValidPath function to highlight the valid path for the selected monster
  highlightValidPath(position.row, position.col);
}

function deselectMonster() {
  // If there is a selected monster, remove the selected class from it, clear the selectedMonsterId variable
  // and clear the path highlights
  clearPathHighlights();

  if (selectedMonsterId) {
    const { position } = monsters[selectedMonsterId];
    const hex = document.querySelector(`.hex[data-row="${position.row}"][data-col="${position.col}"]`);
    if (hex) {
      hex.classList.remove("monster-selected");
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
        const hex = document.querySelector(`.hex[data-row="${r}"][data-col="${c}"]`);
        if (hex) {
          hex.classList.add("highlight-path");
          hex.addEventListener("click", handleMoveClick);
        }
      }
    }
  }
}

// Function removes highlight-path class from hexes
function clearPathHighlights() {
  document.querySelectorAll(".highlight-path").forEach((hex) => {
    hex.classList.remove("highlight-path");
    hex.removeEventListener("click", handleMoveClick);
  });
}

function handleMoveClick(event) {
  console.log("214. Move clicked");
  console.log("237. monsters on move click:", monsters);

  const target = event.currentTarget;
  if (!target.classList.contains("highlight-path") || !selectedMonsterId) return;
  
  // console.log("218. Move clicked");

  // Get the row and column of the clicked hexagon
  const row = parseInt(target.dataset.row, 10);
  const col = parseInt(target.dataset.col, 10);

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
  console.log("284. End turn button clicked by user: ", userId);
  socket.send(JSON.stringify({ type: "endTurnButton" }));
})

// This function is used to create a WebSocket connection on the browser window load
// and listen for incoming messages
window.onload = () => {
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    console.log("277. Username check:", username);
    console.log("278. userId check:", userId);
    console.log("279. allPlayers check:", allPlayers);
    console.log("280. monsters on receiving message:", monsters);

    // On init message we initialize client with its userId
    if (message.type === "init") {
      console.log("Init message received", message);
      userId = message.id;
    }

    // // On sync message we update the allPlayers object and make sure all players drawn on the board
    if (message.type === "playerJoined") {
      console.log("Player joined", message);
      allPlayers = message.data.allPlayers;
      toggleControlsOverlay();
    }

    if (message.type === "start") {
      // console.log("197: Start message data object", message.data);
      monsters = message.data.monsters;
      stats = message.data.stats;
      playersTurnCompleted = message.data.playersTurnCompleted;
      console.log("310. onStart playersTurnCompleted: ", playersTurnCompleted);

      //Remove overlay here so it no longer displayed for all players
      document.getElementById('game-controls').style.display = 'none';
      // Setup the board with hexagons and add the character for every player to the starting position
      setupBoard();
      drawMonsters();
      displayPlayerStats();
      displayGameHints();
      toggleBoardAvailability();
    }

    // On update message update the monsters object and redraw monsters on the board
    if (message.type === "update") {
      console.log("Updated monsters received: ", message.monsters);
      monsters = message.monsters;
      playersTurnCompleted = message.playersTurnCompleted;
      drawMonsters();
      toggleBoardAvailability();
    }

    // On remove message we remove the character from the board and delete it from allPlayers object
    // This is used when a player disconnects and we need to remove their character from the game
    if (message.type === "gamePaused") {
      alert(`Player ${message.leftPlayerUsername} left the game! You can restart it later.`);
      window.location.href = "/me"; // Redirect to the profile page
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
  };
};

socket.onopen = () => {
  console.log("342: user: " + username);
  socket.send(JSON.stringify({
    type: "identify",
    username: username,
  }));
}
