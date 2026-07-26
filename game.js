// game.js - 4-lane 2km highway racer with engine sound, AI opponents, crash handling, and finish ranking
// Replace your existing game.js with this file.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Gameplay constants
const LANES = 4;
const ROAD_W = Math.floor(W * 0.62);
const LANE_W = Math.floor(ROAD_W / LANES);
const ROAD_X = Math.floor((W - ROAD_W) / 2);
const BORDER_W = 14;
const TRACK_LENGTH = 2000; // meters (2 km)
const PIXELS_PER_METER = 0.6; // visual scale for distance -> pixels

// Player car settings (meters / second style feel)
const PLAYER_START_SPEED = 6; // m/s-ish; feel free to tune
const PLAYER_MAX_SPEED = 32;
const PLAYER_MIN_SPEED = 3;
const PLAYER_ACCEL = 3.0; // m/s^2 equivalent for feel

// AI settings (easy level defaults)
const AI_BASE_SPEED = 10; // avg m/s for opponents
const AI_VARIATION = 3;   // variation above/below base
const AI_LANE_CHANGE_PROB = 0.18; // chance AI will attempt lane change when safe

// Obstacles (placed along track distance)
const OBSTACLE_GAP_MIN = 140; // meters
const OBSTACLE_GAP_MAX = 260;
const OBSTACLE_SAFE_START = 200; // first obstacle after this distance
const OBSTACLE_WIDTH = Math.floor(LANE_W * 0.6);
const OBSTACLE_HEIGHT = Math.floor(LANE_W * 0.6);

// Visual & UI state
let scrollOffset = 0; // for lane dash animation
let lastTime = performance.now();
let running = true;

// Audio
let audioCtx = null, engineOsc = null, engineGain = null;
function ensureAudio(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  engineOsc = audioCtx.createOscillator(); engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain(); engineGain.gain.value = 0;
  engineOsc.connect(engineGain); engineGain.connect(audioCtx.destination);
  engineOsc.frequency.value = 120; engineOsc.start();
}
function updateEngineSound(speed){
  if(!audioCtx) return;
  const freq = 120 + (speed / PLAYER_MAX_SPEED) * 1200;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.06);
  const gainT = Math.min(0.26, 0.02 + (speed / PLAYER_MAX_SPEED) * 0.22);
  engineGain.gain.setTargetAtTime(gainT, audioCtx.currentTime, 0.06);
}
function playCrashSound(){
  if(!audioCtx) ensureAudio();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type='square'; o.frequency.setValueAtTime(500, t);
  g.gain.setValueAtTime(0.45, t);
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  o.frequency.exponentialRampToValueAtTime(60, t+0.4);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.6);
  setTimeout(()=>{ try{ o.stop(); o.disconnect(); g.disconnect(); }catch(e){} }, 900);
}

