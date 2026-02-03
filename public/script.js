// ▼▼▼ Supabase設定 ▼▼▼
// 念のため変数名を supabaseClient に変更して競合を回避
const SUPABASE_URL = "https://lgtdoezyzxodekphtpjo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxndGRvZXp5enhvZGVrcGh0cGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwMzk5MDksImV4cCI6MjA4NTYxNTkwOX0.ntuiMBp1kZqRw-Lk9f4Av67VIuxvt9CvEJJpR8D_YQI";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null; // ログイン中のユーザー情報
let originalName = ""; // 変更前の名前を保持
// ▲▲▲ ここまで ▲▲▼

const socket = io();
let myRoomId = null;

// ▼▼▼ Web Worker（バックグラウンドでも止まらないタイマー） ▼▼▼
const workerBlob = new Blob([`
    let intervalId;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(() => {
                self.postMessage('tick');
            }, 1000 / 60);
        } else if (e.data === 'stop') {
            clearInterval(intervalId);
            intervalId = null;
        }
    };
`], { type: 'application/javascript' });

const gameTimerWorker = new Worker(URL.createObjectURL(workerBlob));

gameTimerWorker.onmessage = function(e) {
    if (e.data === 'tick') {
        update(Date.now());
    }
};
// ▲▲▲ Web Worker 設定終了 ▲▲▲


// --- 通信部分 ---
function joinRoom() {
    const roomId = document.getElementById('room-input').value;
    const playerName = document.getElementById('name-input').value;
    
    if (roomId) {
        myRoomId = roomId;
        socket.emit('join_game', roomId, playerName);
    } else alert("部屋IDを入力してください");
}

function startPractice() {
    const playerName = document.getElementById('name-input').value;
    socket.emit('join_practice', playerName);
}

socket.on('update_names', (players) => {
    players.forEach(p => {
        if (p.id === socket.id) {
            document.getElementById('local-player-label').innerText = p.name;
        } else {
            document.getElementById('remote-player-label').innerText = p.name;
        }
    });
});

socket.on('join_success', (roomId, mode) => {
    document.getElementById('join-screen').style.display = 'none';
    document.getElementById('game-wrapper').style.display = 'block';
    document.getElementById('current-room').innerText = roomId;
    
    if (mode === 'solo') {
        document.body.classList.add('solo-mode');
        document.getElementById('vs-area').style.display = 'none';
        document.getElementById('header-info').style.display = 'none';
        myRoomId = roomId;
    } else {
        document.body.classList.remove('solo-mode');
        document.getElementById('vs-area').style.display = 'flex';
        document.getElementById('local-player-label').style.display = 'block';
        document.getElementById('header-info').style.display = 'block';
        
        document.getElementById('status').innerText = "対戦相手を待っています...";
        document.getElementById('status').style.color = "#ccc";
        myRoomId = roomId;
    }
});

socket.on('join_full', () => { document.getElementById('error-msg').innerText = "満員です！"; });

socket.on('game_start', () => {
    document.getElementById('result-overlay').style.display = 'none';
    document.getElementById('retry-btn').style.display = 'inline-block';
    document.getElementById('retry-msg').style.display = 'none';
    
    if (document.getElementById('vs-area').style.display !== 'none') {
        document.getElementById('status').innerText = "READY...";
        document.getElementById('status').style.color = "#fff";
    }

    startCountdown();
});

socket.on('opponent_won', () => {
    stopGameLoop(); 
    showResult(true); 
});

socket.on('reset_waiting', () => {
  document.getElementById('result-overlay').style.display = 'none';
  document.getElementById('status').innerText = "対戦相手を待っています...";
  document.getElementById('status').style.color = "#ccc";
  opponentCtx.clearRect(0, 0, opponentCanvas.width, opponentCanvas.height);
});

socket.on('receive_attack', (lines) => {
  if (isPlaying) { 
    addGarbage(lines);
  }
});

// ▼▼▼ ランキングデータの受信処理 ▼▼▼
socket.on('ranking_data', (data) => {
  const list = document.getElementById('ranking-list');
  list.innerHTML = ''; 

  if (!data || data.length === 0) {
      list.innerHTML = '<p style="text-align:center;">データがありません</p>';
      return;
  }

  data.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'rank-item';
      div.innerHTML = `
          <span class="rank-name">${index + 1}. ${escapeHtml(item.name)}</span>
          <span class="rank-score">${item.score.toLocaleString()}</span>
      `;
      list.appendChild(div);
  });
});

