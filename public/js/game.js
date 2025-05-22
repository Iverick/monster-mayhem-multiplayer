let playerId = null;
// This variable is used to store all players and their positions
// Example of the object structure:
// allPlayers = { playerId: { row, col } }
// allPlayers = { 51325: { 0, 0 }, 51326: { 9, 9 } }
let allPlayers = {}; 

// Get access to the root div#board element on index.html page
// Which will be later populated with rows of hexagons
const board = document.getElementById("board");

const startButton = document.getElementById('start-button');
const waitingMessage = document.getElementById('waiting-message');

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

  // Add click event to handle selection and movement
  hex.addEventListener("click", () => {
    if (hex.classList.contains("highlight")) {
      moveCharacter(row, col);
      socket.send(JSON.stringify({
        type: "move",
        id: playerId,
        position: { row, col }
      }));
    } else {
      highlightPath(row, col);
    }
  });

  return hex;
}

// This function is used to move character of the player with the given id
// from the starting point to desired destination
function moveCharacter(row, col, id = playerId) {
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

  if (id === playerId) {
    clearPathHighlights();
  }
}

function highlightPath(row, col) {
  // Clear any previous highlights
  clearPathHighlights();

  // Get the current position of the player from allPlayers object
  // and calculate the path to the new position
  const currentPosition = allPlayers[playerId];
  const path = calculatePath(currentPosition, { row, col });
  // Select every hex from the path and apply a highlight class to them
  path.forEach((hex) => {
    const hexElement = document.querySelector(
      `.hex[data-row="${hex.row}"][data-col="${hex.col}"]`
    );
    if (hexElement) hexElement.classList.add("highlight");
  });
}

function clearPathHighlights() {
  // Function removes highlight class from hexes once the path has been changed or completed
  document.querySelectorAll(".hex.highlight").forEach((hex) => {
    hex.classList.remove("highlight");
  });
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

// This function is used to draw all players on the board
function drawAllPlayers() {
  for (const [id, position] of Object.entries(allPlayers)) {
    moveCharacter(position.row, position.col, id);
  }
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
  socket.send(JSON.stringify({ type: "start", id: playerId }));
  overlay.style.display = "none";
});

// This function is used to create a WebSocket connection on the browser window load
// and listen for incoming messages
window.onload = () => {
  socket.onmessage = (event) => {
    console.log("line 178: ", allPlayers.length);
    const message = JSON.parse(event.data);

    if (message.type === "start") {
      //Remove overlay here so it no longer displayed for all players
      document.getElementById('game-controls').style.display = 'none';
      // Setup the board with hexagons and add the character for every player to the starting position
      setupBoard();
      console.log("186: Start message received", message);
      //drawAllPlayers();
    }

    // On init message we setup the board and move player's character to its starting positions
    if (message.type === "init") {
      console.log("Init message received", message);
      playerId = message.id;
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
