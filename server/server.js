// server-webrtc.js
// Authoritative Server (State Synchronization Model)
// Uses WebSockets for signaling and WebRTC (UDP) for game data.

const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('werift');

// --- Game Constants ---
const GRID_SIZE = 20;
const WIN_SCORE = 3;
const TICK_RATE = 1000 / 20; // 60 ticks per second

// --- Server State ---
const wsServer = new WebSocket.Server({ port: 3000 });
console.log('WebSocket Signaling Server running on port 3000');

let waitingPlayers = {
    '1v1': [],
    '2v2': [],
    '3v3': []
};
let gameRooms = {}; // { 'roomId': new GameRoom(...) }

// --- GameRoom Class ---
// Manages a single game, including its loop and players
class GameRoom {
    constructor(roomId, mode, playerClients) {
        this.roomId = roomId;
        this.mode = mode;
        this.gameLoopInterval = null;
        this.playerMovements = {}; // { 'blue1': { up: false, ... }, 'red1': ... }
        this.players = {}; // { 'clientId': { pc, dc, info: { id, team } } }

        this.gameState = {
            players: {},
            flags: {
                blue: { x: 1, y: 9, carriedBy: null },
                red: { x: 18, y: 9, carriedBy: null }
            },
            scores: { blue: 0, red: 0 }
        };

        const assignments = teamAssignments[mode];
        
        console.log(`[Room ${roomId}]: Creating ${mode} game...`);

        // 1. Create a server-side PeerConnection for EACH player
        playerClients.forEach((client, index) => {
            const playerId = assignments[index];
            const team = playerId.includes('blue') ? 'blue' : 'red';
            
            const playerInfo = { id: playerId, team: team };
            this.setupPlayer(client, playerInfo);
        });
    }