function escapeHtml(text) {
  if (!text) return 'Unknown';
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

socket.on('opponent_left', () => {
  const overlay = document.getElementById('result-overlay');
  const msg = document.getElementById('retry-msg');
  const retryBtn = document.getElementById('retry-btn');

  if (overlay.style.display !== 'none') {
      if (retryBtn) retryBtn.style.display = 'none';
      if (msg) {
          msg.innerText = "相手が退出しました";
          msg.style.display = "block";
          msg.style.color = "#ff4444";
      }
      return; 
  }

  stopGameLoop();
  
  const title = document.getElementById('result-title');
  title.innerText = "YOU WIN!";
  title.style.color = "#4ecca3";
  
  if (msg) {
      msg.innerText = "相手が切断しました";
      msg.style.display = "block";
      msg.style.color = "#ff4444";
  }

  overlay.style.display = 'flex';
  if (retryBtn) retryBtn.style.display = 'none';
});

function requestRetry() {
    if (myRoomId) {
        socket.emit('restart_request', myRoomId);
        if (document.getElementById('vs-area').style.display !== 'none') {
            document.getElementById('retry-btn').style.display = 'none';
            document.getElementById('retry-msg').style.display = 'block';
        }
    }
}


// --- カウントダウン機能 ---
function startCountdown() {
    let count = 3; 
    
    const drawCount = (text) => {
        ctx.fillStyle = '#000'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 60px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width/2, canvas.height/2);
    };

    drawCount(count);

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            drawCount(count);
        } else if (count === 0) {
            drawCount("GO!");
        } else {
            clearInterval(timer);
            initGame(); 
        }
    }, 1000);
}


// --- 相手の盤面描画 ---
const opponentCanvas = document.getElementById('opponent-game');
const opponentCtx = opponentCanvas.getContext('2d');

socket.on('opponent_board', (data) => {
    drawOpponent(data.board, data.current);
});

function drawOpponent(opBoard, opCurrent) {
    opponentCtx.clearRect(0, 0, opponentCanvas.width, opponentCanvas.height);
    if (opBoard) {
        opBoard.forEach((row, y) => row.forEach((type, x) => 
            type && drawBlock(opponentCtx, x, y, COLORS[type])
        ));
    }
    if (opCurrent) {
        const shape = SHAPES[opCurrent.type];
        opCurrent.shape.forEach((row, dy) => row.forEach((v, dx) => 
            v && drawBlock(opponentCtx, opCurrent.x + dx, opCurrent.y + dy, COLORS[opCurrent.type])
        ));
    }
}


// --- ゲームエンジン ---
const COLS = 10, ROWS = 20, BLOCK = 30;
const COLORS = {
    I: '#00f0f0', O: '#f0f000', T: '#a000f0', S: '#00f000', Z: '#f00000', 
    J: '#0000f0', L: '#f0a000', G: '#808080', 
    GHOST: 'rgba(255,255,255,0.1)'
  };
const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], O: [[1,1],[1,1]], T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]], Z: [[1,1,0],[0,1,1],[0,0,0]], J: [[1,0,0],[1,1,1],[0,0,0]], L: [[0,0,1],[1,1,1],[0,0,0]],
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const holdCtx = document.getElementById('hold').getContext('2d');
const nextCtx = document.getElementById('next').getContext('2d');

let board, score, lines, level, combo, paused;
let lastTime, dropCounter;
let bag, nextQueue, holdType, canHold, current;
let levelTimer = null; 
let levelUpFrames = 0; 
let isPlaying = false; 
let particles = [];

