const socket = io();
let myRoomId = null;
let requestId = null; // ゲームループ用

// --- 通信部分 ---
function joinRoom() {
    const roomId = document.getElementById('room-input').value;
    if (roomId) {
        myRoomId = roomId;
        socket.emit('join_game', roomId);
    } else alert("部屋IDを入力してください");
}

socket.on('join_success', (roomId) => {
    document.getElementById('join-screen').style.display = 'none';
    document.getElementById('game-wrapper').style.display = 'block';
    document.getElementById('current-room').innerText = roomId;
    
    // 待機中表示
    document.getElementById('status').innerText = "対戦相手を待っています...";
    document.getElementById('status').style.color = "#ccc";
});

socket.on('join_full', () => { document.getElementById('error-msg').innerText = "満員です！"; });

// ★ゲーム開始合図受信
socket.on('game_start', () => {
    // リトライ画面が出ていれば消す
    document.getElementById('result-overlay').style.display = 'none';
    document.getElementById('retry-btn').style.display = 'inline-block';
    document.getElementById('retry-msg').style.display = 'none';
    
    // ステータス更新
    document.getElementById('status').innerText = "READY...";
    document.getElementById('status').style.color = "#fff";

    // カウントダウン開始！
    startCountdown();
});

// ★相手がゲームオーバーになった（＝自分の勝利）
socket.on('opponent_won', () => {
    stopGameLoop(); // 自分の動きを止める
    showResult(true); // "WIN"を表示
});

// ▼▼▼ 新規：相手がいなくて待機に戻される処理 ▼▼▼
socket.on('reset_waiting', () => {
  // リザルト画面を消す
  document.getElementById('result-overlay').style.display = 'none';
  
  // 待機メッセージに戻す
  document.getElementById('status').innerText = "対戦相手を待っています...";
  document.getElementById('status').style.color = "#ccc";
  
  // 相手の画面表示をクリアしておく
  opponentCtx.clearRect(0, 0, opponentCanvas.width, opponentCanvas.height);
});
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

// ▼▼▼ 新規：攻撃を受け取った時の処理 ▼▼▼
socket.on('receive_attack', (lines) => {
  // ★修正点: ゲーム中（requestIdがある時）以外は攻撃を無視する
  // これにより、ゲームオーバー後やカウントダウン中の描画上書きを防ぐ
  if (requestId) {
    addGarbage(lines);
  }
});
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

// リトライ要求ボタン
function requestRetry() {
    if (myRoomId) {
        socket.emit('restart_request', myRoomId);
        document.getElementById('retry-btn').style.display = 'none';
        document.getElementById('retry-msg').style.display = 'block';
    }
}


// --- カウントダウン機能 ---
function startCountdown() {
    let count = 5; // 5秒前から
    
    // 盤面をクリアして文字を描く関数
    const drawCount = (text) => {
        ctx.fillStyle = '#000'; // 背景リセット
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
            initGame(); // カウントダウン終了でゲーム本体開始
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

function initGame() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0; lines = 0; level = 1; combo = -1;
    bag = []; nextQueue = []; holdType = null; canHold = true;
    
    // 時間管理変数のリセット
    lastTime = 0;
    dropCounter = 0;
    
    document.getElementById('status').innerText = "BATTLE!";
    document.getElementById('status').style.color = "#4ecca3";

    spawn();
    updateUI();
    if(requestId) cancelAnimationFrame(requestId);
    update();
}

// 共通ユーティリティ
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
      handleGameOver(); // 負け確定
  }
}

function lock() {
    let isGameOver = false;

    // ブロックを盤面に固定するループ
    current.shape.forEach((row, dy) => row.forEach((v, dx) => {
      if (v) {
          // 画面外（上）にはみ出しているかチェック
          if (current.y + dy < 0) {
              isGameOver = true;
          } 
          // 画面内なら盤面に書き込む
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
}

// ★自分自身がゲームオーバーになった時の処理
function handleGameOver() {
    stopGameLoop();
    
    // 操作中のミノを消去する
    current = null;
    draw(); 
    
    // サーバーに「負けました」と報告
    socket.emit('player_gameover', myRoomId);
    // 画面に「LOSE」を表示
    showResult(false);
}

function stopGameLoop() {
    if(requestId) cancelAnimationFrame(requestId);
    requestId = null;
}

// ★結果画面表示
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
    level = Math.floor(lines / 10) + 1;
    flashEffect();
    // ▼▼▼ 新規：攻撃ロジック ▼▼▼
    // 2列以上消した時だけ相手に送る
    if (count >= 2 && myRoomId) {
      // 送る段数の計算 (例: 2列->1段, 3列->2段, 4列->4段)
      let attackLines = (count === 4) ? 4 : (count - 1);
      socket.emit('attack', {
          roomId: myRoomId,
          lines: attackLines
      });
    }
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
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
  if (!requestId) return; // ゲーム動いてないときは操作無効
  if (!current) return; // 操作するミノが無い時は何もしない

  const key = e.key.toLowerCase();
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
});

function update(time = 0) {
  if (!paused) {
    if (!lastTime) {
        lastTime = time;
    }

    const dt = time - lastTime; lastTime = time; dropCounter += dt;
    const speed = Math.max(50, 1000 - (level - 1) * 100);
    if (dropCounter > speed) {
      if (current && !collide(current.shape, current.x, current.y + 1)) current.y++;
      else if (current) lock();
      dropCounter = 0;
    }
  }
  draw();
  requestId = requestAnimationFrame(update);
}

// ▼▼▼ 新規：お邪魔ライン追加処理 ▼▼▼
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
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