    // Sets up a single player's WebRTC connection to this server
    async setupPlayer(client, playerInfo) {
        // 1. Create the Server's-side PC for this player
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        // 2. Create the Data Channel (UDP)
        const dc = pc.createDataChannel('gameData', {
            ordered: false,
            maxRetransmits: 0 // UDP-like behavior
        });

        // 3. Store this player
        this.players[client.clientId] = { pc, dc, info: playerInfo };
        // Initialize movement state
        this.playerMovements[playerInfo.id] = { up: false, down: false, left: false, right: false };

        // 4. Handle Data Channel events
        dc.onopen = () => {
            console.log(`[Room ${this.roomId}]: Data channel OPEN for ${playerInfo.id}`);
            this.addPlayerToState(playerInfo);
            
            // Check if all players are now connected
            if (Object.keys(this.players).length === Object.keys(this.gameState.players).length) {
                console.log(`[Room ${this.roomId}]: All players connected. Starting game loop.`);
                this.startGameLoop();
            }
        };
        
        // --- THIS IS THE KEY INPUT LOGIC ---
        // Listen for the client's full input state
        dc.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'client_input' && message.inputState) {
                // Directly set the movement state from the client
                if (this.playerMovements[playerInfo.id]) {
                    this.playerMovements[playerInfo.id] = message.inputState;
                }
            }
        };

        dc.onclose = () => {
            console.log(`[Room ${this.roomId}]: Data channel CLOSED for ${playerInfo.id}`);
            this.removePlayer(client.clientId, playerInfo.id);
        };
        
        // 5. Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                client.ws.send(JSON.stringify({
                    type: 'server_ice_candidate',
                    candidate: event.candidate // No .toJSON() needed
                }));
            }
        };

        // 6. Create and send the 'offer' to the client
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        client.ws.send(JSON.stringify({
            type: 'server_offer',
            offer: offer, // No .toJSON() needed
            playerInfo: playerInfo, 
            allPlayers: teamAssignments[this.mode].map(id => ({ id, team: id.includes('blue') ? 'blue' : 'red' }))
        }));
    }

    // Client sends an answer back
    async handleAnswer(clientId, answer) {
        const pc = this.players[clientId]?.pc;
        if (pc) {
            await pc.setRemoteDescription(answer); // No 'new RTCSessionDescription'
            console.log(`[Room ${this.roomId}]: Set remote (answer) for ${this.players[clientId].info.id}`);
        }
    }

    // Client sends an ICE candidate back
    async handleIceCandidate(clientId, candidate) {
        const pc = this.players[clientId]?.pc;
        if (pc && candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    // --- Game Logic ---
    addPlayerToState(playerInfo) {
        const isBlue = playerInfo.team === 'blue';
        const yPos = 9 + (parseInt(playerInfo.id.slice(-1)) % 2 === 0 ? 2 : -2);
        this.gameState.players[playerInfo.id] = {
            x: isBlue ? 1 : 18,
            y: yPos,
            team: playerInfo.team,
            hasFlag: null
        };
    }

    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            this.runGameTick();
        }, TICK_RATE);
    }
    
    runGameTick() {
        // 1. Update positions based on the latest input state
        for (const playerId in this.playerMovements) {
            const moves = this.playerMovements[playerId];
            const player = this.gameState.players[playerId];
            if (!player) continue;

            let targetX = player.x, targetY = player.y;
            if (moves.up) targetY--;
            if (moves.down) targetY++;
            if (moves.left) targetX--;
            if (moves.right) targetX++;
            targetX = Math.max(0, Math.min(GRID_SIZE - 1, targetX));
            targetY = Math.max(0, Math.min(GRID_SIZE - 1, targetY));

            let collision = false;
            for (const otherPlayerId in this.gameState.players) {
                if (playerId === otherPlayerId) continue;
                const otherPlayer = this.gameState.players[otherPlayerId];
                if (targetX === otherPlayer.x && targetY === otherPlayer.y) {
                    collision = true;
                    break;
                }
            }
             if (!collision) {
                player.x = targetX;
                player.y = targetY;
            }
        }

        // 2. Check logic
        let globalWinner = null;
        for (const playerId in this.gameState.players) {
            const { newState, gameOverWinner } = this.checkGameLogic(playerId, this.gameState);
            this.gameState = newState;
            if (gameOverWinner) globalWinner = gameOverWinner;
        }

        // 3. Broadcast state
        const stateMessage = JSON.stringify({ type: 'gameState', state: this.gameState });
        for (const clientId in this.players) {
            const { dc } = this.players[clientId];
            if (dc.readyState === 'open') {
                dc.send(stateMessage);
            }
        }

        // 4. Handle game over
        if (globalWinner) {
           console.log(`[Room ${this.roomId}]: Game over! Winner: ${globalWinner}`);
            const gameOverMessage = JSON.stringify({ type: 'gameOver', winner: globalWinner });
            for (const clientId in this.players) {
                const { dc } = this.players[clientId];
                if (dc.readyState === 'open') dc.send(gameOverMessage);
            }
            // Reset game
            this.gameState.scores = { blue: 0, red: 0 };
            this.resetRound();
        }
    }

    checkGameLogic(playerId, currentState) {
        let newState = JSON.parse(JSON.stringify(currentState));
        let gameOverWinner = null;
        const player = newState.players[playerId];
        if (!player) return { newState, gameOverWinner };
        const playerTeam = player.team;
        const opponentTeam = playerTeam === 'blue' ? 'red' : 'blue';
       const opponentFlag = newState.flags[opponentTeam];
        const homeBaseCenter = playerTeam === 'blue' ? { x: 1, y: 9 } : { x: 18, y: 9 };
        if (player.x === opponentFlag.x && player.y === opponentFlag.y && !player.hasFlag) {
            player.hasFlag = opponentTeam;
            opponentFlag.carriedBy = playerId;
     }
        const inHomeBase = (playerTeam === 'blue' && player.x <= 2) || (playerTeam === 'red' && player.x >= 17);
        if (player.hasFlag && inHomeBase) {
            newState.scores[playerTeam]++;
            if (newState.scores[playerTeam] >= WIN_SCORE) {
                gameOverWinner = playerTeam; 
            } else {
                newState = this.resetRound(newState); 
            }
        }
        for (const oppId in newState.players) {
            const opponent = newState.players[oppId];
            if (opponent.team === opponentTeam && opponent.hasFlag === playerTeam) {
               if (player.x === opponent.x && player.y === opponent.y) {
                    const returnedFlag = newState.flags[playerTeam];
                    returnedFlag.x = homeBaseCenter.x; 
                   returnedFlag.y = homeBaseCenter.y;
                    returnedFlag.carriedBy = null;
                    opponent.hasFlag = null;
                }
            }
        }
        return { newState, gameOverWinner };
    }

    resetRound(state = this.gameState) {
        for (const playerId in state.players) {
            const player = state.players[playerId];
            const isBlue = player.team === 'blue';
            const yPos = 9 + (parseInt(playerId.slice(-1)) % 2 === 0 ? 2 : -2); 
            player.x = isBlue ? 1 : 18;
            player.y = yPos;
            player.hasFlag = null;
        }
        state.flags.blue = { x: 1, y: 9, carriedBy: null };
        state.flags.red = { x: 18, y: 9, carriedBy: null };
        return state;
    }

    // Remove a player (e.g., on disconnect)
    removePlayer(clientId, playerId) {
        console.log(`[Room ${this.roomId}]: Removing player ${playerId}`);
        delete this.players[clientId];
        delete this.gameState.players[playerId];
        delete this.playerMovements[playerId];

       // Check if room is empty
        if (Object.keys(this.players).length === 0) {
            console.log(`[Room ${this.roomId}]: Room is empty, closing.`);
            clearInterval(this.gameLoopInterval);
           delete gameRooms[this.roomId];
        }
    }
}