function initGame() {
    stopGameLoop(); 

    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0; lines = 0; level = 1; combo = -1;
    bag = []; nextQueue = []; holdType = null; canHold = true;
    
    lastTime = 0; 
    dropCounter = 0;
    levelUpFrames = 0; 
    particles = []; 
    
    isPlaying = true; 
    
    if (document.getElementById('vs-area').style.display !== 'none') {
        document.getElementById('status').innerText = "BATTLE!";
        document.getElementById('status').style.color = "#4ecca3";
    }

    spawn();
    updateUI();
    
    if(levelTimer) clearInterval(levelTimer);
    
    levelTimer = setInterval(() => {
        if (level < 20) {
            level++;
            updateUI();
            levelUpFrames = 120;
        }
    }, 30000); 
    
    gameTimerWorker.postMessage('start');
}

const createPiece = (type) => ({ type, shape: SHAPES[type], x: Math.floor(COLS/2) - Math.floor(SHAPES[type][0].length/2), y: type === 'I' ? -1 : 0 });
const getNextPiece = () => {
  if (bag.length <= 7) {
    let newBag = Object.keys(SHAPES);
    for (let i = newBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
    }
    bag.push(...newBag);
  }
  nextQueue.push(bag.shift());
  if (nextQueue.length < 5) return getNextPiece();
  return nextQueue.shift();
};
const rotate = (matrix, dir) => {
  const m = matrix.map(row => [...row]);
  for (let y = 0; y < m.length; ++y) for (let x = 0; x < y; ++x) [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
  return dir > 0 ? m.map(row => row.reverse()) : m.reverse();
};
const collide = (shape, x, y) => shape.some((row, dy) => row.some((v, dx) => v && (x + dx < 0 || x + dx >= COLS || y + dy >= ROWS || (board[y + dy] && board[y + dy][x + dx]))));

function attemptRotation(dir) {
  const newShape = rotate(current.shape, dir);
  const pos = {x: current.x, y: current.y};
  for (let offset of [0, 1, -1, -2, 2]) {
    if (!collide(newShape, pos.x + offset, pos.y)) {
      current.x += offset; current.shape = newShape; return true;
    }
  }
  return false;
}

function spawn() {
  current = createPiece(getNextPiece());
  canHold = true;
  if (collide(current.shape, current.x, current.y)) {
      handleGameOver(); 
  }
}

function lock() {
    let isGameOver = false;

    current.shape.forEach((row, dy) => row.forEach((v, dx) => {
      if (v) {
          if (current.y + dy < 0) {
              isGameOver = true;
          } 
          else if (current.y + dy >= 0) {
              board[current.y + dy][current.x + dx] = current.type;
          }
      }
    }));
  
    if (isGameOver) {
        handleGameOver();
        return; 
    }
  
    clearLines();
    spawn();
    
    dropCounter = 0;
}

function handleGameOver() {
  stopGameLoop();
    
  if (myRoomId && myRoomId.startsWith('__solo_')) {
      if (score > 0 && currentUser) { 
        socket.emit('submit_score', {
            score: score,
            userId: currentUser.id
        });
      }
      showResult("over");
  }else{
    showResult(false);
  }

  current = null;
  draw(); 
  socket.emit('player_gameover', myRoomId);
}

function stopGameLoop() {
    gameTimerWorker.postMessage('stop'); 
    
    isPlaying = false; 
    if(levelTimer) {
      clearInterval(levelTimer);
      levelTimer = null;
    }
}

function showResult(isWin) {
    const overlay = document.getElementById('result-overlay');
    const title = document.getElementById('result-title');
    overlay.style.display = 'flex';
    
    if (isWin === "over") {
      title.innerText = "GAME OVER";
      title.style.color = "#ff4444";
    } else if (isWin) {
      title.innerText = "YOU WIN!";
      title.style.color = "#4ecca3";
    } else {
        title.innerText = "YOU LOSE...";
        title.style.color = "#ff4444";
    }
}

function clearLines() {
  let count = 0;
  board = board.filter(row => {
    const isFull = row.every(cell => cell !== null);
    if (isFull) count++;
    return !isFull;
  });
  if (count > 0) {
    combo++; lines += count;
    score += ([0, 100, 300, 500, 800][count] + (combo * 50)) * level;
    
    flashEffect();
    shakeBoard(); 
    
    if (count >= 2 && myRoomId) {
      let attackLines = (count === 4) ? 4 : (count - 1);
      socket.emit('attack', {
          roomId: myRoomId,
          lines: attackLines
      });
    }
  } else combo = -1;
  while (board.length < ROWS) board.unshift(Array(COLS).fill(null));
  updateUI();
}

function flashEffect() {
    canvas.classList.remove('flash-effect');
    void canvas.offsetWidth; 
    canvas.classList.add('flash-effect');
}

function shakeBoard() {
    const wrapper = document.querySelector('.game-container.local');
    if(wrapper) {
        wrapper.classList.remove('shake-effect');
        void wrapper.offsetWidth; 
        wrapper.classList.add('shake-effect');
    }
}

function createParticles(x, y, color) {
    for (let i = 0; i < 10; i++) { 
        particles.push({
            x: x + Math.random() * BLOCK * 3 - BLOCK, 
            y: y,
            vx: (Math.random() - 0.5) * 8, 
            vy: (Math.random() * -8) - 2,  
            life: 1.0, 
            color: color
        });
    }
}

function drawBlock(c, x, y, color, size = BLOCK, isGhost = false) {
  c.fillStyle = color; c.globalAlpha = isGhost ? 0.3 : 1;
  c.fillRect(x * size, y * size, size - 1, size - 1);
  c.globalAlpha = 1;
  if (!isGhost) { c.strokeStyle = 'rgba(255,255,255,0.1)'; c.strokeRect(x * size, y * size, size - 1, size - 1); }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  board.forEach((row, y) => row.forEach((type, x) => type && drawBlock(ctx, x, y, COLORS[type])));
  
  if (current) {
    let gy = current.y; while (!collide(current.shape, current.x, gy + 1)) gy++;
    current.shape.forEach((row, dy) => row.forEach((v, dx) => v && drawBlock(ctx, current.x + dx, gy + dy, COLORS[current.type], BLOCK, true)));
    current.shape.forEach((row, dy) => row.forEach((v, dx) => v && drawBlock(ctx, current.x + dx, current.y + dy, COLORS[current.type])));
  }
  
  if (particles.length > 0) {
      for (let i = particles.length - 1; i >= 0; i--) {
          let p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.5; 
          p.life -= 0.05; 

          if (p.life <= 0) {
              particles.splice(i, 1);
          } else {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.fillRect(p.x, p.y, 6, 6); 
              ctx.globalAlpha = 1.0;
          }
      }
  }

  drawPreview(holdCtx, holdType);
  drawNextQueue();

  if (levelUpFrames > 0) {
      ctx.save();
      ctx.fillStyle = "yellow";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 2;
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("LEVEL UP!", canvas.width / 2, canvas.height / 3);
      ctx.strokeText("LEVEL UP!", canvas.width / 2, canvas.height / 3);
      ctx.restore();
      levelUpFrames--; 
  }

  if (myRoomId) {
      socket.emit('update_board', { roomId: myRoomId, board: board, current: current });
  }
}

function drawPreview(c, type) {
  c.clearRect(0, 0, 100, 100); if (!type) return;
  const shape = SHAPES[type], s = 20, ox = (100 - shape[0].length * s) / 2, oy = (100 - shape.length * s) / 2;
  shape.forEach((row, y) => row.forEach((v, x) => v && drawBlock(c, x + (ox/s), y + (oy/s), COLORS[type], s)));
}
function drawNextQueue() {
  nextCtx.clearRect(0, 0, 100, 300);
  nextQueue.slice(0, 4).forEach((type, i) => {
    const shape = SHAPES[type], s = 18;
    shape.forEach((row, y) => row.forEach((v, x) => v && drawBlock(nextCtx, x + 1, y + 1 + (i * 4), COLORS[type], s)));
  });
}

function updateUI() {
  const scoreEl = document.getElementById('score');
  if (scoreEl) {
      scoreEl.innerText = score.toLocaleString();
  }
}

document.addEventListener('keydown', e => {
  if (document.getElementById('join-screen').style.display !== 'none') return;
  if (!isPlaying) return; 
  if (!current) return; 

  const key = e.key.toLowerCase();

  const gameKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'space'];
  if (gameKeys.includes(key)) {
      e.preventDefault();
  }

  if ((key === 'arrowleft' || key === 'a') && !collide(current.shape, current.x - 1, current.y)) current.x--;
  if ((key === 'arrowright' || key === 'd') && !collide(current.shape, current.x + 1, current.y)) current.x++;
  
  if (key === 'arrowdown' || key === 's') { 
    if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++; score += 1; updateUI(); dropCounter = 0;
    } else { lock(); dropCounter = 0; }
  }
  if (key === ' ') { 
    let count = 0;
    while (!collide(current.shape, current.x, current.y + 1)) { current.y++; count++; }
    
    createParticles(current.x * BLOCK, current.y * BLOCK, COLORS[current.type]);
    shakeBoard();

    score += count * 2; lock(); dropCounter = 0;
  }
  
  if (key === 'arrowup' || key === 'w') attemptRotation(1);
  
  if (key === 'shift') {
    if (canHold) {
      if (!holdType) { holdType = current.type; spawn(); }
      else { [holdType, current] = [current.type, createPiece(holdType)]; current.x = Math.floor(COLS/2) - Math.floor(SHAPES[current.type][0].length/2); current.y = current.type === 'I' ? -1 : 0; }
      canHold = false;
    }
  }
  
  draw();
});

