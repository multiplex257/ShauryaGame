// Upgraded game.js - smoother physics, camera, sprite car, skid particles, nicer HUD
// Drop-in replacement for the previous game.js

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const SCREEN_W = canvas.width, SCREEN_H = canvas.height;

// World dimensions (bigger than canvas so camera can move)
const WORLD_W = 2000, WORLD_H = 1200;

// Car (physics uses velocity vector)
const car = {
  x: 220, y: WORLD_H - 220,
  angle: -Math.PI / 2,     // facing up
  speed: 0,
  vx: 0, vy: 0,
  accelPower: 0.35,
  brakePower: 0.6,
  maxSpeed: 10,
  reverseMax: -4,
  angularVelocity: 0,
  steerSpeed: 0.04,        // base steer responsiveness
  width: 48, height: 96,
  traction: 0.92,          // lateral damping
  sprite: null,
};

// Simple track path (we'll draw a curvy road)
const track = {
  // centerline poly points in world coords
  points: [
    {x: 200, y: WORLD_H - 200},
    {x: 300, y: WORLD_H - 600},
    {x: 500, y: WORLD_H - 820},
    {x: 900, y: WORLD_H - 860},
    {x: 1300, y: WORLD_H - 720},
    {x: 1600, y: WORLD_H - 420},
    {x: 1700, y: WORLD_H - 180},
  ],
  width: 240
};

// Obstacles and decorations in world coords
const obstacles = [
  {x: 520, y: WORLD_H - 700, w: 60, h: 60},
  {x: 760, y: WORLD_H - 660, w: 60, h: 40},
  {x: 1180, y: WORLD_H - 620, w: 80, h: 48},
  {x: 1500, y: WORLD_H - 420, w: 50, h: 50},
  {x: 700, y: WORLD_H - 360, w: 60, h: 60}
];

// HUD & game state
let keys = {};
let startTime = null;
let elapsed = 0;
let running = true;
let checkpointsPassed = [false, false]; // keep as before
let bestTime = localStorage.getItem('shaurya_best_time') ? parseFloat(localStorage.getItem('shaurya_best_time')) : null;
let showMessage = '';
let msgTimer = 0;

// Particles for skids/smoke
const particles = [];

// Audio
let audioCtx = null;
let engineOsc = null;
let engineGain = null;

