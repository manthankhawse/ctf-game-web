// public/client.js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const TILE_SIZE = 30;
const GRID_SIZE = 20;

const playerIdElem = document.getElementById('player-id');
const gameStatusElem = document.getElementById('game-status');
const blueScoreElem = document.getElementById('blue-score');
const redScoreElem = document.getElementById('red-score');

let myTeam = null;

const ws = new WebSocket(`ws://${window.location.host}`);

ws.onopen = () => console.log('Connected to server');
ws.onclose = () => gameStatusElem.textContent = 'Disconnected. Please refresh.';

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'assignPlayer') {
        myTeam = message.team;
        playerIdElem.textContent = `You are: ${myTeam.toUpperCase()}`;
        playerIdElem.style.color = myTeam === 'blue' ? '#3498db' : '#e74c3c';
    } else if (message.type === 'gameState') {
        drawGame(message.state);
        updateUI(message.state);
    } else if (message.type === 'gameOver') {
        alert(`${message.winner.toUpperCase()} WINS! A new game will begin.`);
    } else if (message.type === 'error') {
        gameStatusElem.textContent = message.message;
    }
};

function drawGame(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw bases
    ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
    ctx.fillRect(0, 0, TILE_SIZE * 3, canvas.height);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
    ctx.fillRect(canvas.width - TILE_SIZE * 3, 0, TILE_SIZE * 3, canvas.height);

    // Draw flags
    const { flags, players } = state;
    if (flags.blue && !flags.blue.carriedBy) drawFlag(flags.blue, '#3498db');
    if (flags.red && !flags.red.carriedBy) drawFlag(flags.red, '#e74c3c');

    // Draw players
    for (const id in players) {
        drawPlayer(players[id]);
        if (players[id].hasFlag) {
             drawFlagOnPlayer(players[id]);
        }
    }
}

function drawPlayer(player) {
    ctx.fillStyle = player.team === 'blue' ? '#3498db' : '#e74c3c';
    ctx.beginPath();
    ctx.arc(player.x * TILE_SIZE + TILE_SIZE / 2, player.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, 2 * Math.PI);
    ctx.fill();

    if (player.team === myTeam) {
        ctx.strokeStyle = 'gold';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

function drawFlag(flag, color) {
    ctx.fillStyle = color;
    ctx.fillRect(flag.x * TILE_SIZE + 5, flag.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Poppins';
    ctx.fillText('F', flag.x * TILE_SIZE + 10, flag.y * TILE_SIZE + 20);
}

function drawFlagOnPlayer(player) {
    const flagColor = player.hasFlag === 'blue' ? '#3498db' : '#e74c3c';
    ctx.fillStyle = flagColor;
    ctx.fillRect(player.x * TILE_SIZE + 8, player.y * TILE_SIZE - 12, TILE_SIZE - 16, TILE_SIZE - 16);
}

function updateUI(state) {
    blueScoreElem.textContent = state.scores.blue;
    redScoreElem.textContent = state.scores.red;
    if (Object.keys(state.players).length < 2) {
        gameStatusElem.textContent = 'Waiting for another player...';
    } else {
        gameStatusElem.textContent = 'Game in progress!';
    }
}

// --- Input Handling for Smooth Movement ---
let keys = {};
window.addEventListener('keydown', (e) => {
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !keys[e.key]) {
        keys[e.key] = true;
        let direction = getDirectionFromKey(e.key);
        if(direction) ws.send(JSON.stringify({ type: 'start_move', direction }));
    }
});

window.addEventListener('keyup', (e) => {
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keys[e.key] = false;
        let direction = getDirectionFromKey(e.key);
        if(direction) ws.send(JSON.stringify({ type: 'stop_move', direction }));
    }
});

function getDirectionFromKey(key) {
    switch (key) {
        case 'ArrowUp': case 'w': return 'up';
        case 'ArrowDown': case 's': return 'down';
        case 'ArrowLeft': case 'a': return 'left';
        case 'ArrowRight': case 'd': return 'right';
        default: return null;
    }
}