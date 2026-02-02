const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const roomRestartState = {};
const playerNames = {}; 

io.on('connection', (socket) => {
    
    // 入室
    socket.on('join_game', (roomId, playerName) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount < 2) {
            socket.join(roomId);
            playerNames[socket.id] = playerName || 'Guest';

            socket.emit('join_success', roomId, 'multi');
            
            // 名前リスト更新
            const updatedRoom = io.sockets.adapter.rooms.get(roomId);
            const players = [];
            for (const id of updatedRoom) {
                players.push({ id: id, name: playerNames[id] });
            }
            io.to(roomId).emit('update_names', players);

            if (userCount + 1 === 2) {
                io.to(roomId).emit('game_start');
            }
        } else {
            socket.emit('join_full');
        }
    });

    // 練習モード
    socket.on('join_practice', (playerName) => {
        const roomId = `__solo_${socket.id}`; 
        socket.join(roomId);
        playerNames[socket.id] = playerName || 'Guest';
        socket.emit('join_success', roomId, 'solo');
        socket.emit('update_names', [{ id: socket.id, name: playerNames[socket.id] }]);
        socket.emit('game_start');
    });

    // ★修正: 切断処理（disconnectingを使う）
    socket.on('disconnecting', () => {
        // 名前削除
        if (playerNames[socket.id]) {
            delete playerNames[socket.id];
        }
        
        // 自分がいた部屋に残っている人（対戦相手）に通知
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit('opponent_left');
            }
        }
    });

    socket.on('disconnect', () => {
        // ここは空でもOK（disconnectingで処理済み）
    });

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