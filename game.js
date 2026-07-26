// Updated game.js
// - TRACK_LENGTH = 20000 (20 km)
// - Sportier engine sound (two oscillators + filter + smoothing), lower volume
// - Obstacle spacing increased and obstacle count capped for performance
// - Collisions produce crash sound & particles but do NOT stop the race

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Gameplay constants (updated)
const LANES = 4;
const ROAD_W = Math.floor(W * 0.62);
const LANE_W = Math.floor(ROAD_W / LANES);
const ROAD_X = Math.floor((W - ROAD_W) / 2);
const BORDER_W = 14;

// Track: 20 km
const TRACK_LENGTH = 20000; // meters

// Visual scaling: pixels per meter (keeps visible window reasonable)
const PIXELS_PER_METER = 0.6;

// Player parameters
const PLAYER_START_SPEED = 6; // m/s-ish feel
const PLAYER_MAX_SPEED = 36;  // higher top speed for long track
const PLAYER_MIN_SPEED = 3;
const PLAYER_ACCEL = 3.2;

// AI and obstacle tuning (sparser for 20km)
const AI_BASE_SPEED = 11;
const AI_VARIATION = 3;
const AI_LANE_CHANGE_PROB = 0.14;

// Obstacles: larger gaps to reduce total obstacles on 20km track
const OBSTACLE_GAP_MIN = 400;   // meters
const OBSTACLE_GAP_MAX = 900;   // meters
const OBSTACLE_SAFE_START = 400; // first obstacle after this distance
const OBSTACLE_WIDTH = Math.floor(LANE_W * 0.6);
const OBSTACLE_HEIGHT = Math.floor(LANE_W * 0.6);
const MAX_OBSTACLES = 600;      // safety cap

// Visual & UI state
let scrollOffset = 0;
let lastTime = performance.now();
let running = true;

// Audio: sportier, smoother engine
let audioCtx = null;
let engineA = null; // low rumble
let engineB = null; // harmonic
let engineFilter = null;
let engineGain = null;
let engineNoiseGain = null;

// create a gentle distortion curve (mild warmth)
function makeDistortionCurve(amount=10){
  const n = 44100, curve = new Float32Array(n);
  const k = typeof amount === 'number' ? amount : 50;
  for (let i = 0; i < n; ++i) {
    const x = i * 2 / n - 1;
    curve[i] = (Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k)));
  }
  return curve;
}

// initialise audio nodes with a smoother sport-like profile
function ensureAudio(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // low rumble oscillator (triangle for smoother bass)
  engineA = audioCtx.createOscillator();
  engineA.type = 'triangle';

  // higher harmonic oscillator (sine or saw but low mix to avoid harshness)
  engineB = audioCtx.createOscillator();
  engineB.type = 'sine';

  // bandpass-ish filter to add character
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'bandpass';
  engineFilter.Q.value = 0.9;

  // gain smoothing
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0.0001; // start very quiet

  // optional mild distortion for sportiness
  const waveShaper = audioCtx.createWaveShaper();
  waveShaper.curve = makeDistortionCurve(5);
  waveShaper.oversample = '4x';

  // small noise/air oscillator for realism (very subtle)
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.0001;
  engineNoiseGain = noiseGain;

  // setup routing: (A + B) -> filter -> waveshaper -> gain -> dest
  const sum = audioCtx.createGain();
  sum.gain.value = 0.8;
  engineA.connect(sum);
  engineB.connect(sum);

  sum.connect(engineFilter);
  engineFilter.connect(waveShaper);
  waveShaper.connect(engineGain);

  // noise (LFO-ish high frequency) into gain for breathiness
  // create a very high frequency oscillator shaped to noise-like effect
  const hf = audioCtx.createOscillator();
  hf.type = 'square';
  hf.frequency.value = 2800; // high freq, will be heavily attenuated
  hf.connect(noiseGain);
  noiseGain.connect(engineGain);

  // final out
  engineGain.connect(audioCtx.destination);

  // start sources
  engineA.frequency.value = 100;
  engineB.frequency.value = 260;
  engineA.start();
  engineB.start();
  hf.start();
}

