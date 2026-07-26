// Simple top-down car game for Shaurya
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Car
const car = {
  x: 120, y: H - 120,
  angle: -Math.PI/2, // facing up
  speed: 0,
  maxSpeed: 6,
  accel: 0.18,
  brake: 0.3,
  turnSpeed: 0.04,
  width: 24,
  height: 44,
}

let keys = {};
let startTime = null;
let elapsed = 0;
let running = true;
let checkpointsPassed = [false, false];

// Positions for landmarks customized: approximate places on canvas
const assetz = {x: 150, y: 100, w: 120, h: 70, name: 'Assetz Marq (Whitefield)'};
const bishop = {x: 660, y: 180, w: 140, h: 80, name: 'Bishop Cotton Boys (Residency Rd)'};
const startZone = {x:100,y:H-160,w:140,h:120};

// Simple obstacles (trees/buildings)
const obstacles = [
  {x:350,y:300,w:40,h:40},
  {x:430,y:260,w:50,h:50},
  {x:520,y:360,w:60,h:30},
  {x:260,y:200,w:60,h:30},
]

function rectIntersects(a,b){
  return !(a.x+a.w < b.x || a.x > b.x+b.w || a.y+a.h < b.y || a.y > b.y+b.h);
}

function carRect(c){
  return {x: c.x - c.width/2, y: c.y - c.height/2, w: c.width, h: c.height};
}

