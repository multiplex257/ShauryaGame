// Straight-highway racer: lane-based vertical scroller (pixel-ish style)
// Replace your existing game.js with this file.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Configuration
const lanes = 3;                       // number of lanes
const roadWidth = Math.floor(W * 0.55);
const laneWidth = Math.floor(roadWidth / lanes);
const roadX = Math.floor((W - roadWidth)/2);
const borderWidth = 14;
const grassColor = '#6cc070';

// Player
const player = {
  lane: Math.floor(lanes/2),           // current lane index 0..lanes-1
  x: 0,                                // computed from lane
  y: H - 140,                          // fixed vertical position
  targetX: 0,                          // for smooth lane transitions
  width: laneWidth * 0.6,             // sprite draw size
  height: Math.floor(laneWidth * 0.9),
  speed: 6,                            // base forward speed (affects scroll)
  accel: 0.6,
  maxSpeed: 18,
  minSpeed: 3,
  color: '#ffb74d',                    // player car color
  alive: true
};

// Road scrolling
let scroll = 0;
let gameStart = null;
let elapsed = 0;
let score = 0;
let running = true;

// Enemies
const enemies = [];
const enemySpawnInterval = 900; // ms
let lastEnemySpawn = 0;

// Effects
const particles = [];

// Input
let keys = {};

// Audio
let audioCtx = null;
let engineGain = null;
let engineOsc = null;

