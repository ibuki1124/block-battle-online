require('dotenv').config(); 
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require('@supabase/supabase-js'); 

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

// ▼▼▼ 追加: ルーム一覧を配信する関数 ▼▼▼
function notifyRoomList() {
    const rooms = io.sockets.adapter.rooms;
    const waitingRooms = [];

    rooms.forEach((members, roomId) => {
        // 1. ソロモードの部屋は除外
        if (roomId.startsWith('__solo_')) return;
        // 2. ソケットID個別の部屋（デフォルト部屋）は除外
        // (io.sockets.sockets.has(roomId) で判定可能)
        if (io.sockets.sockets.has(roomId)) return;

        // 3. 人数が1人の部屋だけを「待機中」としてリストアップ
        if (members.size === 1) {
            waitingRooms.push(roomId);
        }
    });

    // 全員に最新の待機部屋リストを送信
    io.emit('update_room_list', waitingRooms);
}
// ▲▲▲ ここまで ▲▲▲

io.on('connection', (socket) => {
    
    // 接続時にも最新リストを送る
    notifyRoomList();

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
            if (updatedRoom) {
                for (const id of updatedRoom) {
                    players.push({ id: id, name: playerNames[id] });
                }
            }
            io.to(roomId).emit('update_names', players);

            if (userCount + 1 === 2) {
                io.to(roomId).emit('game_start');
            }
            
            // ▼▼▼ 追加: 部屋状況が変わったのでリスト更新通知 ▼▼▼
            notifyRoomList(); 
            // ▲▲▲
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
        // ソロ部屋はリストに載らないので notifyRoomList は不要
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
        // ▼▼▼ 追加: 退出直前の状態ではまだadapterに残っているため、少し待つか、disconnectで処理 ▼▼▼
    });

    socket.on('disconnect', () => {
        // ▼▼▼ 追加: 完全に切断された後にリスト更新 ▼▼▼
        notifyRoomList();
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
            
            // ▼▼▼ 追加: リセット時に待機状態に戻るのでリスト更新 ▼▼▼
            notifyRoomList();
            return;
        }
        if (roomRestartState[roomId].size >= currentMemberCount) {
            io.to(roomId).emit('game_start');
            roomRestartState[roomId].clear(); 
            // ▼▼▼ 追加: ゲーム開始（満員）なのでリスト更新 ▼▼▼
            notifyRoomList();
        }
    });

    // ▼▼▼ ランキング機能 ▼▼▼
    // (変更なし)
    socket.on('submit_score', async (data) => {
        const name = playerNames[socket.id] || 'Guest';
        const score = data.score;
        const userId = data.userId;
        const difficulty = data.difficulty || 'normal';
        if (!userId) return; 
        const { error } = await supabase.from('scores').insert([{ name: name, score: score, user_id: userId, difficulty: difficulty }]);
        if (error) console.error('Score save error:', error);
    });

    socket.on('request_ranking', async (difficulty) => {
        const targetDiff = difficulty || 'normal';
        const { data, error } = await supabase.from('scores').select('name, score, user_id, created_at').eq('difficulty', targetDiff).order('score', { ascending: false }).limit(100);
        if (!error) {
            const uniqueRanking = [];
            const userIds = new Set();
            for (const record of data) {
                if (!userIds.has(record.user_id)) {
                    uniqueRanking.push(record);
                    userIds.add(record.user_id);
                }
                if (uniqueRanking.length >= 10) break;
            }
            socket.emit('ranking_data', uniqueRanking);
        } else {
            console.error('Ranking fetch error:', error);
        }
    });

    socket.on('request_my_ranking', async (data) => {
        let userId, difficulty;
        if (typeof data === 'object') {
            userId = data.userId;
            difficulty = data.difficulty || 'normal';
        } else {
            userId = data;
            difficulty = 'normal';
        }
        if (!userId) return;
        const { data: records, error } = await supabase.from('scores').select('name, score, created_at').eq('user_id', userId).eq('difficulty', difficulty).order('score', { ascending: false }).limit(10);
        if (!error) {
            socket.emit('ranking_data', records);
        } else {
            console.error('My ranking fetch error:', error);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバー起動: ポート ${PORT}`);
});