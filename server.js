const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const roomRestartState = {}; 

io.on('connection', (socket) => {
    
    // 入室処理
    socket.on('join_game', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount < 2) {
            socket.join(roomId);
            socket.emit('join_success', roomId);
            if (userCount + 1 === 2) {
                io.to(roomId).emit('game_start');
            }
        } else {
            socket.emit('join_full');
        }
    });

    // 盤面同期
    socket.on('update_board', (data) => {
        socket.broadcast.to(data.roomId).emit('opponent_board', data);
    });

    // 攻撃（お邪魔ライン）の転送
    socket.on('attack', (data) => {
        socket.broadcast.to(data.roomId).emit('receive_attack', data.lines);
    });

    // ゲームオーバー通知
    socket.on('player_gameover', (roomId) => {
        socket.broadcast.to(roomId).emit('opponent_won');
    });

    // ▼▼▼ 修正：リトライ要求 ▼▼▼
    socket.on('restart_request', (roomId) => {
        if (!roomRestartState[roomId]) {
            roomRestartState[roomId] = new Set();
        }
        
        // リクエストした人を記録
        roomRestartState[roomId].add(socket.id);

        const room = io.sockets.adapter.rooms.get(roomId);
        const currentMemberCount = room ? room.size : 0;

        // ★修正点: 人数が2人未満（相手がいない）場合
        if (currentMemberCount < 2) {
            // ゲームを開始せず、このプレイヤーに「待機状態に戻れ」と命令する
            socket.emit('reset_waiting');
            roomRestartState[roomId].clear(); // リクエスト状態をクリア
            return;
        }

        // 全員（2人）準備OKなら
        if (roomRestartState[roomId].size >= currentMemberCount) {
            io.to(roomId).emit('game_start'); // 再度ゲーム開始合図
            roomRestartState[roomId].clear(); // 状態リセット
        }
    });

    socket.on('disconnect', () => {
        // 切断時はリトライリストから削除するなどが必要ですが今回は省略
    });
});

server.listen(3000, () => {
    console.log('サーバー起動: http://localhost:3000');
});