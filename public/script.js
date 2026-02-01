const socket = io();

// 入室ボタンを押した時の処理
function joinRoom() {
    const roomId = document.getElementById('room-input').value;
    if (roomId) {
        socket.emit('join_game', roomId); // サーバーへ「この部屋入れて」と送信
    } else {
        alert("部屋IDを入力してください");
    }
}

// サーバーから「入室できたよ」と言われたら
socket.on('join_success', (roomId) => {
    // 入室画面を消して、ゲーム画面を出す
    document.getElementById('join-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('current-room').innerText = roomId;
});

// サーバーから「満員だよ」と言われたら
socket.on('join_full', () => {
    document.getElementById('error-msg').innerText = "その部屋は満員です！";
});

// サーバーから「対戦開始」の合図が来たら
socket.on('game_start', () => {
    document.getElementById('status').innerText = "対戦者が揃いました！ゲーム開始！";
    document.getElementById('status').style.color = "red";
    document.getElementById('status').style.fontWeight = "bold";
});