// map speed (m/s) to engine frequency and gain in a non-linear, sport-like way
function updateEngineSound(speed){
  if(!audioCtx) return;
  // clamp speed ratio
  const ratio = clamp(speed / PLAYER_MAX_SPEED, 0, 1);
  // RPM-like mapping: nonlinear for sporty rise
  const rpmBase = 400; // base fundamental
  const rpm = rpmBase + Math.pow(ratio, 0.85) * 7200; // 400..7600
  // Set oscillator frequencies (engineA provides low rumble, engineB harmonics)
  const aFreq = Math.max(70, rpm * 0.08);   // low band
  const bFreq = Math.max(220, rpm * 0.18);  // harmonic

  // Smoothly ramp values
  engineA.frequency.setTargetAtTime(aFreq, audioCtx.currentTime, 0.06);
  engineB.frequency.setTargetAtTime(bFreq, audioCtx.currentTime, 0.06);

  // Filter center moves with rpm to add brightness at high revs
  engineFilter.frequency.setTargetAtTime(500 + ratio * 6000, audioCtx.currentTime, 0.08);
  engineFilter.Q.setTargetAtTime(0.9 + ratio * 3.0, audioCtx.currentTime, 0.08);

  // Gain scaled so quiet at low rpm, noticeable at high rpm but not harsh
  const targetGain = clamp(0.02 + ratio * 0.22, 0.01, 0.26);
  engineGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.08);

  // subtle noise increase
  engineNoiseGain.gain.setTargetAtTime(0.0006 + ratio * 0.0016, audioCtx.currentTime, 0.08);
}

// crash sound uses short noise + pitch drop (kept same-ish)
function playCrashSound(){
  if(!audioCtx) ensureAudio();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(400, t);
  g.gain.setValueAtTime(0.5, t);
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  o.frequency.exponentialRampToValueAtTime(40, t+0.42);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.6);
  setTimeout(()=>{ try{ o.stop(); o.disconnect(); g.disconnect(); }catch(e){} }, 800);
}

// utility
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function laneCenter(i){ return ROAD_X + i * LANE_W + LANE_W/2; }
function now(){ return performance.now(); }

// create nicer car sprite (smaller)
function carSpriteDataURL(color, stripe){
  const svg = `
  <svg xmlns='http://www.w3.org/2000/svg' width='120' height='180' viewBox='0 0 120 180'>
    <defs>
      <linearGradient id='g' x1='0' x2='1'>
        <stop offset='0' stop-color='${color}' />
        <stop offset='1' stop-color='#222' stop-opacity='0.08' />
      </linearGradient>
    </defs>
    <g>
      <rect x='20' y='10' width='80' height='110' rx='12' ry='12' fill='url(#g)' stroke='#222' stroke-width='1.8'/>
      <rect x='28' y='22' width='64' height='28' rx='6' fill='#fff' opacity='0.94'/>
      <rect x='32' y='70' width='16' height='36' rx='3' fill='#0d0d0d'/>
      <rect x='72' y='70' width='16' height='36' rx='3' fill='#0d0d0d'/>
      <circle cx='44' cy='126' r='6' fill='#111'/>
      <circle cx='76' cy='126' r='6' fill='#111'/>
      ${stripe? `<rect x='58' y='14' width='4' height='86' fill='${stripe}' rx='2'/>`:''}
    </g>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// initialize four cars (player + 3 AI), player placed in lane 1 (second lane) for easier control
const carColors = ['#ffb74d','#58a0ff','#7ee1a8','#ff6b6b'];
const cars = [];
const playerInitialLane = 1; // put player in lane 1 to avoid immediate obstacles
for(let i=0;i<LANES;i++){
  const isPlayer = (i === playerInitialLane);
  const sprite = new Image();
  sprite.src = carSpriteDataURL(carColors[i], isPlayer ? '#ddb37b' : '');
  const c = {
    id: i,
    lane: i,
    x: laneCenter(i),
    y: H/2 + (i - 1.5) * 18, // slight stagger visually
    sprite,
    width: Math.floor(LANE_W * 0.46),  // smaller cars per request
    height: Math.floor(LANE_W * 0.7),
    distance: 0,
    speed: isPlayer ? PLAYER_START_SPEED : (AI_BASE_SPEED + (Math.random()*AI_VARIATION - AI_VARIATION/2)),
    accel: isPlayer ? PLAYER_ACCEL : (1.2 + Math.random()*1.4),
    maxSpeed: isPlayer ? PLAYER_MAX_SPEED : (AI_BASE_SPEED + AI_VARIATION + 2),
    finished: false,
    finishTime: null,
    isPlayer
  };
  cars.push(c);
  if(isPlayer && i !== 0){
    // swap so player is cars[0] (makes some code convenient)
    const tmp = cars[0]; cars[0] = c; cars[i] = tmp;
    cars[0].id = 0; cars[i].id = i;
  }
}

// Obstacles generation across 20km, but with cap
const obstacles = [];
(function generateObstacles(){
  let pos = OBSTACLE_SAFE_START;
  while(pos < TRACK_LENGTH - 200 && obstacles.length < MAX_OBSTACLES){
    const gap = OBSTACLE_GAP_MIN + Math.random() * (OBSTACLE_GAP_MAX - OBSTACLE_GAP_MIN);
    pos += gap;
    const lane = Math.floor(Math.random() * LANES);
    // small chance to create a cluster (skip sometimes) to keep variety
    obstacles.push({ lane, distance: Math.round(pos) });
  }
})();

// Particles for crashes
const particles = [];
function spawnParticles(x,y,count=12){
  for(let i=0;i<count;i++){
    particles.push({
      x,y,
      vx: (Math.random()-0.5)*4,
      vy: (Math.random()-0.5)*4,
      born: performance.now(),
      life: 500 + Math.random()*900,
      size: 2 + Math.random()*5
    });
  }
}
function updateParticles(dt){
  const t = performance.now();
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    const age = t - p.born;
    if(age > p.life){ particles.splice(i,1); continue; }
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    const alpha = 1 - (age / p.life);
    ctx.fillStyle = `rgba(60,60,60,${alpha})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size*alpha, 0, Math.PI*2); ctx.fill();
  }
}