// utility
function laneCenter(i){ return ROAD_X + i * LANE_W + LANE_W/2; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function now(){ return performance.now(); }

// generate nicer car SVG inline sprite (small/pixel-friendly)
function carSpriteDataURL(color, stripe){
  const svg = `
  <svg xmlns='http://www.w3.org/2000/svg' width='120' height='180' viewBox='0 0 120 180'>
    <defs>
      <linearGradient id='g' x1='0' x2='1'>
        <stop offset='0' stop-color='${color}' />
        <stop offset='1' stop-color='#222' stop-opacity='0.12' />
      </linearGradient>
    </defs>
    <g>
      <rect x='18' y='10' width='84' height='120' rx='12' ry='12' fill='url(#g)' stroke='#222' stroke-width='2'/>
      <rect x='26' y='22' width='68' height='36' rx='6' fill='#fff' opacity='0.95'/>
      <rect x='30' y='70' width='18' height='40' rx='4' fill='#0d0d0d'/>
      <rect x='72' y='70' width='18' height='40' rx='4' fill='#0d0d0d'/>
      <circle cx='42' cy='138' r='8' fill='#111'/>
      <circle cx='78' cy='138' r='8' fill='#111'/>
      ${stripe? `<rect x='56' y='14' width='8' height='96' fill='${stripe}' rx='3'/>`:''}
    </g>
  </svg>
  `;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// initialize 4 cars (player + 3 AI)
const carColors = ['#ffb74d','#58a0ff','#7ee1a8','#ff6b6b']; // four different colors
const cars = [];
for(let i=0;i<LANES;i++){
  const isPlayer = (i===Math.floor(LANES/2)); // place player in middle lane initially
  const sprite = new Image();
  sprite.src = carSpriteDataURL(carColors[i], i===0? '#ddb37b' : '');
  const car = {
    id: i,
    lane: i, // initial lane assignment: one car per lane
    x: laneCenter(i),
    y: H - 200 + ((i - 1.5) * 14), // slight vertical offset so cars are staggered visually
    sprite,
    width: Math.floor(LANE_W * 0.48), // reduced size
    height: Math.floor(LANE_W * 0.8),
    distance: 0, // meters traveled along track (0 start)
    speed: isPlayer ? PLAYER_START_SPEED : AI_BASE_SPEED + (Math.random()*AI_VARIATION - AI_VARIATION/2),
    accel: isPlayer ? PLAYER_ACCEL : (1.2 + Math.random()*1.6),
    maxSpeed: isPlayer ? PLAYER_MAX_SPEED : (AI_BASE_SPEED + AI_VARIATION + 2),
    finished: false,
    finishTime: null,
    isPlayer: isPlayer
  };
  cars.push(car);
  if(isPlayer) { // ensure player is index 0 for convenience
    // swap index 0 and this index
    if(i !== 0){
      cars[i] = cars[0];
      cars[0] = car;
      // fix ids
      cars[0].id = 0; cars[i].id = i;
    }
  }
}

// obstacles array: each obstacle: {lane, distance}
const obstacles = [];
(function placeObstacles(){
  let pos = OBSTACLE_SAFE_START;
  while(pos < TRACK_LENGTH - 150){
    const gap = OBSTACLE_GAP_MIN + Math.random() * (OBSTACLE_GAP_MAX - OBSTACLE_GAP_MIN);
    pos += gap;
    const lane = Math.floor(Math.random()*LANES);
    obstacles.push({lane, distance: Math.round(pos)});
  }
})();

// UI state
let raceStartTime = performance.now();
let finishOrder = []; // [{id, time}]
let paused = false;

// input handling
let keys = {};
window.addEventListener('keydown', e=>{ keys[e.key] = true; if(!audioCtx) ensureAudio(); });
window.addEventListener('keyup', e=>{ keys[e.key] = false; });

// touch buttons (reusing existing controls)
const tc = document.getElementById('touchControls');
if(tc){
  tc.addEventListener('touchstart', e=>{
    e.preventDefault();
    for(const t of e.changedTouches){
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if(!el) continue;
      const k = el.dataset && el.dataset.key;
      if(k) keys[k] = true;
      if(!audioCtx) ensureAudio();
    }
  }, {passive:false});
  tc.addEventListener('touchend', e=>{
    e.preventDefault();
    for(const t of e.changedTouches){
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if(!el) continue;
      const k = el.dataset && el.dataset.key;
      if(k) keys[k] = false;
    }
  }, {passive:false});
  tc.addEventListener('mousedown', e=>{
    const el = e.target.closest('.tc-btn');
    if(!el) return;
    const k = el.dataset && el.dataset.key;
    if(k){ keys[k] = true; if(!audioCtx) ensureAudio(); }
  });
  tc.addEventListener('mouseup', e=>{
    const el = e.target.closest('.tc-btn');
    if(!el) return;
    const k = el.dataset && el.dataset.key;
    if(k) keys[k] = false;
  });
}

// particles
const particles = [];
function spawnParticles(x,y,count=8){
  for(let i=0;i<count;i++){
    particles.push({
      x,y,
      vx: (Math.random()-0.5) * 4,
      vy: (Math.random()-0.5) * 4,
      born: performance.now(),
      life: 500 + Math.random()*900,
      size: 2 + Math.random()*6
    });
  }
}
function updateParticles(dt){
  const t = performance.now();
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    const age = t - p.born;
    if(age > p.life) { particles.splice(i,1); continue; }
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    const alpha = 1 - (age / p.life);
    ctx.fillStyle = `rgba(60,60,60,${alpha})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size*alpha, 0, Math.PI*2); ctx.fill();
  }
}

// rendering helpers
function drawStaticSides(){
  // grass left
  ctx.fillStyle = '#7fbf6b';
  ctx.fillRect(0,0,ROAD_X, H);
  // grass right
  ctx.fillStyle = '#7fbf6b';
  ctx.fillRect(ROAD_X + ROAD_W, 0, W - (ROAD_X + ROAD_W), H);

  // static dotted pattern (deterministic positions)
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

  // side border stripes static
  for(let y=0;y<H;y+=28){
    ctx.fillStyle = '#fff'; ctx.fillRect(ROAD_X - BORDER_W, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828'; ctx.fillRect(ROAD_X - BORDER_W, y+14, BORDER_W, 14);
    ctx.fillStyle = '#fff'; ctx.fillRect(ROAD_X + ROAD_W, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828'; ctx.fillRect(ROAD_X + ROAD_W, y+14, BORDER_W, 14);
  }
}

function drawRoad(playerDistance){
  // road base
  ctx.fillStyle = '#4a4f56';
  ctx.fillRect(ROAD_X, 0, ROAD_W, H);

  // lane dividers move according to playerDistance (so dashes scroll)
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 6;
  ctx.setLineDash([28, 18]);
  ctx.lineDashOffset = - (playerDistance * PIXELS_PER_METER) % 46;
  for(let i=1;i<LANES;i++){
    const lx = ROAD_X + i*LANE_W;
    ctx.beginPath(); ctx.moveTo(lx, -1000); ctx.lineTo(lx, H + 1000); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// draw obstacle markers near player view (render only those within visible distance)
function drawObstaclesFor(playerDistance){
  // render obstacles within +/- 600 meters from player
  const visibleMeters = Math.ceil((H / PIXELS_PER_METER)) + 150;
  for(const o of obstacles){
    const delta = o.distance - playerDistance;
    if(delta < -60 || delta > visibleMeters) continue;
    const screenY = H/2 - delta * PIXELS_PER_METER;
    const cx = laneCenter(o.lane);
    ctx.fillStyle = '#333';
    ctx.fillRect(cx - OBSTACLE_WIDTH/2, screenY - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
    ctx.strokeStyle = '#222'; ctx.strokeRect(cx - OBSTACLE_WIDTH/2, screenY - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
  }
}

// main draw per frame
function drawFrame(dt, playerDistance){
  ctx.clearRect(0,0,W,H);
  drawStaticSides();
  drawRoad(playerDistance);
  // draw obstacles relative to playerDistance
  drawObstaclesFor(playerDistance);

  // draw cars: each car's screen y depends on (car.distance - playerDistance)
  for(const c of cars){
    const dy = (c.distance - playerDistance);
    const screenY = H/2 - dy * PIXELS_PER_METER;
    // smooth lane x towards lane center
    c.x += (laneCenter(c.lane) - c.x) * clamp(12 * dt, 0, 1);
    // draw shadow
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(c.x, screenY + c.height*0.28, c.width*0.5, c.width*0.24, 0, 0, Math.PI*2);
    ctx.fill(); ctx.restore();

    // draw sprite
    if(c.sprite && c.sprite.complete){
      ctx.drawImage(c.sprite, c.x - c.width/2, screenY - c.height/2, c.width, c.height);
    } else {
      ctx.fillStyle = '#999';
      ctx.fillRect(c.x - c.width/2, screenY - c.height/2, c.width, c.height);
    }
    // if this is the player, draw a small indicator
    if(c.isPlayer){
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(c.x - c.width/2 - 4, screenY - c.height/2 - 4, c.width + 8, c.height + 8);
    }
  }

  // particles
  updateParticles(dt);

  // HUD & progress
  drawHUD(playerDistance);
}

// HUD draws speed/progress/time and ranking when finished
function drawHUD(playerDistance){
  ctx.save();
  ctx.resetTransform();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(10,10,320,86);
  ctx.strokeStyle = '#123'; ctx.strokeRect(10,10,320,86);
  ctx.fillStyle = '#123'; ctx.font = '16px sans-serif';
  ctx.fillText("Shaurya's Highway", 18, 32);

  const player = cars[0];
  ctx.font = '14px monospace';
  ctx.fillText('Speed: ' + Math.round(player.speed * 3.6) + ' km/h', 18, 56); // approximate mapping m/s -> km/h
  ctx.fillText('Distance: ' + Math.round(player.distance) + 'm / ' + TRACK_LENGTH + 'm', 18, 76);

  // If there are finishers, show partial ranking
  if(finishOrder.length > 0){
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(W - 220, 10, 210, 140);
    ctx.strokeStyle = '#123'; ctx.strokeRect(W - 220, 10, 210, 140);
    ctx.fillStyle = '#123'; ctx.fillText('Rankings', W - 200, 32);
    for(let i=0;i<finishOrder.length;i++){
      const r = finishOrder[i];
      const c = cars.find(x => x.id === r.id);
      ctx.fillText(`${i+1}. ${c ? (c.isPlayer ? 'Shaurya (You)' : 'Car '+(r.id+1)) : 'Car'+(r.id+1)} - ${r.time.toFixed(2)}s`, W - 200, 54 + i*18);
    }
  }
  ctx.restore();
}

// Engine: update physics per frame
function updateFrame(dt){
  // Player input:
  const player = cars[0];
  // lane change left/right on key press (instant lane change) - keep easy for 8-year-old
  if((keys['ArrowLeft'] || keys['a']) && player.lane > 0){
    player.lane = Math.max(0, player.lane - 1);
    keys['ArrowLeft'] = false; keys['a'] = false;
  }
  if((keys['ArrowRight'] || keys['d']) && player.lane < LANES - 1){
    player.lane = Math.min(LANES - 1, player.lane + 1);
    keys['ArrowRight'] = false; keys['d'] = false;
  }
  // accelerate / decelerate
  if(keys['ArrowUp'] || keys['w']){
    player.speed = clamp(player.speed + player.accel * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
    if(!audioCtx) ensureAudio();
  } else if(keys['ArrowDown'] || keys['s']){
    player.speed = clamp(player.speed - player.accel * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
  } else {
    // slight friction
    player.speed = clamp(player.speed - 0.06 * dt * 60, PLAYER_MIN_SPEED, PLAYER_MAX_SPEED);
  }

  // Update each car: distance = speed * dt (approx)
  for(const c of cars){
    if(c.finished) continue;
    // AI behavior
    if(!c.isPlayer){
      // Simple AI: attempt to maintain a target speed (randomized slightly) and avoid obstacles
      let target = c.maxSpeed - (1 + Math.random()*1.2);
      // if obstacle ahead in same lane within 120m, try to change lane or slow
      const lookAhead = 110 + Math.random()*30;
      const obsAhead = obstacles.find(o => o.lane === c.lane && o.distance > c.distance && o.distance - c.distance < lookAhead);
      if(obsAhead){
        // attempt lane change
        const choices = [];
        if(c.lane > 0) choices.push(c.lane - 1);
        if(c.lane < LANES - 1) choices.push(c.lane + 1);
        // pick a safe lane (no obstacle within lookAhead in that lane)
        const safe = choices.find(l => !obstacles.some(o => o.lane === l && o.distance > c.distance && o.distance - c.distance < lookAhead));
        if(safe !== undefined && Math.random() < (AI_LANE_CHANGE_PROB + 0.15)) c.lane = safe;
        else target = Math.max(PLAYER_MIN_SPEED, c.speed - 1.6); // slow a bit
      }
      // gently approach target speed
      if(c.speed < target) c.speed += c.accel * dt * 30;
      else c.speed -= c.accel * dt * 20;
      c.speed = clamp(c.speed, PLAYER_MIN_SPEED, c.maxSpeed);
    }

    // advance distance
    c.distance += c.speed * dt * 40; // scale factor to make pacing fun
    if(c.distance >= TRACK_LENGTH && !c.finished){
      c.finished = true;
      c.finishTime = (performance.now() - raceStartTime) / 1000;
      finishOrder.push({id: c.id, time: c.finishTime});
    }
  }

  // If all finished, show final ranking and stop updating speeds
  if(finishOrder.length === cars.length && !paused){
    // sort by recorded times
    finishOrder.sort((a,b)=> a.time - b.time);
    paused = true;
  }

  // Collision detection: if any car is within obstacle and same lane at close distance, apply crash effects
  for(const o of obstacles){
    // check each car
    for(const c of cars){
      if(c.finished) continue;
      const d = o.distance - c.distance;
      // when obstacle is close ahead (within 1.2 meters margin in render scale) and in same lane
      if(Math.abs(d) < 2.0 && o.lane === c.lane){
        // collision occurs: slow car a bit, spawn effects, play sound if player
        c.speed = Math.max(PLAYER_MIN_SPEED, c.speed * 0.7);
        spawnParticles(laneCenter(o.lane) + (Math.random()-0.5)*20, H/2 - (o.distance - cars[0].distance) * PIXELS_PER_METER + (Math.random()-0.5)*10, 10);
        if(c.isPlayer) playCrashSound();
        // move obstacle slightly forward to avoid repeated triggers
        o.distance += 6;
      }
    }
  }

  // update engine sound for player
  if(audioCtx) updateEngineSound(player.speed);

  // scroll offset for lane dash animation
  scrollOffset = (cars[0].distance * PIXELS_PER_METER) % 46;
}

// draw main loop
function frame(){
  const t = performance.now();
  const dt = Math.min(0.05, (t - lastTime) / 1000);
  lastTime = t;
  if(!paused){
    updateFrame(dt);
  }
  drawFrame(dt, cars[0].distance);
  // if paused and all finished, draw final overlay
  if(paused && finishOrder.length === cars.length){
    drawFinishOverlay();
  }
  requestAnimationFrame(frame);
}

// show finish overlay
function drawFinishOverlay(){
  ctx.save();
  ctx.resetTransform();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
  ctx.fillText('Race Results', W/2 - 70, 90);
  ctx.font = '18px monospace';
  for(let i=0;i<finishOrder.length;i++){
    const r = finishOrder[i];
    const c = cars.find(cc => cc.id === r.id);
    const name = c.isPlayer ? 'Shaurya (You)' : 'Car ' + (r.id+1);
    ctx.fillStyle = carColors[r.id % carColors.length];
    ctx.fillText(`${i+1}. ${name} — ${r.time.toFixed(2)}s`, W/2 - 140, 130 + i*28);
  }
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('Click Restart to play again', W/2 - 100, H - 60);
  ctx.restore();
}

// draw frame uses cars array
function drawFrame(dt, playerDistance){
  ctx.clearRect(0,0,W,H);
  drawStaticSides();
  drawRoad(playerDistance);

  // obstacles rendering
  drawObstaclesFor(playerDistance);

  // draw cars (y position relative to player's distance)
  for(const c of cars){
    const screenY = H/2 - (c.distance - playerDistance) * PIXELS_PER_METER;
    // smooth x toward lane center
    c.x += (laneCenter(c.lane) - c.x) * clamp(12 * dt, 0, 1);
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(c.x, screenY + c.height*0.26, c.width*0.48, c.width*0.2, 0, 0, Math.PI*2);
    ctx.fill(); ctx.restore();

    // car sprite (centered)
    if(c.sprite && c.sprite.complete) ctx.drawImage(c.sprite, c.x - c.width/2, screenY - c.height/2, c.width, c.height);
    else { ctx.fillStyle = '#777'; ctx.fillRect(c.x - c.width/2, screenY - c.height/2, c.width, c.height); }

    // small name label for AI
    if(!c.isPlayer){
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
      ctx.fillText('Car ' + (c.id+1), c.x - 18, screenY - c.height/2 - 8);
    }
  }

  // particles
  updateParticles(dt);

  // HUD
  drawHUD(playerDistance);
}

// draw obstacles visible to player
function drawObstaclesFor(playerDistance){
  const visibleMeters = Math.ceil(H / PIXELS_PER_METER) + 400;
  for(const o of obstacles){
    const delta = o.distance - playerDistance;
    if(delta < -120 || delta > visibleMeters) continue;
    const sy = H/2 - delta * PIXELS_PER_METER;
    const sx = laneCenter(o.lane);
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - OBSTACLE_WIDTH/2, sy - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
    ctx.strokeStyle = '#222';
    ctx.strokeRect(sx - OBSTACLE_WIDTH/2, sy - OBSTACLE_HEIGHT/2, OBSTACLE_WIDTH, OBSTACLE_HEIGHT);
  }
}

// start/resume/restart handlers
document.getElementById('restart').addEventListener('click', ()=>{
  // reset cars
  cars.forEach((c, i) => {
    c.distance = 0;
    c.finished = false;
    c.finishTime = null;
    c.speed = c.isPlayer ? PLAYER_START_SPEED : (AI_BASE_SPEED + (Math.random()*AI_VARIATION - AI_VARIATION/2));
  });
  // reset obstacles (re-place to allow different spacing each run)
  obstacles.length = 0;
  (function placeObstacles(){
    let pos = OBSTACLE_SAFE_START;
    while(pos < TRACK_LENGTH - 150){
      const gap = OBSTACLE_GAP_MIN + Math.random() * (OBSTACLE_GAP_MAX - OBSTACLE_GAP_MIN);
      pos += gap;
      const lane = Math.floor(Math.random()*LANES);
      obstacles.push({lane, distance: Math.round(pos)});
    }
  })();
  finishOrder = [];
  paused = false;
  raceStartTime = performance.now();
  lastTime = performance.now();
  if(!audioCtx) ensureAudio();
  requestAnimationFrame(frame);
});

// fullscreen button
document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// resume audio on first gesture for autoplay policies
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

// start main loop
lastTime = performance.now();
raceStartTime = performance.now();
requestAnimationFrame(frame);
