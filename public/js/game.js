let userId = null;
// This variable is used to store all players and their positions
// Example of the object structure:
// allPlayers = { userId: { row, col } }
// allPlayers = { 51325: { 0, 0 }, 51326: { 9, 9 } }
let allPlayers = {};
// This variable is used to store all monsters and their positions received from the server
let monsters = {};
let selectedMonsterId = null;

// Get access to the root div#board element on index.html page
// Which will be later populated with rows of hexagons
const board = document.getElementById("board");

const startButton = document.getElementById('start-button');
const waitingMessage = document.getElementById('waiting-message');

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

  // // Add click event to handle selection and movement
  // hex.addEventListener("click", () => {
  //   if (hex.classList.contains("highlight")) {
  //     moveCharacter(row, col);
  //     socket.send(JSON.stringify({
  //       type: "move",
  //       id: userId,
  //       position: { row, col }
  //     }));
  //   } else {
  //     highlightPath(row, col);
  //   }
  // });

  return hex;
}

// This function is used to move character of the player with the given id
// from the starting point to desired destination
function moveCharacter(row, col, id = userId) {
  // Remove character class from the old position
  const hexes = document.querySelectorAll(".hex");
  hexes.forEach(hex => {
    if (hex.classList.contains(`player-${id % 2 === 0 ? 'even' : 'odd'}`)) {
      hex.classList.remove("character", "player-even", "player-odd");
    }
  });

  // Find the hexagon at the new position and add character class to it
  const hex = document.querySelector(`.hex[data-row="${row}"][data-col="${col}"]`);
  if (hex) {
    hex.classList.add("character", id % 2 === 0 ? "player-even" : "player-odd");
  }

  if (id === userId) {
    clearPathHighlights();
  }
}

function calculatePath(start, end) {
  // Function calculates path from the starting point to the end
  // Increments row and col values until we reach destination coordinates
  const path = [];
  let { row: currentRow, col: currentCol } = start;

  while (currentRow !== end.row || currentCol !== end.col) {
    if (currentRow != end.row) {
      if (currentRow < end.row) currentRow++;
      else if (currentRow > end.row) currentRow--;

      path.push({ row: currentRow, col: currentCol });
      continue;
    }

    if (currentCol !== end.col) {
      if (currentCol < end.col) currentCol++;
      else if (currentCol > end.col) currentCol--;

      path.push({ row: currentRow, col: currentCol });
      continue;
    }
  }

  return path;
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

// This function is used to draw monsters on the board
function drawMonsters() {
  for (const id in monsters) {
    const { playerId: ownerId, type, position } = monsters[id];
    console.log("151: Monster data", `{ownerId: ${ownerId}, type: ${type}, position: ${position}}`);
    const hex = document.querySelector(
      `.hex[data-row="${position.row}"][data-col="${position.col}"]`
    );
    if (hex) {
      hex.classList.add("monster", `player-${ownerId % 2 === 0 ? 'even' : 'odd'}`);
      hex.textContent = monsterIcons[type];
    }

    if (parseInt(ownerId) === parseInt(userId)) {
      hex.addEventListener("click", () => selectMonster(id, hex));
    }
  }
}

function selectMonster(monsterId, hex) {
  // If the monster is already selected, deselect it and return  
  if (selectedMonsterId === monsterId) {
    deselectMonster();
    return;
  }

  deselectMonster();
  clearPathHighlights();

  selectedMonsterId = monsterId;
  console.log("Monster selected", selectedMonsterId);
  const { position } = monsters[monsterId];
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
    selectedMonsterId = null;
  }
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

      // Highlight hexes that are valid moves
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

// This function checks if the path is blocked by an enemy monster
function isBlockedByEnemy (startRow, startCol, endRow, endCol) {
  // Find the direction of the movement from the start position to the end position
  const dRow = Math.sign(endRow - startRow);
  const dCol = Math.sign(endCol - startCol);

  // Calculate the first hexagon in the path of the start position
  let r = startRow + dRow;
  let c = startCol + dCol;

  // Loop through the hexagons in the path until we reach the end position
  while (r !== endRow || c !== endCol) {
    // Check if the hexagon is occupied by an enemy monster
    const occupied = Object.values(monsters).some(monster => 
      monster.position.row === r &&
      monster.position.col === c &&
      parseInt(monster.playerId) !== parseInt(userId)
    );
    
    if (occupied) return true;

    r += dRow;
    c += dCol;
  }

  return false;
};

// Function removes highlight-path class from hexes
function clearPathHighlights() {
  document.querySelectorAll(".highlight-path").forEach((hex) => {
    hex.classList.remove("highlight-path");
  });
}

function handleMoveClick(event) {
  console.log("Cliked on hexagon to move the monster: ", event.target);
}

// This function is used to update the UI based on the number of players
// If there are two players, the start button is enabled and waiting message is hidden
function toggleControlsOverlay() {
  const playerCount = Object.keys(allPlayers).length;
  if (playerCount >= 2) {
    startButton.disabled = false;
    startButton.classList.add('enabled');
    waitingMessage.textContent = 'Ready to start the game!';
  } else {
    startButton.disabled = true;
    startButton.classList.remove('enabled');
    waitingMessage.textContent = 'Waiting for another player to join...';
  }
}


// startButton click handler that sends a message to the server to start the game
startButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "start", id: userId }));
});

// This function is used to create a WebSocket connection on the browser window load
// and listen for incoming messages
window.onload = () => {
  socket.onmessage = (event) => {
    console.log("line 178: ", allPlayers.length);
    const message = JSON.parse(event.data);

    if (message.type === "start") {
      console.log("197: Start message data object", message.data);
      monsters = message.data.monsters;
      console.log("199: Monsters object now", monsters);
      //Remove overlay here so it no longer displayed for all players
      document.getElementById('game-controls').style.display = 'none';
      // Setup the board with hexagons and add the character for every player to the starting position
      setupBoard();
      drawMonsters();
    }

    // On init message we setup the board and move player's character to its starting positions
    if (message.type === "init") {
      console.log("Init message received", message);
      userId = message.id;
      allPlayers = message.allPlayers;
      toggleControlsOverlay();
    }

    // On sync message we update the allPlayers object and make sure all players drawn on the board
    if (message.type === "sync") {
      console.log("Sync received", message);
      allPlayers = message.allPlayers;
      toggleControlsOverlay();
    }

    // On update message we move the character to the new position and update the allPlayers object
    if (message.type === "update") {
      console.log("Update message received", message);
      allPlayers[message.id] = message.position;
      moveCharacter(message.position.row, message.position.col, message.id);
    }

    // On remove message we remove the character from the board and delete it from allPlayers object
    // This is used when a player disconnects and we need to remove their character from the game
    if (message.type === "remove") {
      const oldPosition = allPlayers[message.id];
      if (oldPosition) {
        const oldHex = document.querySelector(
          `.hex[data-row="${oldPosition.row}"][data-col="${oldPosition.col}"]`
        );
        if (oldHex) oldHex.classList.remove("character");
        delete allPlayers[message.id];
      }
    }
  };
};

socket.onopen = () => {
  console.log("227: user: " + username);
  socket.send(JSON.stringify({
    type: "identify",
    username: username,
  }));
}