function update(time = 0) {
  if (!paused && isPlaying) {
    if (!lastTime) {
        lastTime = time;
    }

    const dt = time - lastTime;
    lastTime = time;
    dropCounter += dt;

    const speed = Math.max(50, 1000 * Math.pow(0.85, level - 1));

    let maxLoops = 20; 

    while (dropCounter > speed && maxLoops > 0) {
        if (!current || !isPlaying) break;

        if (!collide(current.shape, current.x, current.y + 1)) {
            current.y++;
            dropCounter -= speed;
        } else {
            lock();
            dropCounter = 0;
            break; 
        }
        maxLoops--;
    }
    
    if (maxLoops === 0) dropCounter = 0;
  }
  
  draw();
}

function addGarbage(linesCount) {
  for (let i = 0; i < linesCount; i++) {
      const isTopFull = board[0].some(cell => cell !== null);
      if (isTopFull) {
          handleGameOver();
          return;
      }

      board.shift();

      const holeIdx = Math.floor(Math.random() * COLS);
      const newRow = Array(COLS).fill('G');
      newRow[holeIdx] = null;
      
      board.push(newRow);
  }
  
  if (current && collide(current.shape, current.x, current.y)) {
      current.y--; 
      if (collide(current.shape, current.x, current.y)) {
          handleGameOver();
      }
  }
  
  draw();
}

