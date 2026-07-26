# Shaurya Racing Game

This small kid-friendly racing game is made for Shaurya and includes two Bangalore landmarks: Assetz Marq (Whitefield) and Bishop Cotton Boys (Residency Road). It's a lightweight HTML5 game that runs in a browser. An Electron wrapper is included so you can build a native executable for Windows/Mac/Linux.

Files added:
- index.html — main game page
- style.css — styles
- game.js — game logic
- package.json & main.js — Electron wrapper and build config

How to play right away (no install):
1. Open index.html in any modern browser (Chrome/Edge/Firefox).
2. Use arrow keys (or WASD) to drive the red car.
3. Visit both landmarks (Assetz Marq and Bishop Cotton Boys), then return to the Start/Finish area to win.

How to make an executable (Windows example) using Electron builder:
1. Install Node.js (16+ recommended) and Git.
2. In the repo root run:
   npm install
3. To test in a window:
   npm start
4. To build installers for your OS (this will create a distribution):
   npm run dist
5. The generated artifacts will be in the `dist/` folder.

Notes:
- The Electron build step runs on your machine or a CI runner — this repository contains the source and build config.
- If you only want a simple executable for a kid's device, opening index.html in a browser is the quickest.

Customization: I placed the landmarks as friendly labeled boxes on the map and personalized messages for Shaurya. If you'd like actual map tiles or photos of Assetz Marq and Bishop Cotton Boys, I can add them (please confirm you have rights or provide images).

If you want, I can:
- Add simple sound effects for engine and win.
- Add a mobile-touch on-screen control overlay.
- Produce a ready-made Windows .exe by running the build for you if you enable CI with a runner or provide a build artifact location.

Enjoy driving, Shaurya!