// Static sides and stripes (no flicker)
function drawStaticSides(){
  ctx.fillStyle = '#7fbf6b';
  ctx.fillRect(0,0,ROAD_X, H);
  ctx.fillRect(ROAD_X + ROAD_W, 0, W - (ROAD_X + ROAD_W), H);

  // static dotted pattern left and right
  ctx.fillStyle = '#2c7a3a';
  for(let x=12; x<ROAD_X-8; x+=18){
    for(let y=12; y<H; y+=18){
      ctx.fillRect(x + ((x+y) % 6), y + ((x+y) % 8), 4, 4);
    }
  }
  for(let x=ROAD_X + ROAD_W + 8; x<W; x+=18){
    for(let y=12; y<H; y+=18){
      ctx.fillRect(x + ((x+y) % 6), y + ((x+y) % 8), 4, 4);
    }
  }

  // static side stripes
  for(let y=0;y<H;y+=28){
    ctx.fillStyle = '#fff'; ctx.fillRect(ROAD_X - BORDER_W, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828'; ctx.fillRect(ROAD_X - BORDER_W, y+14, BORDER_W, 14);
    ctx.fillStyle = '#fff'; ctx.fillRect(ROAD_X + ROAD_W, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828'; ctx.fillRect(ROAD_X + ROAD_W, y+14, BORDER_W, 14);
  }
}

// Draw road lane dashes (moving) based on playerDistance
function drawRoad(playerDistance){
  ctx.fillStyle = '#3f4448';
  ctx.fillRect(ROAD_X, 0, ROAD_W, H);

  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 6;
  ctx.setLineDash([28,18]);
  ctx.lineDashOffset = - (playerDistance * PIXELS_PER_METER) % 46;
  for(let i=1;i<LANES;i++){
    const lx = ROAD_X + i * LANE_W;
    ctx.beginPath(); ctx.moveTo(lx, -1000); ctx.lineTo(lx, H + 1000); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// Draw obstacles relative to player's distance (only visible range)
function drawObstaclesFor(playerDistance){
  const vis = Math.ceil(H / PIXELS_PER_METER) + 600;
  for(const o of obstacles){
    const delta = o.distance - playerDistance;
    if(delta < -120 || delta > vis) continue;
    const sy = H/2 - delta * PIXELS_PER_METER;
    const sx = laneCenter(o.lane);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(sx - OBSTACLE_WIDTH/2, sy - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
    ctx.strokeStyle = '#111';
    ctx.strokeRect(sx - OBSTACLE_WIDTH/2, sy - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
  }
}

// Draw cars and shadows
function drawCarsAndParticles(playerDistance, dt){
  for(const c of cars){
    const sy = H/2 - (c.distance - playerDistance) * PIXELS_PER_METER;
    // smooth lane x
    c.x += (laneCenter(c.lane) - c.x) * clamp(12 * dt, 0, 1);

    // shadow
    ctx.save(); ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(c.x, sy + c.height*0.26, c.width*0.48, c.width*0.22, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // sprite
    if(c.sprite && c.sprite.complete) ctx.drawImage(c.sprite, c.x - c.width/2, sy - c.height/2, c.width, c.height);
    else { ctx.fillStyle = '#777'; ctx.fillRect(c.x - c.width/2, sy - c.height/2, c.width, c.height); }

    // label
    if(!c.isPlayer){
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText('Car ' + (c.id+1), c.x - 20, sy - c.height/2 - 8);
    }
  }

  updateParticles(dt);
}

// HUD & finish overlay
let finishOrder = [];
let raceStart = performance.now();
let paused = false;
function drawHUD(playerDistance){
  ctx.save(); ctx.resetTransform();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(10,10,340,100);
  ctx.strokeStyle = '#123'; ctx.strokeRect(10,10,340,100);
  ctx.fillStyle = '#123'; ctx.font = '16px sans-serif'; ctx.fillText("Shaurya's Highway", 20, 34);

  const p = cars[0];
  ctx.font = '14px monospace';
  ctx.fillText('Speed: ' + Math.round(p.speed * 3.6) + ' km/h', 20, 58);
  ctx.fillText('Distance: ' + Math.round(p.distance) + 'm / ' + TRACK_LENGTH + 'm', 20, 78);

  // ranking partial
  if(finishOrder.length > 0){
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(W - 260, 10, 240, 160);
    ctx.strokeStyle = '#123'; ctx.strokeRect(W - 260, 10, 240, 160);
    ctx.fillStyle = '#123'; ctx.fillText('Finishers', W - 240, 34);
    for(let i=0;i<finishOrder.length;i++){
      const r = finishOrder[i];
      const car = cars.find(c => c.id === r.id);
      const name = car && car.isPlayer ? 'Shaurya (You)' : 'Car ' + (r.id+1);
      ctx.fillStyle = carColors[r.id % carColors.length];
      ctx.fillText(`${i+1}. ${name} - ${r.time.toFixed(2)}s`, W - 240, 56 + i*20);
    }
  }

  ctx.restore();
}

function drawFinishOverlay(){
  ctx.save(); ctx.resetTransform();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif';
  ctx.fillText('Race Results', W/2 - 80, 80);
  ctx.font = '18px monospace';
  for(let i=0;i<finishOrder.length;i++){
    const r = finishOrder[i];
    const car = cars.find(c => c.id === r.id);
    const name = car && car.isPlayer ? 'Shaurya (You)' : 'Car ' + (r.id+1);
    ctx.fillStyle = carColors[r.id % carColors.length];
    ctx.fillText(`${i+1}. ${name} — ${r.time.toFixed(2)}s`, W/2 - 140, 120 + i*28);
  }
  ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif';
  ctx.fillText('Click Restart to race again', W/2 - 110, H - 60);
  ctx.restore();
}

// update frame logic (physics, AI, collisions)
function updateFrame(dt){
  const player = cars[0];
  // player input: left/right lane change and up/down speed control
  if((keys['ArrowLeft'] || keys['a']) && player.lane > 0){
    player.lane = Math.max(0, player.lane - 1); keys['ArrowLeft'] = false; keys['a'] = false;
  }
  if((keys['ArrowRight'] || keys['d']) && player.lane < LANES - 1){
    player.lane = Math.min(LANES - 1, player.lane + 1); keys['ArrowRight'] = false; keys['d'] = false;
  }
  if(keys['ArrowUp'] || keys['w']){
    player.speed = clamp(player.speed + player.accel * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
    if(!audioCtx) ensureAudio();
  } else if(keys['ArrowDown'] || keys['s']){
    player.speed = clamp(player.speed - player.accel * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
  } else {
    player.speed = clamp(player.speed - 0.06 * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
  }

  // update each car's distance
  for(const c of cars){
    if(c.finished) continue;

    // AI behavior
    if(!c.isPlayer){
      // look ahead for obstacles in lane, attempt lane switch with small probability, or slow a bit
      const lookAhead = 140 + Math.random()*40;
      const obstacleAhead = obstacles.find(o => o.lane === c.lane && o.distance > c.distance && o.distance - c.distance < lookAhead);
      if(obstacleAhead){
        const choices = [];
        if(c.lane > 0) choices.push(c.lane - 1);
        if(c.lane < LANES - 1) choices.push(c.lane + 1);
        const safe = choices.find(l => !obstacles.some(o => o.lane === l && o.distance > c.distance && o.distance - c.distance < lookAhead));
        if(safe !== undefined && Math.random() < AI_LANE_CHANGE_PROB) c.lane = safe;
        else c.speed = Math.max(PLAYER_MIN_SPEED, c.speed - 0.9);
      }

      // approach target speed gently
      const target = c.maxSpeed - 1.0 + (Math.random() - 0.5);
      if(c.speed < target) c.speed += c.accel * dt * 25;
      else c.speed -= c.accel * dt * 10;
      c.speed = clamp(c.speed, PLAYER_MIN_SPEED, c.maxSpeed);
    }

    // advance distance (scale factor to feel fun across long track)
    c.distance += c.speed * dt * 40; // tuned scaling
    if(c.distance >= TRACK_LENGTH && !c.finished){
      c.finished = true;
      c.finishTime = (performance.now() - raceStart) / 1000;
      finishOrder.push({ id: c.id, time: c.finishTime });
    }
  }

  // collisions with obstacles (when car is close to an obstacle in same lane)
  for(const o of obstacles){
    for(const c of cars){
      if(c.finished) continue;
      const d = o.distance - c.distance;
      if(Math.abs(d) < 1.2 && o.lane === c.lane){
        // slow car, spawn particles and make small offset so it doesn't trigger repeatedly
        c.speed = Math.max(PLAYER_MIN_SPEED, c.speed * 0.72);
        spawnParticles(laneCenter(o.lane) + (Math.random()-0.5)*24, H/2 - (o.distance - cars[0].distance) * PIXELS_PER_METER + (Math.random()-0.5)*18, 12);
        if(c.isPlayer) playCrashSound();
        o.distance += 6; // move obstacle forward a bit to avoid re-trigger
      }
    }
  }

  // engine sound update for player
  if(audioCtx) updateEngineSound(player.speed);

  // if all finished, pause updates
  if(finishOrder.length === cars.length && !paused){
    finishOrder.sort((a,b) => a.time - b.time);
    paused = true;
  }
}

// draw main frame
function renderFrame(dt){
  ctx.clearRect(0,0,W,H);
  drawStaticSides();
  drawRoad(cars[0].distance);
  drawObstaclesFor(cars[0].distance);
  drawCarsAndParticles(cars[0].distance, dt);
  drawHUD(cars[0].distance);
  if(paused && finishOrder.length === cars.length) drawFinishOverlay();
}

// main loop
let last = performance.now();
let frameStarted = performance.now();
let raceStartTime = performance.now();
function mainLoop(ts){
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;

  if(!paused) updateFrame(dt);
  renderFrame(dt);

  requestAnimationFrame(mainLoop);
}

// restart button
document.getElementById('restart').addEventListener('click', ()=>{
  // reset cars
  cars.forEach((c,i)=>{
    c.distance = 0;
    c.finished = false;
    c.finishTime = null;
    c.speed = c.isPlayer ? PLAYER_START_SPEED : (AI_BASE_SPEED + (Math.random()*AI_VARIATION - AI_VARIATION/2));
    c.lane = i; // reset lane distribution
    c.x = laneCenter(c.lane);
  });
  // re-generate obstacles with cap
  obstacles.length = 0;
  (function gen(){
    let pos = OBSTACLE_SAFE_START;
    while(pos < TRACK_LENGTH - 200 && obstacles.length < MAX_OBSTACLES){
      const gap = OBSTACLE_GAP_MIN + Math.random() * (OBSTACLE_GAP_MAX - OBSTACLE_GAP_MIN);
      pos += gap;
      const lane = Math.floor(Math.random() * LANES);
      obstacles.push({ lane, distance: Math.round(pos) });
    }
  })();
  finishOrder = [];
  paused = false;
  raceStart = performance.now();
  last = performance.now();
  if(!audioCtx) ensureAudio();
  requestAnimationFrame(mainLoop);
});

// fullscreen
document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// resume audio on gesture
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

// start
last = performance.now();
raceStart = performance.now();
requestAnimationFrame(mainLoop);