function setupMobileControls() {
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnDown = document.getElementById('btn-down');
  const btnRotate = document.getElementById('btn-rotate');
  const btnHard = document.getElementById('btn-hard');
  const btnHold = document.getElementById('btn-hold');

  let moveInterval = null;

  const actions = {
      left: () => { 
          if (current && !collide(current.shape, current.x - 1, current.y)) {
              current.x--; 
              draw(); 
          }
      },
      right: () => { 
          if (current && !collide(current.shape, current.x + 1, current.y)) {
              current.x++; 
              draw();
          }
      },
      down: () => {
          if (current) {
              if (!collide(current.shape, current.x, current.y + 1)) {
                  current.y++; score += 1; updateUI(); dropCounter = 0;
                  draw();
              } else {
                  lock(); dropCounter = 0;
              }
          }
      },
      rotate: () => { if (current) attemptRotation(1); draw(); },
      hard: () => { 
          if (current) {
              let count = 0;
              while (!collide(current.shape, current.x, current.y + 1)) { current.y++; count++; }
              
              createParticles(current.x * BLOCK, current.y * BLOCK, COLORS[current.type]);
              shakeBoard();

              score += count * 2; lock(); dropCounter = 0;
          }
      },
      hold: () => {
          if (current && canHold) {
              if (!holdType) { holdType = current.type; spawn(); }
              else { [holdType, current] = [current.type, createPiece(holdType)]; current.x = Math.floor(COLS/2) - Math.floor(SHAPES[current.type][0].length/2); current.y = current.type === 'I' ? -1 : 0; }
              canHold = false;
              draw();
          }
      }
  };

  const startAction = (actionName, e) => {
      e.preventDefault(); 
      if (!isPlaying) return; 

      actions[actionName]();

      if (['left', 'right', 'down'].includes(actionName)) {
          if (moveInterval) clearInterval(moveInterval);
          
          setTimeout(() => {
          }, 150); 

          moveInterval = setInterval(() => {
              actions[actionName]();
          }, 100); 
      }
  };

  const endAction = (e) => {
      e.preventDefault();
      if (moveInterval) {
          clearInterval(moveInterval);
          moveInterval = null;
      }
  };

  const bindBtn = (elem, actionName) => {
      if (!elem) return;
      elem.addEventListener('touchstart', (e) => startAction(actionName, e), { passive: false });
      elem.addEventListener('touchend', endAction);
      elem.addEventListener('mousedown', (e) => startAction(actionName, e));
      elem.addEventListener('mouseup', endAction);
      elem.addEventListener('mouseleave', endAction);
  };

  bindBtn(btnLeft, 'left');
  bindBtn(btnRight, 'right');
  bindBtn(btnDown, 'down');
  bindBtn(btnRotate, 'rotate');
  bindBtn(btnHard, 'hard');
  bindBtn(btnHold, 'hold');
}

