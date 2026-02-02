const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const roomRestartState = {};
// ★追加: プレイヤー名を保存するオブジェクト
const playerNames = {}; 

io.on('connection', (socket) => {
    
    // ▼▼▼ 修正: 名前(playerName)を受け取る ▼▼▼
    socket.on('join_game', (roomId, playerName) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount < 2) {
            socket.join(roomId);
            
            // ★追加: 名前を保存（空ならGuest）
            playerNames[socket.id] = playerName || 'Guest';

            socket.emit('join_success', roomId, 'multi');
            
            // ★追加: 部屋にいる全員の名前リストを作成して送信
            const updatedRoom = io.sockets.adapter.rooms.get(roomId);
            const players = [];
            for (const id of updatedRoom) {
                players.push({ id: id, name: playerNames[id] });
            }
            io.to(roomId).emit('update_names', players); // 全員に通知

            if (userCount + 1 === 2) {
                io.to(roomId).emit('game_start');
            }
        } else {
            socket.emit('join_full');
        }
    });

    // ▼▼▼ 修正: 名前を受け取る ▼▼▼
    socket.on('join_practice', (playerName) => {
        const roomId = `__solo_${socket.id}`; 
        socket.join(roomId);
        
        // ★追加: 名前を保存
        playerNames[socket.id] = playerName || 'Guest';
        
        socket.emit('join_success', roomId, 'solo');
        
        // ★追加: 自分の名前を反映させるため送信
        socket.emit('update_names', [{ id: socket.id, name: playerNames[socket.id] }]);
        
        socket.emit('game_start');
    });

    // 切断時の処理
    socket.on('disconnect', () => {
        // ★追加: 名前データを削除
        if (playerNames[socket.id]) {
            delete playerNames[socket.id];
        }
    });

    // その他の処理は変更なし
    socket.on('update_board', (data) => {
        socket.broadcast.to(data.roomId).emit('opponent_board', data);
    });

    socket.on('attack', (data) => {
        socket.broadcast.to(data.roomId).emit('receive_attack', data.lines);
    });

    socket.on('player_gameover', (roomId) => {
        socket.broadcast.to(roomId).emit('opponent_won');
    });

    socket.on('restart_request', (roomId) => {
        if (roomId.startsWith('__solo_')) {
            io.to(roomId).emit('game_start');
            return;
        }

        if (!roomRestartState[roomId]) {
            roomRestartState[roomId] = new Set();
        }
        
        roomRestartState[roomId].add(socket.id);

        const room = io.sockets.adapter.rooms.get(roomId);
        const currentMemberCount = room ? room.size : 0;

        if (currentMemberCount < 2) {
            socket.emit('reset_waiting');
            roomRestartState[roomId].clear();
            return;
        }

        if (roomRestartState[roomId].size >= currentMemberCount) {
            io.to(roomId).emit('game_start');
            roomRestartState[roomId].clear(); 
        }
    });
});

server.listen(3000, () => {
    console.log('サーバー起動: http://localhost:3000');
});