// --- WebSocket Signaling Logic ---

const modeRequirements = {
    '1v1': 2,
    '2v2': 4,
    '3v3': 6
};
const teamAssignments = {
    '1v1': ['blue1', 'red1'],
    '2v2': ['blue1', 'red1', 'blue2', 'red2'],
    '3v3': ['blue1', 'red1', 'blue2', 'red2', 'blue3', 'red3']
};
let clients = {}; // { 'clientId': { ws, clientId } }

wsServer.on('connection', (ws) => {
    const clientId = uuidv4();
    clients[clientId] = { ws, clientId };
    console.log(`Client ${clientId} connected via WebSocket.`);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        // This client's GameRoom (if they are in one)
        const room = gameRooms[clients[clientId]?.roomId];

        switch (data.type) {
            case 'join_game':
                if (!waitingPlayers[data.mode]) {
                    console.log(`Invalid game mode: ${data.mode}`);
                    return;
                }
                console.log(`Client ${clientId} joining queue for ${data.mode}`);
                clients[clientId].mode = data.mode;
                waitingPlayers[data.mode].push(clients[clientId]);
                
                // Check if we have enough players
                const mode = data.mode;
               if (waitingPlayers[mode].length >= modeRequirements[mode]) {
                    // Create new room
                    const playersForGame = waitingPlayers[mode].splice(0, modeRequirements[mode]);
                    const roomId = uuidv4();
                    
                   playersForGame.forEach(client => {
                        clients[client.clientId].roomId = roomId;
                    });

                    gameRooms[roomId] = new GameRoom(roomId, mode, playersForGame);
               }
                break;
            
            // Client sent their 'answer'
            case 'client_answer':
                if (room) {
                    room.handleAnswer(clientId, data.answer);
               }
                break;
            
            // Client sent an ICE candidate
            case 'client_ice_candidate':
                if (room && data.candidate) {
                    room.handleIceCandidate(clientId, data.candidate);
               }
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Client ${clientId} disconnected.`);
        const client = clients[clientId];
        
        // Safety check if client disconnected before setup
        if (!client) return; 

        const roomId = client.roomId;
        
        if (roomId && gameRooms[roomId]) {
            // They were in a game, let the room handle it
            const playerInfo = gameRooms[roomId].players[clientId]?.info;
            if (playerInfo) {
                gameRooms[roomId].removePlayer(clientId, playerInfo.id);
            }
        } else {
            // They were in a queue, remove them
           if (client.mode && waitingPlayers[client.mode]) {
                waitingPlayers[client.mode] = waitingPlayers[client.mode].filter(p => p.clientId !== clientId);
            }
        }
        delete clients[clientId];
    });
});