// Create simple pixel-ish car SVG as data URI
function createCarSVG(color, stripe) {
  const svg = `
  <svg xmlns='http://www.w3.org/2000/svg' width='64' height='112' viewBox='0 0 64 112'>
    <rect width='64' height='112' rx='8' ry='8' fill='${color}' stroke='#222' stroke-width='2'/>
    <rect x='12' y='12' width='40' height='28' rx='4' fill='#fff' opacity='0.9'/>
    <rect x='18' y='46' width='10' height='44' rx='3' fill='#111'/>
    <rect x='36' y='46' width='10' height='44' rx='3' fill='#111'/>
    ${ stripe ? `<rect x='30' y='8' width='4' height='96' fill='${stripe}' />` : '' }
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const playerImg = new Image();
playerImg.src = createCarSVG(player.color, '#ddb37b');

function enemyImgForColor(c){
  const img = new Image();
  img.src = createCarSVG(c, '');
  return img;
}

// Utility helpers
function laneCenter(l){
  return roadX + laneWidth * l + laneWidth/2;
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function now(){ return performance.now(); }

// Init positions
player.x = laneCenter(player.lane);
player.targetX = player.x;

// Audio setup (small engine hum)
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

function updateEngineSound(){
  if(!audioCtx) return;
  const s = player.speed;
  const freq = 100 + (s / player.maxSpeed) * 700;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  const g = Math.min(0.18, 0.02 + (s / player.maxSpeed) * 0.16);
  engineGain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.05);
}

function playCrashSound(){
  if(!audioCtx) ensureAudio();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type='square'; o.frequency.setValueAtTime(180, t);
  g.gain.setValueAtTime(0.4, t);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.frequency.exponentialRampToValueAtTime(20, t+0.45);
  g.gain.exponentialRampToValueAtTime(0.001, t+0.5);
  setTimeout(()=>{ o.stop(); o.disconnect(); g.disconnect(); }, 700);
}

// Spawn an enemy car in a lane, with small color variety, and speed relative to player
function spawnEnemy(){
  const lane = Math.floor(Math.random()*lanes);
  const x = laneCenter(lane);
  // spawn just above screen
  const y = -60 - Math.random()*120;
  const colorSet = ['#58a0ff','#7ee1a8','#ff6b6b','#ffd54f','#9c27b0'];
  const col = colorSet[Math.floor(Math.random()*colorSet.length)];
  const img = enemyImgForColor(col);
  const speed = clamp(player.speed - 4 + Math.random()*8, 2, player.maxSpeed+2); // relative
  enemies.push({lane, x, y, width: player.width*0.95, height: player.height*0.95, img, speed});
}

// Collisions AABB
function aabb(a,b){
  return !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);
}

// Particles for small crash effect
function spawnParticles(x,y, count=8){
  for(let i=0;i<count;i++){
    particles.push({
      x, y,
      vx: (Math.random()-0.5)*6,
      vy: (Math.random()-0.5)*6,
      life: 600 + Math.random()*600,
      born: now(),
      size: 4 + Math.random()*5,
      color: 'rgba(40,40,40,0.9)'
    });
  }
}

// Input wiring (keyboard)
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if(!audioCtx) ensureAudio();
});
window.addEventListener('keyup', e => keys[e.key] = false);

// Touch controls: reuse existing touch buttons which have data-key
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

// Draw background: grass + roadside trees in pixel-ish dots
function drawBackground(){
  // grass
  ctx.fillStyle = grassColor;
  ctx.fillRect(0,0,W,H);

  // grass dot pattern left and right
  const margin = 12;
  const treeDot = '#4c8b3a';
  for(let x=margin; x<roadX-8; x+=18){
    for(let y=20; y<H; y+=18){
      ctx.fillStyle = Math.random()>0.7 ? treeDot : '#68b76a';
      ctx.fillRect(x, y + (x%36 === 0 ? 6 : 0), 4, 4);
    }
  }
  for(let x=roadX + roadWidth + 8; x<W-margin; x+=18){
    for(let y=40; y<H; y+=18){
      ctx.fillStyle = Math.random()>0.7 ? treeDot : '#68b76a';
      ctx.fillRect(x, y + (x%30 === 0 ? 4 : 0), 4, 4);
    }
  }

  // simple trees (circles) — spaced
  ctx.fillStyle = '#145f2d';
  for(let t=0;t<8;t++){
    const tx = Math.random() < 0.5 ? (Math.random()*(roadX-60)) : (roadX + roadWidth + 20 + Math.random()*(W - (roadX+roadWidth+40)));
    const ty = 40 + (t * 70);
    ctx.beginPath();
    ctx.arc(tx, (ty + (scroll%80)), 14, 0, Math.PI*2);
    ctx.fill();
  }
}

// Draw road, lane markings and side borders
function drawRoad(){
  // road base
  ctx.fillStyle = '#565a60';
  ctx.fillRect(roadX, 0, roadWidth, H);

  // side borders (red / white stripes)
  for(let y=0; y<H; y+=28){
    ctx.fillStyle = '#fff';
    ctx.fillRect(roadX - borderWidth, y + (scroll%56), borderWidth, 14);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(roadX - borderWidth, y + 14 + (scroll%56), borderWidth, 14);

    ctx.fillStyle = '#fff';
    ctx.fillRect(roadX + roadWidth, y + (scroll%56), borderWidth, 14);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(roadX + roadWidth, y + 14 + (scroll%56), borderWidth, 14);
  }

  // lane divider dashed lines (vertical moving)
  ctx.strokeStyle = '#e9e9e9';
  ctx.lineWidth = 6;
  ctx.setLineDash([28, 18]);
  for(let i=1;i<lanes;i++){
    const lx = roadX + i*laneWidth;
    ctx.beginPath();
    ctx.moveTo(lx, -1000);
    ctx.lineTo(lx, H + 1000);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Draw player and enemies
function drawCar(img, x, y, w, h, rotate=false){
  if(img && img.complete){
    ctx.save();
    ctx.translate(x, y);
    if(rotate) ctx.rotate(Math.PI); // if needed to flip
    ctx.drawImage(img, -w/2, -h/2, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ff6f00';
    ctx.fillRect(x - w/2, y - h/2, w, h);
  }
}

// Update and draw particles
function updateParticles(dt){
  const tnow = now();
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    const age = tnow - p.born;
    if(age > p.life){ particles.splice(i,1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const a = 1 - age / p.life;
    ctx.fillStyle = p.color.replace(/[\d\.]+\)$/,'') + a + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI*2);
    ctx.fill();
  }
}

// Main update loop
let last = performance.now();
function loop(nowTs){
  const dt = Math.min(0.05, (nowTs - last) / 1000);
  last = nowTs;

  if(!gameStart) gameStart = nowTs;
  if(running) elapsed = (nowTs - gameStart) / 1000;

  // handle input for lanes
  if(keys['ArrowLeft'] || keys['a']){
    if(player.lane > 0){ player.lane = Math.max(0, player.lane - 1); keys['ArrowLeft'] = false; keys['a'] = false; }
  }
  if(keys['ArrowRight'] || keys['d']){
    if(player.lane < lanes-1){ player.lane = Math.min(lanes-1, player.lane + 1); keys['ArrowRight'] = false; keys['d'] = false; }
  }
  if(keys['ArrowUp'] || keys['w']){ player.speed = clamp(player.speed + player.accel*dt*60, player.minSpeed, player.maxSpeed); if(!audioCtx) ensureAudio(); }
  else if(keys['ArrowDown'] || keys['s']){ player.speed = clamp(player.speed - player.accel*dt*60, player.minSpeed, player.maxSpeed); }
  else { player.speed = clamp(player.speed - 0.06*dt*60, player.minSpeed, player.maxSpeed); }

  // Smooth lane movement
  player.targetX = laneCenter(player.lane);
  player.x += (player.targetX - player.x) * clamp(10 * dt, 0, 1);

  // scroll road according to speed
  scroll += player.speed * dt * 40;
  // spawn enemies by time
  if(nowTs - lastEnemySpawn > enemySpawnInterval){
    spawnEnemy();
    lastEnemySpawn = nowTs;
  }

  // update enemies
  for(let i = enemies.length - 1; i >= 0; i--){
    const e = enemies[i];
    e.y += e.speed * dt * 40;
    // simple lateral smoothing to lane center
    const targetEx = laneCenter(e.lane);
    e.x += (targetEx - e.x) * dt * 8;
    // off bottom? remove and increase score
    if(e.y - e.height/2 > H + 80){
      enemies.splice(i,1);
      score += 1;
      continue;
    }
    // collision with player (approx)
    if(player.alive){
      const pbox = { x: player.x - player.width/2, y: player.y - player.height/2, width: player.width, height: player.height };
      const ebox = { x: e.x - e.width/2, y: e.y - e.height/2, width: e.width, height: e.height };
      if(aabb(pbox, ebox)){
        // crash
        player.alive = false;
        running = false;
        spawnParticles(player.x, player.y, 14);
        playCrashSound();
        showMessage = 'Crashed! Press Restart';
        msgTimer = 3000;
      }
    }
  }

  // update particles
  // draw everything
  ctx.clearRect(0,0,W,H);
  drawBackground();
  drawRoad();

  // draw moving lane texture/road markers by using scroll offset for dashed lines
  // (we already used dashed centerlines; to enhance, draw repeating small marks)
  ctx.save();
  ctx.translate(0, scroll%40); // subtle shift for side textures
  ctx.restore();

  // draw enemies
  for(const e of enemies){
    drawCar(e.img, e.x, e.y, e.width, e.height);
  }

  // draw player (on top)
  drawCar(playerImg, player.x, player.y, player.width, player.height);

  // draw HUD
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(8,8,260,80);
  ctx.strokeStyle = '#222'; ctx.strokeRect(8,8,260,80);
  ctx.fillStyle = '#222'; ctx.font = '16px sans-serif';
  ctx.fillText('Shaurya Highway', 18, 30);
  ctx.font = '14px monospace';
  ctx.fillText('Speed: ' + Math.round(player.speed * 10) + ' km/h', 18, 52);
  ctx.fillText('Score: ' + score, 140, 52);
  ctx.fillText('Time: ' + elapsed.toFixed(2) + 's', 18, 72);

  // draw particles
  updateParticles(dt * 60);

  // engine sound update
  if(audioCtx && running){
    updateEngineSound();
  }

  requestAnimationFrame(loop);
}

// spawn enemy helper uses global lane centers
function spawnEnemy(){
  // not spawn too close to player
  // pick lane not occupied at top (simple)
  const lane = Math.floor(Math.random()*lanes);
  const x = laneCenter(lane);
  const y = -60;
  const colors = ['#58a0ff','#7ee1a8','#ff6b6b','#ffd54f','#9c27b0'];
  const col = colors[Math.floor(Math.random()*colors.length)];
  const eimg = enemyImgForColor(col);
  const speed = clamp(player.speed + 2 + Math.random()*6, 4, player.maxSpeed + 6);
  enemies.push({lane, x, y, width: player.width*0.95, height: player.height*0.95, img: eimg, speed});
}

// Restart button handler
document.getElementById('restart').addEventListener('click', ()=>{
  // reset
  enemies.splice(0, enemies.length);
  particles.splice(0, particles.length);
  player.lane = Math.floor(lanes/2);
  player.x = laneCenter(player.lane);
  player.targetX = player.x;
  player.speed = 6;
  player.alive = true;
  scroll = 0;
  score = 0;
  running = true;
  gameStart = performance.now();
  lastEnemySpawn = 0;
  last = performance.now();
  showMessage = '';
  requestAnimationFrame(loop);
});

// fullscreen button
document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// resume audio on first user gesture (mobile)
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

// Start game
gameStart = performance.now();
last = performance.now();
requestAnimationFrame(loop);
