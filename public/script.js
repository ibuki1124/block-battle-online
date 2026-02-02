const socket = io();
let myRoomId = null;

// ▼▼▼ Web Worker（バックグラウンドでも止まらないタイマー） ▼▼▼
const workerBlob = new Blob([`
    let intervalId;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (intervalId) clearInterval(intervalId);
            // 1秒間に約60回 (16.66ms) の信号を送る
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

// Workerからの信号を受け取ってゲームを進める
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

socket.on('opponent_left', () => {
  if (document.getElementById('result-overlay').style.display !== 'none') return;

  stopGameLoop();
  
  const title = document.getElementById('result-title');
  title.innerText = "YOU WIN!";
  title.style.color = "#4ecca3";
  
  const msg = document.getElementById('retry-msg');
  msg.innerText = "相手が切断しました";
  msg.style.display = "block";
  msg.style.color = "#ff4444";

  document.getElementById('result-overlay').style.display = 'flex';
  document.getElementById('retry-btn').style.display = 'none';
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
let isPlaying = false; // ゲーム中フラグ

function initGame() {
    // ★修正: stopGameLoopを最初に呼んでリセットする
    stopGameLoop(); 

    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0; lines = 0; level = 1; combo = -1;
    bag = []; nextQueue = []; holdType = null; canHold = true;
    
    lastTime = 0; 
    dropCounter = 0;
    levelUpFrames = 0; 
    
    // ★修正: stopGameLoopの後に true にする
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
    
    // Workerを使ってゲームループを開始
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
    
    // 次のミノに即座に移るため、カウンターはリセット
    dropCounter = 0;
}

function handleGameOver() {
    stopGameLoop();
    current = null;
    draw(); 
    socket.emit('player_gameover', myRoomId);
    showResult(false);
}

function stopGameLoop() {
    gameTimerWorker.postMessage('stop'); // Workerを停止
    
    isPlaying = false; // フラグをOFF
    if(levelTimer) {
      clearInterval(levelTimer);
      levelTimer = null;
    }
}

function showResult(isWin) {
    const overlay = document.getElementById('result-overlay');
    const title = document.getElementById('result-title');
    overlay.style.display = 'flex';
    
    if (isWin) {
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
  canvas.style.backgroundColor = '#333';
  setTimeout(() => canvas.style.backgroundColor = '#000', 50);
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
  document.getElementById('score').innerText = score.toLocaleString();
  document.getElementById('lines').innerText = lines;
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
  
  // キー操作時も画面更新
  draw();
});

// ★修正: Workerから定期的に呼ばれる update 関数
// ブラウザが裏でもWorkerは止まらないため、dropCounterに時間が溜まり、
// ここで一気に消化されることで「ポーズ」にならずゲームが進行する。
function update(time = 0) {
  if (!paused && isPlaying) {
    if (!lastTime) {
        lastTime = time;
    }

    const dt = time - lastTime;
    lastTime = time;
    dropCounter += dt;

    const speed = Math.max(50, 1000 * Math.pow(0.85, level - 1));

    // ★重要: whileループで溜まった時間分だけ進める
    // ブラウザが裏に行くと、メインスレッドのこの関数は呼ばれる頻度が下がるが、
    // Workerは正確に動いているため `dt` が大きくなる（例えば1000msなど）。
    // このループでその分を一気に処理することで、時間経過通りにミノを落下させる。
    
    // フリーズ防止の回数制限
    let maxLoops = 20; 

    while (dropCounter > speed && maxLoops > 0) {
        if (!current || !isPlaying) break;

        if (!collide(current.shape, current.x, current.y + 1)) {
            // 落下成功
            current.y++;
            dropCounter -= speed;
        } else {
            // 固定処理
            lock();
            
            // 固定後は次のミノが即落ちないようにリセットし、一旦処理を抜ける
            // (次のミノは次フレーム以降で処理)
            dropCounter = 0;
            break; 
        }
        maxLoops--;
    }
    
    // 制限を超えた分はリセット
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