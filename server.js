require('dotenv').config(); // 環境変数を読み込む
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require('@supabase/supabase-js'); // 追加

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ▼▼▼ Supabase設定 ▼▼▼
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static('public'));

const roomRestartState = {};
const playerNames = {}; 

io.on('connection', (socket) => {
    
    // ... (既存の join_game, join_practice などの処理はそのまま維持) ...
    // ※以下、既存コードの io.on('connection') の中に追記してください

    // 入室
    socket.on('join_game', (roomId, playerName) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const userCount = room ? room.size : 0;

        if (userCount < 2) {
            socket.join(roomId);
            playerNames[socket.id] = playerName || 'Guest';

            socket.emit('join_success', roomId, 'multi');
            
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

    socket.on('join_practice', (playerName) => {
        const roomId = `__solo_${socket.id}`; 
        socket.join(roomId);
        playerNames[socket.id] = playerName || 'Guest';
        socket.emit('join_success', roomId, 'solo');
        socket.emit('update_names', [{ id: socket.id, name: playerNames[socket.id] }]);
        socket.emit('game_start');
    });

    socket.on('disconnecting', () => {
        if (playerNames[socket.id]) {
            delete playerNames[socket.id];
        }
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit('opponent_left');
            }
        }
    });

    socket.on('disconnect', () => {});

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

    // ▼▼▼ 追加: ランキング機能用イベント ▼▼▼

    // スコア送信（ソロモード終了時）
    socket.on('submit_score', async (score) => {
        const name = playerNames[socket.id] || 'Guest';
        // データベースに保存
        const { error } = await supabase
            .from('scores')
            .insert([{ name: name, score: score }]);
        
        if (error) console.error('Score save error:', error);
    });

    // ランキング取得リクエスト
    socket.on('request_ranking', async () => {
        // スコアの高い順にトップ10を取得
        const { data, error } = await supabase
            .from('scores')
            .select('name, score, created_at')
            .order('score', { ascending: false })
            .limit(10);
        
        if (!error) {
            socket.emit('ranking_data', data);
        } else {
            console.error('Ranking fetch error:', error);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバー起動: ポート ${PORT}`);
});