setupMobileControls();

function backToTop() {
  window.location.reload();
}

function toggleRules() {
  const modal = document.getElementById('rules-modal');
  if (modal.style.display === 'flex') {
      modal.style.display = 'none';
  } else {
      modal.style.display = 'flex';
  }
}

function toggleRanking() {
  const modal = document.getElementById('ranking-modal');
  const guestAlert = document.getElementById('guest-ranking-alert');
  if (modal.style.display === 'flex') {
      modal.style.display = 'none';
  } else {
      modal.style.display = 'flex';
    if (!currentUser) {
        if(guestAlert) guestAlert.style.display = 'block';
    } else {
        if(guestAlert) guestAlert.style.display = 'none';
    }
      switchRankingTab('global');
  }
}

function switchRankingTab(mode) {
  const list = document.getElementById('ranking-list');
  const tabGlobal = document.getElementById('tab-global');
  const tabMy = document.getElementById('tab-my');

  if (mode === 'global') {
      tabGlobal.classList.add('active');
      tabMy.classList.remove('active');
  } else {
      tabGlobal.classList.remove('active');
      tabMy.classList.add('active');
  }

  list.innerHTML = '<p style="text-align:center;">読み込み中...</p>';

  if (mode === 'global') {
      socket.emit('request_ranking');
  } else {
      if (currentUser) {
          socket.emit('request_my_ranking', currentUser.id);
      } else {
          list.innerHTML = '<p style="text-align:center; color:#888;">ログインすると<br>自分の記録が見られます</p>';
      }
  }
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu-list');
  menu.classList.toggle('active');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('mobile-menu-list');
  const btn = document.querySelector('.mobile-menu-btn');
  if (menu.classList.contains('active') && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove('active');
  }
});

const nameInputEl = document.getElementById('name-input');
const saveNameBtn = document.getElementById('btn-save-name');

if (nameInputEl) {
    nameInputEl.addEventListener('input', (e) => {
        if (!currentUser || e.target.value.trim() === originalName) {
            saveNameBtn.style.display = 'none';
        } else {
            saveNameBtn.style.display = 'block';
        }
    });

    nameInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && saveNameBtn.style.display === 'block') {
            saveNameFromInput();
        }
    });
}

async function saveNameFromInput() {
  const newName = nameInputEl.value.trim();
  const msgEl = document.getElementById('save-msg');

  if (!newName) return;

  try {
      const { data, error } = await supabaseClient.auth.updateUser({
          data: { display_name: newName }
      });

      if (error) throw error;

      if (currentUser) {
          const { error: dbError } = await supabaseClient
              .from('scores')
              .update({ name: newName })
              .eq('user_id', currentUser.id);
          
          if (dbError) throw dbError;
      }

      originalName = newName; 
      saveNameBtn.style.display = 'none'; 
      
      if(msgEl) {
          msgEl.innerText = "名前を変更しました！";
          msgEl.style.color = "#4ecca3";
          setTimeout(() => { msgEl.innerText = ""; }, 3000);
      }

  } catch (error) {
      console.error(error);
      if(msgEl) {
          msgEl.innerText = "エラー: " + error.message;
          msgEl.style.color = "#ff4444";
      }
  }
}

