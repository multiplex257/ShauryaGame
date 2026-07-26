// highway-highway-v4: static footpath, 4 lanes, up/down accelerate, crash sound (doesn't stop game)
// Replace entire game.js with this file.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Road configuration
const LANES = 4;
const ROAD_WIDTH = Math.floor(W * 0.60);
const LANE_WIDTH = Math.floor(ROAD_WIDTH / LANES);
const ROAD_X = Math.floor((W - ROAD_WIDTH) / 2);
const BORDER_W = 14;

// Player
const player = {
  lane: Math.floor(LANES / 2),
  x: 0,
  y: H - 140,
  width: Math.floor(LANE_WIDTH * 0.68),
  height: Math.floor(LANE_WIDTH * 0.98),
  speed: 6,           // current speed (affects how fast the world seems to move)
  accel: 0.7,
  maxSpeed: 14,
  minSpeed: 2,
  color: '#ffb74d',
  alive: true
};

// Static decorations (footpath / grass) — deterministic dots so they do NOT flicker
const grassLeft = [];
const grassRight = [];
(function seedGrass(){
  // create static pattern positions
  for(let i=0;i<120;i++){
    grassLeft.push({
      x: 12 + (i % 8) * 18 + ((i*7) % 6),
      y: 20 + Math.floor(i/8) * 18 + ((i*11) % 9)
    });
    grassRight.push({
      x: ROAD_X + ROAD_WIDTH + 20 + ((i*5) % 40),
      y: 12 + i*22 % (H - 40)
    });
  }
})();

// Enemies
const enemies = [];
let lastSpawn = 0;
const SPAWN_INTERVAL = 1100; // ms (easy)

// Particles for crash effects
const particles = [];

// Scroll offset used for center dashes (visual motion)
let scroll = 0;

// Input
let keys = {};

// Audio (WebAudio small engine + crash)
let audioCtx = null, engineOsc = null, engineGain = null;
function ensureAudio(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  engineOsc = audioCtx.createOscillator(); engineOsc.type='sawtooth';
  engineGain = audioCtx.createGain(); engineGain.gain.value = 0;
  engineOsc.connect(engineGain); engineGain.connect(audioCtx.destination);
  engineOsc.frequency.value = 80; engineOsc.start();
}
function updateEngineSound(){
  if(!audioCtx) return;
  const freq = 100 + (player.speed / player.maxSpeed) * 700;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.06);
  const g = Math.min(0.2, 0.02 + (player.speed / player.maxSpeed) * 0.18);
  engineGain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.06);
}
function playCrash(){
  if(!audioCtx) ensureAudio();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type='square'; o.frequency.setValueAtTime(220, t);
  g.gain.setValueAtTime(0.45, t);
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  o.frequency.exponentialRampToValueAtTime(40, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  setTimeout(()=>{ try{ o.stop(); o.disconnect(); g.disconnect(); }catch(e){} }, 750);
}

// Small car sprite generator (inline SVG)
function carDataURL(color, stripe){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='112' viewBox='0 0 64 112'>
    <rect width='64' height='112' rx='8' ry='8' fill='${color}' stroke='#222' stroke-width='2'/>
    <rect x='12' y='12' width='40' height='28' rx='4' fill='#fff' opacity='0.9'/>
    <rect x='18' y='46' width='10' height='44' rx='3' fill='#111'/>
    <rect x='36' y='46' width='10' height='44' rx='3' fill='#111'/>
    ${ stripe ? `<rect x='30' y='8' width='4' height='96' fill='${stripe}' />` : '' }
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const playerImg = new Image(); playerImg.src = carDataURL(player.color, '#ddb37b');

// helpers
function laneCenter(l){ return ROAD_X + l*LANE_WIDTH + LANE_WIDTH/2; }
player.x = laneCenter(player.lane);

// input wiring (keyboard)
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if(!audioCtx) ensureAudio();
});
window.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// touch controls wired to on-screen buttons (re-uses data-key)
const tc = document.getElementById('touchControls');
if(tc){
  tc.addEventListener('touchstart', e=>{
    e.preventDefault();
    for(const t of e.changedTouches){
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if(!el) continue;
      const k = el.dataset && el.dataset.key;
      if(k){ keys[k] = true; if(!audioCtx) ensureAudio(); }
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
    const k = el.dataset && el.dataset.key; if(k){ keys[k] = true; if(!audioCtx) ensureAudio(); }
  });
  tc.addEventListener('mouseup', e=>{
    const el = e.target.closest('.tc-btn'); if(!el) return;
    const k = el.dataset && el.dataset.key; if(k) keys[k] = false;
  });
}

// Spawn enemy (easy parameters)
function spawnEnemy(){
  const lane = Math.floor(Math.random() * LANES);
  const x = laneCenter(lane);
  const y = -80 - Math.random()*120;
  const colors = ['#58a0ff','#7ee1a8','#ff6b6b','#ffd54f','#9c27b0'];
  const color = colors[Math.floor(Math.random()*colors.length)];
  const img = new Image(); img.src = carDataURL(color, '');
  const speed = 2 + Math.random()*2; // base slow speed
  enemies.push({ lane, x, y, width: player.width*0.92, height: player.height*0.92, img, speed });
}

// AABB
function aabb(a,b){
  return !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);
}

