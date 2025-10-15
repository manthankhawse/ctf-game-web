// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

// --- Game Constants ---
const GRID_SIZE = 20;
const WIN_SCORE = 3;
const TICK_RATE = 1000 / 10; // Update 10 times per second

// --- Game State Management ---
let players = {}; // Stores WebSocket connections { 'blue': ws, 'red': ws }
let playerMovements = {}; // { 'blue': { up: false, ... }, 'red': { up: false, ... } }
let gameStarted = false;

let gameState = {
    players: {},
    flags: {
        blue: { x: 1, y: 9, carriedBy: null },
        red: { x: 18, y: 9, carriedBy: null }
    },
    scores: { blue: 0, red: 0 }
};

const resetGame = () => {
    console.log("Resetting game for new match...");
    gameState.scores = { blue: 0, red: 0 };
    resetRound();
};

const resetRound = () => {
    // Reset player positions and flag status
    if (gameState.players.blue) {
        gameState.players.blue.x = 1;
        gameState.players.blue.y = 9;
        gameState.players.blue.hasFlag = null;
    }
    if (gameState.players.red) {
        gameState.players.red.x = 18;
        gameState.players.red.y = 9;
        gameState.players.red.hasFlag = null;
    }
    gameState.flags.blue = { x: 1, y: 9, carriedBy: null };
    gameState.flags.red = { x: 18, y: 9, carriedBy: null };
};

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('Client connected');
    let playerId = null;

    if (!players.blue) {
        playerId = 'blue';
        players.blue = ws;
        gameState.players.blue = { x: 1, y: 9, team: 'blue', hasFlag: null };
        playerMovements.blue = { up: false, down: false, left: false, right: false };
    } else if (!players.red) {
        playerId = 'red';
        players.red = ws;
        gameState.players.red = { x: 18, y: 9, team: 'red', hasFlag: null };
        playerMovements.red = { up: false, down: false, left: false, right: false };
    } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
        ws.close();
        return;
    }

    ws.send(JSON.stringify({ type: 'assignPlayer', team: playerId }));

    if (players.blue && players.red && !gameStarted) {
        gameStarted = true;
        console.log('Game started!');
    }

    ws.on('message', (message) => {
        if (!gameStarted || !playerId) return;
        const data = JSON.parse(message);
        
        if (data.type === 'start_move') {
            playerMovements[playerId][data.direction] = true;
        } else if (data.type === 'stop_move') {
            playerMovements[playerId][data.direction] = false;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected`);
        if (playerId) {
            delete players[playerId];
            delete gameState.players[playerId];
            delete playerMovements[playerId];
            gameStarted = false;
            resetGame();
            broadcastGameState(); // Inform remaining player
        }
    });
});

// --- Game Logic ---
function checkGameLogic(playerId) {
    if (!gameState.players[playerId]) return;

    const player = gameState.players[playerId];
    const opponentId = playerId === 'blue' ? 'red' : 'blue';
    const opponent = gameState.players[opponentId];
    const opponentFlag = gameState.flags[opponentId];
    const homeBase = playerId === 'blue' ? { x: 1, y: 9 } : { x: 18, y: 9 };

    // Flag pickup
    if (player.x === opponentFlag.x && player.y === opponentFlag.y && !player.hasFlag) {
        player.hasFlag = opponentId;
        opponentFlag.carriedBy = playerId;
    }

    // Flag scoring
    if (player.hasFlag && player.x === homeBase.x && player.y === homeBase.y) {
        gameState.scores[playerId]++;
        if (gameState.scores[playerId] >= WIN_SCORE) {
            broadcastGameOver(playerId);
            resetGame();
        } else {
            resetRound();
        }
    }

    // Flag return (tagging)
    if (opponent && opponent.hasFlag === playerId && player.x === opponent.x && player.y === opponent.y) {
        const returnedFlag = gameState.flags[playerId];
        returnedFlag.x = homeBase.x;
        returnedFlag.y = homeBase.y;
        returnedFlag.carriedBy = null;
        opponent.hasFlag = null;
    }
}

// --- Main Game Loop ---
function gameLoop() {
    if (!gameStarted) return;
    
    // 1. Update positions based on movement flags
    for (const playerId in playerMovements) {
        const moves = playerMovements[playerId];
        const player = gameState.players[playerId];
        if (!player) continue;

        let targetX = player.x;
        let targetY = player.y;

        if (moves.up) targetY--;
        if (moves.down) targetY++;
        if (moves.left) targetX--;
        if (moves.right) targetX++;
        
        targetX = Math.max(0, Math.min(GRID_SIZE - 1, targetX));
        targetY = Math.max(0, Math.min(GRID_SIZE - 1, targetY));

        const opponentId = playerId === 'blue' ? 'red' : 'blue';
        const opponent = gameState.players[opponentId];
        if (!opponent || (targetX !== opponent.x || targetY !== opponent.y)) {
             player.x = targetX;
             player.y = targetY;
        }
    }
    
    // 2. Check for game events (flag captures, scores)
    Object.keys(gameState.players).forEach(checkGameLogic);
    
    // 3. Broadcast the new state to all clients
    broadcastGameState();
}

// --- Broadcasting Functions ---
function broadcastGameState() {
    const stateMessage = JSON.stringify({ type: 'gameState', state: gameState });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(stateMessage);
    });
}

function broadcastGameOver(winner) {
    const gameOverMessage = JSON.stringify({ type: 'gameOver', winner });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(gameOverMessage);
    });
}

// --- Server Start ---
setInterval(gameLoop, TICK_RATE);
server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});