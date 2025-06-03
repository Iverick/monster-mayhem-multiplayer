const express = require("express");

const app = express.Router();

app.get("/:gameId", async (req, res) => {
  if (!(req.isAuthenticated())) return res.redirect("/login");

  const { gameId } = req.params;

  res.render("game.ejs", { 
    user: req.user,
    gameId: gameId || null
  });
});

app.get("/", (req, res) => {
  if (!(req.isAuthenticated())) return res.redirect("/login");

  res.render("game.ejs", { user: req.user });
});

module.exports = app;