// Bootsprite: inline SVG car (child-friendly) as data URI
function createCarSpriteDataURL() {
  const svg = `
  <svg xmlns='http://www.w3.org/2000/svg' width='120' height='240' viewBox='0 0 120 240'>
    <defs>
      <linearGradient id='g1' x1='0' x2='1'>
        <stop offset='0' stop-color='#ff6b6b'/>
        <stop offset='1' stop-color='#d32f2f'/>
      </linearGradient>
      <filter id='s' x='-50%' y='-50%' width='200%' height='200%'>
        <feDropShadow dx='0' dy='4' stdDeviation='6' flood-color='#000' flood-opacity='0.25'/>
      </filter>
    </defs>
    <g filter='url(#s)'>
      <rect x='10' y='40' rx='12' ry='12' width='100' height='160' fill='url(#g1)' stroke='#2b2b2b' stroke-width='3'/>
      <rect x='22' y='56' width='76' height='56' rx='6' fill='#fff' opacity='0.9'/>
      <rect x='22' y='120' width='22' height='24' rx='4' fill='#222'/>
      <rect x='76' y='120' width='22' height='24' rx='4' fill='#222'/>
      <circle cx='30' cy='200' r='10' fill='#111'/>
      <circle cx='90' cy='200' r='10' fill='#111'/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Load sprite image
(function loadSprite(){
  const img = new Image();
  img.src = createCarSpriteDataURL();
  img.onload = () => { car.sprite = img; };
})();

// Utility
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }

// Simple audio setup (engine hum)
function ensureAudio(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.frequency.value = 80;
  engineOsc.start();
}

// Particle helper
function spawnParticle(x,y,vx,vy,life, size, color){
  particles.push({x,y,vx,vy,life,age:0,size,color});
}

// Input
window.addEventListener('keydown', e => { keys[e.key] = true; if(!audioCtx) ensureAudio(); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch buttons: reuse existing touch-controls buttons (they set data-key)
document.getElementById('touchControls')?.addEventListener('touchstart', e => { e.preventDefault(); for(const t of e.changedTouches){ const el = document.elementFromPoint(t.clientX, t.clientY); if(el && el.dataset && el.dataset.key) keys[el.dataset.key] = true; if(!audioCtx) ensureAudio(); } }, {passive:false});
document.getElementById('touchControls')?.addEventListener('touchend', e => { e.preventDefault(); for(const t of e.changedTouches){ const el = document.elementFromPoint(t.clientX, t.clientY); if(el && el.dataset && el.dataset.key) keys[el.dataset.key] = false; } }, {passive:false});
document.getElementById('touchControls')?.addEventListener('mousedown', e => { const el = e.target.closest('.tc-btn'); if(el && el.dataset && el.dataset.key) keys[el.dataset.key] = true; if(!audioCtx) ensureAudio(); });
document.getElementById('touchControls')?.addEventListener('mouseup', e => { const el = e.target.closest('.tc-btn'); if(el && el.dataset && el.dataset.key) keys[el.dataset.key] = false; });

// Basic collision util (AABB)
function aabbOverlap(a,b){
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

// Draw world to an offscreen transform: camera follows car
function worldToScreen(wx, wy, cam){ return { x: wx - cam.x + SCREEN_W/2, y: wy - cam.y + SCREEN_H/2 }; }

// Road drawing (draw wide textured lane with center dashed line)
function drawRoad(cam){
  // draw a large faded background for road area
  ctx.save();
  // draw the road shape by creating a thick polyline path around centerline
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // Draw road asphalt (thick stroke along centerline)
  ctx.strokeStyle = '#2f3b4a';
  ctx.lineWidth = track.width;
  ctx.beginPath();
  for(let i=0;i<track.points.length;i++){
    const p = track.points[i];
    const s = worldToScreen(p.x, p.y, cam);
    if(i===0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  // road edge highlight
  ctx.strokeStyle = '#4a5768';
  ctx.lineWidth = track.width - 18;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for(let i=0;i<track.points.length;i++){
    const p = track.points[i];
    const s = worldToScreen(p.x, p.y, cam);
    if(i===0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // center dashed line
  ctx.strokeStyle = '#ffd';
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 16]);
  ctx.beginPath();
  for(let i=0;i<track.points.length;i++){
    const p = track.points[i];
    const s = worldToScreen(p.x, p.y, cam);
    if(i===0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

// Draw obstacles
function drawObstacles(cam){
  for(const o of obstacles){
    const s = worldToScreen(o.x, o.y, cam);
    ctx.fillStyle = '#6b8';
    ctx.fillRect(s.x - o.w/2, s.y - o.h/2, o.w, o.h);
    ctx.strokeStyle = '#374';
    ctx.strokeRect(s.x - o.w/2, s.y - o.h/2, o.w, o.h);
  }
}

// HUD: speedometer and time
function drawHUD(){
  // speed
  ctx.save();
  ctx.resetTransform();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeStyle = '#035';
  ctx.lineWidth = 2;
  ctx.fillRect(12, 12, 220, 72);
  ctx.strokeRect(12,12,220,72);
  ctx.fillStyle = '#033';
  ctx.font = '16px sans-serif';
  ctx.fillText('Shaurya Race', 20, 34);

  ctx.font = '14px monospace';
  ctx.fillText('Speed: ' + Math.round(Math.hypot(car.vx, car.vy) * 10) + ' km/h', 20, 58);

  ctx.fillText('Time: ' + elapsed.toFixed(2) + 's', 120, 58);

  if(bestTime) ctx.fillText('Best: ' + bestTime.toFixed(2) + 's', 20, 78);
  ctx.restore();

  // message
  if(msgTimer > 0){
    ctx.save();
    ctx.resetTransform();
    ctx.fillStyle = 'rgba(4,80,120,0.92)';
    ctx.fillRect(SCREEN_W/2 - 200, 20, 400, 36);
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.fillText(showMessage, SCREEN_W/2 - ctx.measureText(showMessage).width/2, 44);
    ctx.restore();
  }
}

// Particle update/draw
function updateParticles(dt, cam){
  for(let i = particles.length-1; i >= 0; i--){
    const p = particles[i];
    p.vx *= 0.995; p.vy *= 0.995;
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    p.age += dt;
    if(p.age > p.life) particles.splice(i,1);
  }

  // draw
  for(const p of particles){
    const s = worldToScreen(p.x, p.y, cam);
    const alpha = 1 - (p.age / p.life);
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.size * (1 - p.age/p.life), 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// Camera: smooth follow
const camera = { x: car.x, y: car.y };
function updateCamera(dt){
  camera.x = lerp(camera.x, car.x, 0.06);
  camera.y = lerp(camera.y, car.y, 0.06);
}

// Engine sound update
function updateEngineSound(){
  if(!audioCtx) return;
  const speed = Math.hypot(car.vx, car.vy);
  const freq = 80 + (speed / car.maxSpeed) * 700;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.08);
  const gainTarget = Math.min(0.24, 0.02 + (speed / car.maxSpeed) * 0.2);
  engineGain.gain.setTargetAtTime(gainTarget, audioCtx.currentTime, 0.08);
}

// Game update physics
function update(dt){
  if(!running) return;
  // Inputs
  const accelInput = (keys['ArrowUp'] || keys['w']) ? 1 : 0;
  const brakeInput = (keys['ArrowDown'] || keys['s']) ? 1 : 0;
  const left = (keys['ArrowLeft'] || keys['a']) ? 1 : 0;
  const right = (keys['ArrowRight'] || keys['d']) ? 1 : 0;

  // Forward acceleration (based on car angle)
  const forwardAx = Math.cos(car.angle) * (accelInput * car.accelPower - brakeInput * car.brakePower);
  const forwardAy = Math.sin(car.angle) * (accelInput * car.accelPower - brakeInput * car.brakePower);

  // Add acceleration to velocity
  car.vx += forwardAx * dt * 60;
  car.vy += forwardAy * dt * 60;

  // Speed clamp
  const localSpeed = Math.hypot(car.vx, car.vy);
  if(localSpeed > car.maxSpeed){
    const scale = car.maxSpeed / localSpeed;
    car.vx *= scale; car.vy *= scale;
  }
  if(localSpeed < Math.abs(car.reverseMax) && accelInput === 0 && brakeInput === 0){
    // small friction
    car.vx *= 0.995; car.vy *= 0.995;
  }

  // Steering: stronger when moving forward, less when slow
  const speedFactor = clamp(localSpeed / car.maxSpeed, 0, 1);
  const steer = (right - left) * car.steerSpeed * (0.4 + 1.2 * speedFactor);
  car.angle += steer * dt * 60;

  // Traction: reduce lateral velocity relative to car heading
  // compute car heading unit vector
  const hx = Math.cos(car.angle), hy = Math.sin(car.angle);
  // forward speed component
  const forward = car.vx * hx + car.vy * hy;
  // lateral speed component
  const lateral = -car.vx * hy + car.vy * hx;
  // damp lateral by traction
  const newLateral = lateral * car.traction;
  // reconstruct vx, vy
  car.vx = forward * hx - newLateral * hy;
  car.vy = forward * hy + newLateral * hx;

  // Update position
  car.x += car.vx * dt * 60;
  car.y += car.vy * dt * 60;

  // Boundaries: clamp inside world with bounce
  if(car.x < 30){ car.x = 30; car.vx *= -0.4; spawnParticle(car.x+10, car.y, -car.vx*0.2, 0, 0.6, 8, 'rgba(0,0,0,0.5)'); }
  if(car.x > WORLD_W - 30){ car.x = WORLD_W - 30; car.vx *= -0.4; spawnParticle(car.x-10, car.y, -car.vx*0.2, 0, 0.6, 8, 'rgba(0,0,0,0.5)'); }
  if(car.y < 30){ car.y = 30; car.vy *= -0.4; spawnParticle(car.x, car.y+10, 0, -car.vy*0.2, 0.6, 8, 'rgba(0,0,0,0.5)'); }
  if(car.y > WORLD_H - 30){ car.y = WORLD_H - 30; car.vy *= -0.4; spawnParticle(car.x, car.y-10, 0, -car.vy*0.2, 0.6, 8, 'rgba(0,0,0,0.5)'); }

  // Collisions with obstacles
  for(const o of obstacles){
    const rect = { x: o.x - o.w/2, y: o.y - o.h/2, w: o.w, h: o.h };
    const carBox = { x: car.x - car.width/3, y: car.y - car.height/3, w: car.width/1.5, h: car.height/1.5 };
    if(aabbOverlap(rect, carBox)){
      // simple pushback: reflect velocity and spawn particles
      car.vx *= -0.45; car.vy *= -0.45;
      car.x += car.vx * 6; car.y += car.vy * 6;
      spawnParticle(car.x, car.y, -car.vx*0.05, -car.vy*0.05, 0.8, 12, 'rgba(80,80,80,0.8)');
      showTempMessage('Ouch! Be careful.');
    }
  }

  // Skid particles when turning hard or braking
  if(Math.abs(steer) > 0.03 && localSpeed > 3){
    // left or right tyres smoke
    const sign = Math.sign(steer);
    // world coords for tyres (slightly behind the car center)
    const tyreOffsetX = car.x - hx * 10;
    const tyreOffsetY = car.y - hy * 10;
    for(let i=0;i<2;i++){
      const side = (i===0) ? 14 : -14;
      const tx = tyreOffsetX + (-hy*side);
      const ty = tyreOffsetY + (hx*side);
      spawnParticle(tx, ty, -car.vx*0.02 + (Math.random()-0.5)*0.3, -car.vy*0.02 + (Math.random()-0.5)*0.3, 0.8, 6 + Math.random()*4, 'rgba(30,30,30,0.7)');
    }
  }
  if(brakeInput && Math.hypot(car.vx,car.vy) > 4){
    // brake smoke
    spawnParticle(car.x - hx*18, car.y - hy*18, -car.vx*0.05 + (Math.random()-0.5)*0.5, -car.vy*0.05 + (Math.random()-0.5)*0.5, 0.8, 8, 'rgba(50,50,60,0.9)');
    spawnParticle(car.x + hy*18, car.y - hx*18, -car.vx*0.05 + (Math.random()-0.5)*0.5, -car.vy*0.05 + (Math.random()-0.5)*0.5, 0.8, 6, 'rgba(50,50,60,0.9)');
  }

  // update timers and audio
  elapsed = (performance.now() - startTime) / 1000;
  if(audioCtx) updateEngineSound();
}

// Simple message display
function showTempMessage(t, time = 1600){
  showMessage = t; msgTimer = time / 16;
}

// Draw everything
function draw(cam){
  // Clear background (sky)
  ctx.save();
  ctx.fillStyle = '#bfe7ff';
  ctx.fillRect(0,0,SCREEN_W,SCREEN_H);

  // subtle ground gradient
  ctx.fillStyle = 'linear-gradient(#dff3ff,#cfe8ff)';

  // draw road and world objects in world coords transformed by camera
  drawRoad(cam);
  drawObstacles(cam);

  // draw track-side grass/decor
  // (decorate sides with green)
  ctx.globalCompositeOperation = 'destination-over';

  // draw particles (skid smoke) under car for depth
  updateParticles(1/60, cam);

  // draw car (sprite) at center of camera screen relative to car world coords
  // compute car screen position
  const carScr = worldToScreen(car.x, car.y, cam);
  ctx.save();
  ctx.translate(carScr.x, carScr.y);
  ctx.rotate(car.angle + Math.PI/2); // sprite default faces up -> adjust if needed

  // draw shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, car.height*0.24, car.width*0.5, car.width*0.2, 0, 0, Math.PI*2);
  ctx.fill();

  // draw sprite (if loaded) otherwise draw fallback car
  if(car.sprite){
    const sx = -car.width/2, sy = -car.height/2;
    ctx.drawImage(car.sprite, sx, sy, car.width, car.height);
  } else {
    ctx.fillStyle = '#e53935';
    ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
  }

  ctx.restore();

  // draw particles above car
  updateParticles(1/60, cam);

  // HUD
  drawHUD();

  ctx.restore();
}

// Game loop
let last = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now - last)/1000);
  last = now;
  if(startTime === null) startTime = performance.now();

  update(dt);
  updateCamera(dt);

  // clear canvas
  ctx.clearRect(0,0,SCREEN_W,SCREEN_H);
  draw(camera);

  // messages timer
  if(msgTimer > 0){ msgTimer--; } else { showMessage = ''; }

  requestAnimationFrame(loop);
}

// Start
function startGame(){
  startTime = performance.now();
  running = true;
  last = performance.now();
  requestAnimationFrame(loop);
}

// Buttons
document.getElementById('restart').addEventListener('click', ()=>{
  car.x = 220; car.y = WORLD_H - 220; car.vx = car.vy = 0; car.angle = -Math.PI/2;
  startTime = performance.now(); elapsed = 0; running = true; showTempMessage('Restarted! Drive safely, Shaurya', 1400);
});
document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// On win (for parity with previous logic) - we treat passing two checkpoints then return to start as example
// For now keep placeholders (you can add real checkpoint positions later)
startGame();
showTempMessage('Welcome Shaurya! Drive with arrow keys or touch buttons.', 2200);

// store best time if win later (example helper)
function onWin(){
  running = false;
  const t = elapsed;
  if(!bestTime || t < bestTime){
    bestTime = t;
    localStorage.setItem('shaurya_best_time', bestTime);
  }
  showTempMessage(`Congratulations Shaurya! Finished in ${t.toFixed(2)}s`, 4000);
}

// Small safety: resume audio on first touch/click for mobile autoplay blocked policies
function resumeAudioOnGesture(){
  if(!audioCtx) return;
  if(audioCtx.state === 'suspended'){
    const resume = () => { audioCtx.resume().catch(()=>{}); window.removeEventListener('pointerdown', resume); window.removeEventListener('touchstart', resume); };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('touchstart', resume);
  }
}
window.addEventListener('pointerdown', ()=>{ if(!audioCtx) ensureAudio(); resumeAudioOnGesture(); }, {once:true});
window.addEventListener('touchstart', ()=>{ if(!audioCtx) ensureAudio(); resumeAudioOnGesture(); }, {once:true});
