# Shaurya Racing Game

This small kid-friendly racing game is made for Shaurya and includes two Bangalore landmarks: Assetz Marq (Whitefield) and Bishop Cotton Boys (Residency Road). It's a lightweight HTML5 game that runs in a browser. An Electron wrapper is included so you can build a native executable for Windows/Mac/Linux.

This update adds:
- GitHub Actions workflow to build the app on push and upload dist/ artifacts for Windows/macOS/Linux.
- On-screen touch controls for tablets and phones.
- Simple synthesized sound effects (engine hum, crash, win) using WebAudio — no external audio files required.
- Landmark images generated as friendly inline SVGs so no external images are required. If you supply photos, I can swap them in.

Files updated/added:
- .github/workflows/build.yml — CI build and artifact upload
- index.html — touch controls added
- style.css — touch control styling
- game.js — touch, WebAudio, SVG landmarks

How the CI works
- On push to main (or manual dispatch) the workflow runs on ubuntu-latest, windows-latest, and macos-latest.
- It runs `npm ci` then `npm run dist` (electron-builder) and uploads any files in `dist/` as workflow artifacts.

Notes about codesigning and releases
- macOS and Windows signed builds require code signing credentials (certificates). If you want signed installers, add the necessary secrets (for example, for macOS: APPLE_CERT and related, for Windows: CSC_LINK and CSC_KEY_PASSWORD). The workflow uses the standard GH_TOKEN and reads any signing-related secrets if present.
- The uploaded artifacts are unsigned by default unless you configure and provide the signing secrets.

Next steps I can take for you
- Swap the inline SVG landmarks with real photos or map images if you provide them (image files or public URLs).
- Add a GitHub Releases step to attach built installers automatically and create a release tag.
- Tune the CI to run only on tags for release builds and run quick checks on PRs.

If you'd like, I can now:
- Add a workflow step that creates a GitHub Release and attaches the artifacts when a new tag is pushed.
- Replace the inline SVGs with supplied photos (just upload images or share URLs).