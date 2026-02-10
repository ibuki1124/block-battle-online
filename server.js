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

// ▼▼▼ 追加: ユーザーIDを管理する変数 ▼▼▼
const playerUserIds = {}; // socket.id -> user_id
// ▲▲▲ ここまで ▲▲▲

// ▼▼▼ 修正: ルーム一覧配信 (作成者名も含めるように変更) ▼▼▼
function notifyRoomList() {
    const rooms = io.sockets.adapter.rooms;
    const waitingRooms = [];

    rooms.forEach((members, roomId) => {
        // 1. ソロモードの部屋は除外
        if (roomId.startsWith('__solo_')) return;
        // 2. ソケットID個別の部屋（デフォルト部屋）は除外
        if (io.sockets.sockets.has(roomId)) return;
        // 3. 人数が1人の部屋だけを「待機中」としてリストアップ
        if (members.size === 1) {
            // 部屋にいる唯一のメンバー(作成者)のSocket IDを取得
            const creatorSocketId = [...members][0];
            // 保存されている名前を取得 (なければ Guest)
            const creatorName = playerNames[creatorSocketId] || 'Guest';
            // IDと名前をオブジェクトとして追加
            waitingRooms.push({
                id: roomId,
                creator: creatorName
            });
        }
    });

    io.emit('update_room_list', waitingRooms);
}
// ▲▲▲ ここまで ▲▲▲

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

    // ▼▼▼ 修正: userIdを受け取り保存する ▼▼▼
    socket.on('create_room', (playerName, userId) => { // 引数追加
        const roomId = generateRoomId(); 
        if (!roomId) {
            socket.emit('join_error', '現在アクセスが集中しており部屋を作成できませんでした。もう一度お試しください。');
            return;
        }
        socket.join(roomId);
        playerNames[socket.id] = playerName || 'Guest';
        playerUserIds[socket.id] = userId; // UserIDを保存

        socket.emit('join_success', roomId, 'multi');
        io.to(roomId).emit('update_names', [{ id: socket.id, name: playerNames[socket.id] }]);
        notifyRoomList();
    });
    // ▲▲▲ ここまで ▲▲▲

    // ▼▼▼ 修正: userIdを受け取り保存する ▼▼▼
    socket.on('join_game', (roomId, playerName, userId) => { // 引数追加
        const room = io.sockets.adapter.rooms.get(roomId);
        
        if (!room || io.sockets.sockets.has(roomId)) {
            socket.emit('join_error', 'その部屋IDは見つかりません');
            return;
        }

        const userCount = room.size;

        if (userCount < 2) {
            socket.join(roomId);
            playerNames[socket.id] = playerName || 'Guest';
            playerUserIds[socket.id] = userId; // UserIDを保存

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
        // ▼▼▼ 追加: UserID情報の削除 ▼▼▼
        if (playerUserIds[socket.id]) {
            delete playerUserIds[socket.id];
        }
        // ▲▲▲ ここまで ▲▲▲
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

    // ▼▼▼ 修正: 勝敗判定とDB保存処理 (ID保存に対応) ▼▼▼
    socket.on('player_gameover', async (roomId) => {
        socket.broadcast.to(roomId).emit('opponent_won');
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room && room.size === 2) {
            const loserSocketId = socket.id;
            const winnerSocketId = [...room].find(id => id !== loserSocketId);
            if (!winnerSocketId) return;
            const loserName = playerNames[loserSocketId];
            const winnerName = playerNames[winnerSocketId];
            const loserUserId = playerUserIds[loserSocketId];
            const winnerUserId = playerUserIds[winnerSocketId];
            // 敗者の記録 (相手=勝者)
            if (loserUserId) {
                await supabase.from('match_history').insert([{
                    user_id: loserUserId,
                    opponent_name: winnerName || 'Guest',
                    opponent_id: winnerUserId || null, // ★追加: 相手のID
                    result: 'LOSE'
                }]);
            }
            // 勝者の記録 (相手=敗者)
            if (winnerUserId) {
                await supabase.from('match_history').insert([{
                    user_id: winnerUserId,
                    opponent_name: loserName || 'Guest',
                    opponent_id: loserUserId || null, // ★追加: 相手のID
                    result: 'WIN'
                }]);
            }
        }
    });
    // ▲▲▲ ここまで ▲▲▲

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

    // ▼▼▼ 追加: 対戦履歴の取得リクエスト ▼▼▼
    socket.on('request_match_history', async (userId) => {
        if (!userId) return;
        // 1. まず履歴データを取得
        const { data: historyData, error } = await supabase
            .from('match_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error('History fetch error:', error);
            return;
        }
        // 2. 履歴に含まれる「対戦相手のID」をリストアップ (重複排除)
        const opponentIds = [...new Set(historyData.map(h => h.opponent_id).filter(id => id))];
        if (opponentIds.length > 0) {
            // 3. scoresテーブルから、それらのIDを持つユーザーの最新の名前を取得
            // (名前変更時にscoresも更新されている前提を利用)
            const { data: latestNames } = await supabase
                .from('scores')
                .select('user_id, name')
                .in('user_id', opponentIds)
                .order('created_at', { ascending: false }); // 新しい順
            // 4. IDと名前のマップを作成 (同じIDで複数ある場合は最初=最新を採用)
            const nameMap = {};
            if (latestNames) {
                latestNames.forEach(record => {
                    if (!nameMap[record.user_id]) {
                        nameMap[record.user_id] = record.name;
                    }
                });
            }
            // 5. 履歴データの名前を最新のものに上書き
            historyData.forEach(h => {
                if (h.opponent_id && nameMap[h.opponent_id]) {
                    h.opponent_name = nameMap[h.opponent_id];
                }
            });
        }
        socket.emit('match_history_data', historyData);
    });
    // ▲▲▲ ここまで ▲▲▲
    // ▼▼▼ 追加: 特定ユーザーとの対戦成績を取得 ▼▼▼
    socket.on('request_vs_stats', async (data) => {
        const { myId, opponentId } = data;
        if (!myId || !opponentId) return;
        // その相手との全対戦履歴を取得 (作成日時順)
        const { data: history, error } = await supabase
            .from('match_history')
            .select('*')
            .eq('user_id', myId)
            .eq('opponent_id', opponentId)
            .order('created_at', { ascending: false });
        if (!error && history) {
            const wins = history.filter(h => h.result === 'WIN').length;
            const losses = history.filter(h => h.result === 'LOSE').length;
            socket.emit('vs_stats_result', {
                wins,
                losses,
                opponentId,
                history // ★追加: 履歴リストそのものもクライアントへ送る
            });
        }
    });
    // ▲▲▲ ここまで ▲▲▲
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