function pointInRect(px,py,r){
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// Controls
window.addEventListener('keydown', e=>{keys[e.key]=true; e.preventDefault();});
window.addEventListener('keyup', e=>{keys[e.key]=false;});

function update(dt){
  if(!running) return;
  // acceleration
  if(keys['ArrowUp'] || keys['w']){ car.speed += car.accel; }
  if(keys['ArrowDown'] || keys['s']){ car.speed -= car.brake; }
  // clamp
  if(car.speed > car.maxSpeed) car.speed = car.maxSpeed;
  if(car.speed < -car.maxSpeed/2) car.speed = -car.maxSpeed/2;
  // turning
  if(keys['ArrowLeft'] || keys['a']) car.angle -= car.turnSpeed * (car.speed!==0? Math.sign(car.speed):1);
  if(keys['ArrowRight'] || keys['d']) car.angle += car.turnSpeed * (car.speed!==0? Math.sign(car.speed):1);
  // friction
  car.speed *= 0.99;
  // move
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  // keep inside canvas
  if(car.x < 0) car.x = 0; if(car.x > W) car.x = W;
  if(car.y < 0) car.y = 0; if(car.y > H) car.y = H;

  // collisions with obstacles
  for(let o of obstacles){
    if(rectIntersects(carRect(car), o)){
      // simple collision response: bounce back and reduce speed
      car.x -= Math.cos(car.angle) * car.speed * dt * 3;
      car.y -= Math.sin(car.angle) * car.speed * dt * 3;
      car.speed *= -0.3;
      showTempMessage('Ouch! Slow down, Shaurya');
    }
  }

  // Checkpoints detection: must pass assetz and bishop in any order
  if(pointInRect(car.x,car.y, assetz) && !checkpointsPassed[0]){ checkpointsPassed[0]=true; showTempMessage('You reached Assetz Marq!'); }
  if(pointInRect(car.x,car.y, bishop) && !checkpointsPassed[1]){ checkpointsPassed[1]=true; showTempMessage('You reached Bishop Cotton Boys!'); }

  // Win condition: if both passed and returned to start zone
  if(checkpointsPassed[0] && checkpointsPassed[1] && pointInRect(car.x,car.y, startZone)){
    running = false;
    elapsed = (performance.now()-startTime)/1000;
    document.getElementById('message').textContent = `Congratulations Shaurya! You finished in ${elapsed.toFixed(2)}s!`;
    showWinScreen();
  }
}

let tempMessage = null;
let tempMessageTimer = 0;
function showTempMessage(t){ tempMessage = t; tempMessageTimer = 1600; document.getElementById('message').textContent = t; }

function showWinScreen(){
  document.getElementById('message').textContent += ' Great driving!';
}

function draw(){
  // background
  ctx.clearRect(0,0,W,H);
  // simple road network: draw a faint track
  ctx.fillStyle = '#dcecff';
  ctx.fillRect(0,0,W,H);

  // draw a road path (curvy) - decorative
  ctx.strokeStyle = '#a6d1ff'; ctx.lineWidth = 60; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(120,H-120); ctx.lineTo(200,420); ctx.lineTo(340,360); ctx.lineTo(480,380); ctx.lineTo(620,300); ctx.lineTo(700,220); ctx.stroke();

  // start zone
  ctx.fillStyle = 'rgba(0,180,100,0.12)'; ctx.fillRect(startZone.x, startZone.y, startZone.w, startZone.h);
  ctx.strokeStyle = '#007a3d'; ctx.strokeRect(startZone.x, startZone.y, startZone.w, startZone.h);
  ctx.fillStyle = '#006'; ctx.font = '14px sans-serif'; ctx.fillText('Start / Finish', startZone.x+10, startZone.y+18);

  // landmarks
  drawLandmark(assetz,'#ffdb4d');
  drawLandmark(bishop,'#ffd1dd');

  // obstacles (trees/buildings)
  for(let o of obstacles){ ctx.fillStyle = '#6b8'; ctx.fillRect(o.x,o.y,o.w,o.h); ctx.strokeStyle='#375'; ctx.strokeRect(o.x,o.y,o.w,o.h); }

  // car
  ctx.save(); ctx.translate(car.x,car.y); ctx.rotate(car.angle);
  // car body
  ctx.fillStyle='#e53935'; ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
  // windows
  ctx.fillStyle='#fff'; ctx.fillRect(-car.width/4, -car.height/2+6, car.width/2, car.height/3);
  // wheels
  ctx.fillStyle='#222'; ctx.fillRect(-car.width/2-4, -car.height/2+6,4,12); ctx.fillRect(car.width/2, -car.height/2+6,4,12);
  ctx.fillRect(-car.width/2-4, car.height/2-18,4,12); ctx.fillRect(car.width/2, car.height/2-18,4,12);
  ctx.restore();

  // HUD updates
  document.getElementById('speed').textContent = 'Speed: ' + Math.abs(car.speed).toFixed(2);
  document.getElementById('checkpoints').textContent = `Checkpoints: ${ (checkpointsPassed[0]?1:0) + (checkpointsPassed[1]?1:0) } / 2`;

  // temp message timer
  if(tempMessageTimer>0){ tempMessageTimer -= 16; if(tempMessageTimer<=0){ tempMessage=null; document.getElementById('message').textContent = 'Keep going!'; } }
}

function drawLandmark(l, color){
  ctx.fillStyle = color; ctx.strokeStyle='#333'; ctx.lineWidth=2; ctx.fillRect(l.x,l.y,l.w,l.h); ctx.strokeRect(l.x,l.y,l.w,l.h);
  ctx.fillStyle='#111'; ctx.font='14px sans-serif'; ctx.fillText(l.name, l.x+8, l.y+18);
}

// Animation loop
let last = performance.now();
function loop(now){
  const dt = Math.min(1.5, (now - last)/16); // relative dt
  last = now;
  if(startTime===null) startTime = performance.now();
  if(running) elapsed = (performance.now()-startTime)/1000;
  update(dt);
  draw();
  document.getElementById('time').textContent = 'Time: ' + elapsed.toFixed(2) + 's';
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Buttons
document.getElementById('restart').addEventListener('click', ()=>{
  car.x = 120; car.y = H-120; car.angle = -Math.PI/2; car.speed = 0; startTime = performance.now(); elapsed = 0; running = true; checkpointsPassed = [false,false]; document.getElementById('message').textContent='Restarted! Drive safely, Shaurya';
});

document.getElementById('playfull').addEventListener('click', ()=>{ if(canvas.requestFullscreen) canvas.requestFullscreen(); });

// Small accessibility: show instructions on load
showTempMessage('Welcome Shaurya! Use arrow keys to drive.');
