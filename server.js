const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 部屋ごとのリトライ希望者を管理するセット
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

    // ▼▼▼ 新規：ゲームオーバー通知（敗北宣言） ▼▼▼
    socket.on('player_gameover', (roomId) => {
        // 送ってきた本人は「負け」、部屋の他の人は「勝ち」
        // "opponent_won" を部屋の他の人に送る
        socket.broadcast.to(roomId).emit('opponent_won');
    });

    // ▼▼▼ 新規：リトライ要求 ▼▼▼
    socket.on('restart_request', (roomId) => {
        if (!roomRestartState[roomId]) {
            roomRestartState[roomId] = new Set();
        }
        
        // リクエストした人を記録
        roomRestartState[roomId].add(socket.id);

        // 部屋の人数（通常2人）全員がリトライを希望したら再開
        const room = io.sockets.adapter.rooms.get(roomId);
        const currentMemberCount = room ? room.size : 0;

        // 全員準備OKなら
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