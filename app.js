const express = require("express");
const WebSocket = require("ws");

const { PORT } = require("./config/config");

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/game", (req, res) => {
  res.render("game.ejs");
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
