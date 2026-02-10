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

// ルーム一覧配信
function notifyRoomList() {
    const rooms = io.sockets.adapter.rooms;
    const waitingRooms = [];

    rooms.forEach((members, roomId) => {
        if (roomId.startsWith('__solo_')) return;
        if (io.sockets.sockets.has(roomId)) return;
        if (members.size === 1) {
            waitingRooms.push(roomId);
        }
    });

    io.emit('update_room_list', waitingRooms);
}

// ▼▼▼ 追加: 6桁のランダムな部屋IDを生成する関数 ▼▼▼
function generateRoomId() {
    let id;
    let maxTries = 100;
    do {
        // 100000 ～ 999999 の乱数を生成
        id = Math.floor(100000 + Math.random() * 900000).toString();
        maxTries--;
    } while (io.sockets.adapter.rooms.has(id) && maxTries > 0);
    return id;
}
// ▲▲▲ ここまで ▲▲▲

io.on('connection', (socket) => {
    
    notifyRoomList();

    // ▼▼▼ 追加: 新規ルーム作成（自動ID割り当て） ▼▼▼
    socket.on('create_room', (playerName) => {
        const roomId = generateRoomId(); // ID自動生成
        
        socket.join(roomId);
        playerNames[socket.id] = playerName || 'Guest';

        // 作成成功としてクライアントへ通知（join_successを流用）
        socket.emit('join_success', roomId, 'multi');
        
        // 自分の情報を更新
        io.to(roomId).emit('update_names', [{ id: socket.id, name: playerNames[socket.id] }]);
        
        // リスト更新
        notifyRoomList();
    });
    // ▲▲▲ ここまで ▲▲▲

    // ▼▼▼ 変更: 既存ルームへの入室（ID指定） ▼▼▼
    socket.on('join_game', (roomId, playerName) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        
        // 部屋が存在しない、またはプライベート部屋ではない（socketIDと同じ）場合はエラー
        if (!room || io.sockets.sockets.has(roomId)) {
            socket.emit('join_error', 'その部屋IDは見つかりません');
            return;
        }

        const userCount = room.size;

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
            
            notifyRoomList(); 
        } else {
            socket.emit('join_full');
        }
    });
    // ▲▲▲ ここまで ▲▲▲

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

    socket.on('disconnect', () => {
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
            notifyRoomList();
            return;
        }
        if (roomRestartState[roomId].size >= currentMemberCount) {
            io.to(roomId).emit('game_start');
            roomRestartState[roomId].clear(); 
            notifyRoomList();
        }
    });

    // ▼▼▼ ランキング機能 (修正: 名前優先処理込み) ▼▼▼
    socket.on('submit_score', async (data) => {
        const name = data.name || playerNames[socket.id] || 'Guest';
        
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