// Particles
function spawnParticles(x,y,count=10){
  for(let i=0;i<count;i++){
    particles.push({
      x, y,
      vx: (Math.random()-0.5) * 6,
      vy: (Math.random()-0.5) * 6,
      born: performance.now(),
      life: 500 + Math.random()*700,
      size: 3 + Math.random()*6,
      color: 'rgba(40,40,40,0.9)'
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
    const alpha = 1 - age / p.life;
    ctx.fillStyle = `rgba(60,60,60,${alpha})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI*2); ctx.fill();
  }
}

// Draw static footpath (grass) — NO scroll
function drawStaticFootpath(){
  // left
  ctx.fillStyle = '#6cc070';
  ctx.fillRect(0,0,ROAD_X, H);
  // right
  ctx.fillStyle = '#6cc070';
  ctx.fillRect(ROAD_X + ROAD_WIDTH, 0, W - (ROAD_X + ROAD_WIDTH), H);

  // static dot pattern left
  for(const d of grassLeft){
    ctx.fillStyle = Math.random() > 0.82 ? '#145f2d' : '#4caf50';
    ctx.fillRect(d.x, d.y, 5, 5);
  }
  // static small circles (trees) right (deterministic-ish)
  for(let i=0;i<10;i++){
    const tx = ROAD_X + ROAD_WIDTH + 30 + (i%3)*32;
    const ty = 40 + i*70;
    ctx.fillStyle = '#1b7436';
    ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI*2); ctx.fill();
  }

  // side border stripes (static) — vertical repeated red/white
  for(let y=0; y<H; y+=28){
    ctx.fillStyle = '#fff';
    ctx.fillRect(ROAD_X - BORDER_W, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(ROAD_X - BORDER_W, y+14, BORDER_W, 14);

    ctx.fillStyle = '#fff';
    ctx.fillRect(ROAD_X + ROAD_WIDTH, y, BORDER_W, 14);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(ROAD_X + ROAD_WIDTH, y+14, BORDER_W, 14);
  }
}

// Draw road & moving center dashed lines (dashes move based on scroll)
function drawRoad(){
  // road base
  ctx.fillStyle = '#565a60';
  ctx.fillRect(ROAD_X, 0, ROAD_WIDTH, H);

  // lane divider dashed lines (moving)
  ctx.strokeStyle = '#eaeaea';
  ctx.lineWidth = 6;
  ctx.setLineDash([28, 18]);
  // offset based on scroll so dashes move
  ctx.lineDashOffset = -(scroll % 46);
  for(let i=1;i<LANES;i++){
    const lx = ROAD_X + i * LANE_WIDTH;
    ctx.beginPath(); ctx.moveTo(lx, -1000); ctx.lineTo(lx, H+1000); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// draw a car sprite if image loaded else rectangle
function drawCar(img, cx, cy, w, h){
  if(img && img.complete){
    ctx.drawImage(img, cx - w/2, cy - h/2, w, h);
  } else {
    ctx.fillStyle = '#333'; ctx.fillRect(cx - w/2, cy - h/2, w, h);
  }
}

// HUD
function drawHUD(elapsed){
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(8,8,260,78);
  ctx.strokeStyle = '#123'; ctx.strokeRect(8,8,260,78);
  ctx.fillStyle = '#123';
  ctx.font = '16px sans-serif';
  ctx.fillText("Shaurya Highway", 18, 30);
  ctx.font = '14px monospace';
  ctx.fillText('Speed: ' + Math.round(player.speed * 10) + ' km/h', 18, 52);
  ctx.fillText('Time: ' + elapsed.toFixed(2) + 's', 18, 72);
}

// Main game loop & update
let last = performance.now();
let gameStart = performance.now();
function loop(nowTs){
  const dt = Math.min(0.045, (nowTs - last) / 1000);
  last = nowTs;
  const elapsed = (nowTs - gameStart) / 1000;

  // input: left/right to change lane, up/down to accelerate/brake
  if((keys['ArrowLeft'] || keys['a']) && player.lane > 0){
    player.lane = Math.max(0, player.lane - 1); keys['ArrowLeft']=false; keys['a']=false;
    player.x = laneCenter(player.lane);
  }
  if((keys['ArrowRight'] || keys['d']) && player.lane < LANES-1){
    player.lane = Math.min(LANES-1, player.lane + 1); keys['ArrowRight']=false; keys['d']=false;
    player.x = laneCenter(player.lane);
  }

  if(keys['ArrowUp'] || keys['w']){
    player.speed = Math.min(player.maxSpeed, player.speed + player.accel * dt * 60);
    if(!audioCtx) ensureAudio();
  } else if(keys['ArrowDown'] || keys['s']){
    player.speed = Math.max(player.minSpeed, player.speed - player.accel * dt * 60);
  } else {
    // natural slight deceleration
    player.speed = Math.max(player.minSpeed, player.speed - 0.04 * dt * 60);
  }

  // update scroll (visual center dashes movement)
  scroll += player.speed * dt * 28;

  // spawn enemies (easy) based on time
  if(nowTs - lastSpawn > SPAWN_INTERVAL){
    spawnEnemy();
    lastSpawn = nowTs;
  }

  // update enemies: move down the screen towards player view. They always move downward.
  for(let i = enemies.length - 1; i >= 0; i--){
    const e = enemies[i];
    // enemies move downward. Add a bit of variation and let player's speed slightly influence apparent approach:
    e.y += (e.speed + (player.speed * 0.2)) * dt * 60;
    // smooth lane centering
    const exTarget = laneCenter(e.lane);
    e.x += (exTarget - e.x) * dt * 6;

    // if enemy passed below screen -> remove and increment small score (optional)
    if(e.y - e.height/2 > H + 120){
      enemies.splice(i,1);
      continue;
    }

    // collision check: approximate bounding boxes
    const pbox = { x: player.x - player.width/2, y: player.y - player.height/2, width: player.width, height: player.height };
    const ebox = { x: e.x - e.width/2, y: e.y - e.height/2, width: e.width, height: e.height };
    if(aabb(pbox, ebox)){
      // crash: do NOT stop game; make sound, particles, reduce speed a bit and continue
      playCrash();
      spawnParticles(player.x + (Math.random()-0.5)*20, player.y + (Math.random()-0.5)*20, 12);
      // slight knockback: move enemy down faster a bit and reduce player speed briefly
      e.y += 18;
      player.speed = Math.max(player.minSpeed, player.speed - 2.5);
      // gentle visual flash: we can show a temporary message
      tempMessage('Crash! Keep going', 1200);
    }
  }

  // drawing
  ctx.clearRect(0,0,W,H);

  // static footpath (left & right)
  drawStaticFootpath();

  // road & moving dashes
  drawRoad();

  // draw enemies under player
  for(const e of enemies){
    drawCar(e.img, e.x, e.y, e.width, e.height);
  }

  // draw player on top
  drawCar(playerImg, player.x, player.y, player.width, player.height);

  // draw particles
  updateParticles(dt);

  // HUD
  drawHUD(elapsed);

  // engine sound update
  if(audioCtx) updateEngineSound();

  requestAnimationFrame(loop);
}

// temporary on-screen message
let messageText = '';
let messageTimeout = 0;
function tempMessage(txt, ms){
  messageText = txt; messageTimeout = ms;
  // draw message over HUD briefly (non-blocking)
  setTimeout(()=>{ messageText=''; }, ms);
}

// resume audio for autoplay policies
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

// Restart & fullscreen buttons (reuse existing UI)
document.getElementById('restart').addEventListener('click', ()=>{
  enemies.splice(0,enemies.length);
  particles.splice(0,particles.length);
  player.lane = Math.floor(LANES/2);
  player.x = laneCenter(player.lane);
  player.speed = 6;
  player.alive = true;
  scroll = 0;
  lastSpawn = performance.now();
  gameStart = performance.now();
  last = performance.now();
  requestAnimationFrame(loop);
});
document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// Start game
lastSpawn = performance.now() - SPAWN_INTERVAL * 0.4;
gameStart = performance.now();
last = performance.now();
requestAnimationFrame(loop);
