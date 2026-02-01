const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    // クライアントから「入室したい」と言われた時の処理
    socket.on('join_game', (roomId) => {
        // その部屋に今何人いるか確認
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount < 2) {
            // 2人未満なら入室OK
            socket.join(roomId);
            console.log(`User: ${socket.id} が Room: ${roomId} に入室しました`);

            // 本人に「入室できたよ」と伝える
            socket.emit('join_success', roomId);

            // 部屋にいる全員（自分含む）に「今〇〇人いるよ」と伝える
            io.to(roomId).emit('player_count', userCount + 1);

            // もし2人になったら「対戦開始！」の合図を送る
            if (userCount + 1 === 2) {
                io.to(roomId).emit('game_start');
            }

        } else {
            // 満員なら拒否
            socket.emit('join_full');
        }
    });

    socket.on('disconnect', () => {
        console.log('ユーザー切断:', socket.id);
        // ※ここでの切断処理（相手に勝ったことにするなど）は後ほど実装します
    });
});

server.listen(3000, () => {
    console.log('サーバー起動: http://localhost:3000');
});