let isLoginMode = true; 

function toggleLogin() {
    const modal = document.getElementById('login-modal');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        isLoginMode = true;
        updateAuthModalUI();
    }
}

function switchAuthMode(e) {
    if(e) e.preventDefault();
    isLoginMode = !isLoginMode;
    updateAuthModalUI();
}

function updateAuthModalUI() {
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const text = document.getElementById('auth-switch-text');
    const link = document.querySelector('#login-modal a');
    const errorMsg = document.getElementById('auth-error-msg');

    errorMsg.innerText = ""; 

    if (isLoginMode) {
        title.innerText = "ログイン";
        btn.innerText = "ログインする";
        text.innerText = "アカウントをお持ちでないですか？";
        link.innerText = "新規登録はこちら";
    } else {
        title.innerText = "新規登録";
        btn.innerText = "登録して始める";
        text.innerText = "すでにアカウントをお持ちですか？";
        link.innerText = "ログインはこちら";
    }
}

async function handleAuth() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const errorMsg = document.getElementById('auth-error-msg');

    if (!email || !password) {
        errorMsg.innerText = "メールとパスワードを入力してください";
        return;
    }

    try {
        let result;
        if (isLoginMode) {
            result = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });
        } else {
            result = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        display_name: email.split('@')[0] 
                    }
                }
            });
        }

        if (result.error) {
            throw result.error;
        }

        toggleLogin();

    } catch (error) {
        console.error(error);
        errorMsg.innerText = "エラー: " + error.message;
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    const pcLoginBtn = document.getElementById('btn-login');
    const pcUserInfo = document.getElementById('user-info');
    const pcNameDisplay = document.getElementById('user-name-display');
    const mobileMenu = document.getElementById('mobile-menu-list');
    const mobileLoginBtn = document.getElementById('btn-login-mobile');
    const nameInput = document.getElementById('name-input'); 
    const saveNameBtn = document.getElementById('btn-save-name');

    let mobileUserInfo = document.getElementById('mobile-user-info');
    if (!mobileUserInfo) {
        mobileUserInfo = document.createElement('div');
        mobileUserInfo.id = 'mobile-user-info';
        mobileUserInfo.className = 'menu-item';
        mobileUserInfo.style.borderBottom = '1px solid #333';
        mobileUserInfo.style.cursor = 'default';
        mobileUserInfo.style.backgroundColor = 'rgba(255,255,255,0.05)';
    }

    if (session) {
        currentUser = session.user;
        const displayName = currentUser.user_metadata.display_name || currentUser.email.split('@')[0];
        
        originalName = displayName;

        if(pcLoginBtn) pcLoginBtn.style.display = 'none';
        if(pcUserInfo) {
            pcUserInfo.style.display = 'flex';
            pcNameDisplay.innerText = displayName;
        }

        if(mobileLoginBtn) mobileLoginBtn.style.display = 'none';
        mobileUserInfo.innerHTML = `
            <div style="color:var(--accent); font-weight:bold; margin-bottom:5px;">👤 ${escapeHtml(displayName)}</div>
            <button onclick="logout(); toggleMobileMenu();" style="background:#333; border:1px solid #555; color:#ccc; padding:10px; border-radius:4px; cursor:pointer; width:100%; box-sizing: border-box;">ログアウト</button>
        `;
        if (!document.getElementById('mobile-user-info')) {
            mobileMenu.insertBefore(mobileUserInfo, mobileMenu.firstChild);
        }

        if (nameInput) {
            nameInput.value = displayName;
            nameInput.readOnly = false; 
            nameInput.style.backgroundColor = "#000"; 
        }
        
    } else {
        currentUser = null;
        originalName = "";

        if(pcLoginBtn) pcLoginBtn.style.display = 'inline-block';
        if(pcUserInfo) pcUserInfo.style.display = 'none';

        if(mobileLoginBtn) mobileLoginBtn.style.display = 'block';
        if (document.getElementById('mobile-user-info')) {
            mobileUserInfo.remove();
        }

        if (nameInput) {
            nameInput.value = "";
            nameInput.readOnly = false;
            nameInput.style.backgroundColor = "#000";
        }
        if(saveNameBtn) saveNameBtn.style.display = 'none';
    }
});