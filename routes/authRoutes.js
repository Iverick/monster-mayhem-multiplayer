const express = require("express");
const passport = require("../config/passportInit.js");
const User = require("../models/User.js");

const app = express.Router();

// Display the login form
app.get("/login", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");

  res.render("auth/login.ejs");
});

// Handle the login form submission with passport
app.post("/login", passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login"
  })
);

// Display the registration form
app.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");

  res.render("auth/register.ejs");
});

// Handle the registration form submission
app.post("/register", async (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");

  const { username, password } = req.body;

  try {
    const user = await User.register(new User({ username }), password);
    req.login(user, (err) => {
      if (err) return next(err);
      return res.redirect("/");
    });
  } catch (err) {
    // Handle registration errors (e.g., username already exists)
    console.error("Registration error:", err);
    return res.redirect("/register");
  }
});

// Logout route handler
app.post('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }

    // Destroy the session and clear the cookie
    req.session.destroy(function(err) {
      if (err) { return next(err); }

      res.clearCookie('connect.sid', { path: '/' });
      res.redirect('/login');
    });
  });
});

// Get current session details
app.get("/me", (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ msg: "Not logged in" });
  }
});

module.exports = app;
