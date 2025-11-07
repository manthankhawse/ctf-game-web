// server.js
// Authoritative Server with Lobby System
// Uses WebSockets for signaling/lobby and WebRTC (UDP) for game data.

const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('werift');

// --- Game Constants ---
const GRID_SIZE = 20;
const WIN_SCORE = 3;
const TICK_RATE = 1000 / 20; // 20 ticks per second
const modeRequirements = {
    '1v1': 2,
    '2v2': 4,
    '3v3': 6
};

// --- Server State ---
const wsServer = new WebSocket.Server({ port: 3000 });
console.log('WebSocket Server running on port 3000');

let clients = {};     // { 'clientId': { ws, clientId, name, lobbyId, roomId } }
let lobbies = {};     // { 'lobbyId': { lobbyId, hostId, mode, isPrivate, maxPlayers, players: { 'clientId': { name, team } } } }
let gameRooms = {}; // { 'roomId': new GameRoom(...) }

// --- Helper Functions ---
// (All helper functions are unchanged)
function generateLobbyCode() {
    let code = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (Removed 0, O, 1, I)
    while (true) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!lobbies[code]) {
            break; // Unique code found
        }
    }
    return code;
}
function countTeam(lobby, team) {
    return Object.values(lobby.players).filter(p => p.team === team).length;
}
function getNextAvailableTeam(lobby) {
    const blueCount = countTeam(lobby, 'blue');
    const redCount = countTeam(lobby, 'red');
    return blueCount <= redCount ? 'blue' : 'red';
}
function broadcastToLobby(lobbyId, message) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const messageString = JSON.stringify(message);
    for (const clientId in lobby.players) {
        clients[clientId]?.ws.send(messageString);
    }
}
function broadcastLobbyUpdate(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    broadcastToLobby(lobbyId, {
        type: 'server_lobby_update',
        lobbyState: lobby
    });
}

class GameRoom {
    constructor(roomId, mode, playerClients, lobbyPlayers) {
        this.roomId = roomId;
        this.mode = mode;
        this.gameLoopInterval = null;
        this.playerMovements = {};
        this.players = {};
        this.playerIdToInfo = {};

        this.gameState = {
            players: {},
            flags: {
                blue: { x: 1, y: 9, carriedBy: null },
                red: { x: 18, y: 9, carriedBy: null }
            },
            scores: { blue: 0, red: 0 },
            playerStats: {} // <-- NEW: To store stats
        };
        
        console.log(`[Room ${roomId}]: Creating ${mode} game...`);

        const teamCounts = { blue: 0, red: 0 };
        playerClients.forEach((client) => {
            const lobbyInfo = lobbyPlayers[client.clientId];
            if (!lobbyInfo) {
                console.error(`CRITICAL: Client ${client.clientId} missing from lobbyPlayers map.`);
                return;
            }
            const team = lobbyInfo.team;
            teamCounts[team]++;
            const playerId = `${team}${teamCounts[team]}`;
            const playerInfo = { 
                id: playerId,
                team: team,
                name: lobbyInfo.name
            };
            this.playerIdToInfo[playerId] = playerInfo;
            this.setupPlayer(client, playerInfo);
        });
    }

    // ... (setupPlayer, handleAnswer, handleIceCandidate are unchanged) ...
    async setupPlayer(client, playerInfo) {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        const dc = pc.createDataChannel('gameData', {
            ordered: false,
            maxRetransmits: 0
        });

        this.players[client.clientId] = { pc, dc, info: playerInfo };
        this.playerMovements[playerInfo.id] = { up: false, down: false, left: false, right: false };

        dc.onopen = () => {
            console.log(`[Room ${this.roomId}]: Data channel OPEN for ${playerInfo.id} (${playerInfo.name})`);
            this.addPlayerToState(playerInfo);
            
            if (Object.keys(this.players).length === Object.keys(this.gameState.players).length) {
                console.log(`[Room ${this.roomId}]: All players connected. Starting game loop.`);
                this.startGameLoop();
            }
        };
        
        dc.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'client_input' && message.inputState) {
                if (this.playerMovements[playerInfo.id]) {
                    this.playerMovements[playerInfo.id] = message.inputState;
                }
            }
        };

        dc.onclose = () => {
            console.log(`[Room ${this.roomId}]: Data channel CLOSED for ${playerInfo.id}`);
            this.removePlayer(client.clientId, playerInfo.id);
        };
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                client.ws.send(JSON.stringify({
                    type: 'server_ice_candidate',
                    candidate: event.candidate 
                }));
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        client.ws.send(JSON.stringify({
            type: 'server_offer',
            offer: offer, 
            playerInfo: playerInfo,
            allPlayers: Object.values(this.playerIdToInfo)
        }));
    }

    async handleAnswer(clientId, answer) {
        const pc = this.players[clientId]?.pc;
        if (pc) {
            await pc.setRemoteDescription(answer); 
            console.log(`[Room ${this.roomId}]: Set remote (answer) for ${this.players[clientId].info.id}`);
        }
    }

    async handleIceCandidate(clientId, candidate) {
        const pc = this.players[clientId]?.pc;
        if (pc && candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }


    // --- Game Logic ---
    addPlayerToState(playerInfo) {
        const isBlue = playerInfo.team === 'blue';
        const teamPlayers = Object.values(this.gameState.players).filter(p => p.team === playerInfo.team).length;
        const yPos = 9 + (teamPlayers % 2 === 0 ? -teamPlayers : teamPlayers);
        
        this.gameState.players[playerInfo.id] = {
            x: isBlue ? 1 : 18,
            y: yPos,
            initialY: yPos,
            team: playerInfo.team,
            name: playerInfo.name,
            hasFlag: null
        };

        // --- NEW: Initialize stats ---
        this.gameState.playerStats[playerInfo.id] = {
            name: playerInfo.name,
            team: playerInfo.team,
            captures: 0,
            tags: 0
        };
        // --- END OF NEW ---
    }

    startGameLoop() {
        if (this.gameLoopInterval) {
            console.warn(`[Room ${this.roomId}]: startGameLoop called, but loop is already running.`);
            return;
        }
        console.log(`[Room ${this.roomId}]: Game loop started.`);
        this.gameLoopInterval = setInterval(() => {
            this.runGameTick();
        }, TICK_RATE);
    }
    
    runGameTick() {
        // 1. Update positions (Unchanged)
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

        // 2. Check logic (Unchanged, but `checkGameLogic` is modified below)
        let globalWinner = null;
        for (const playerId in this.gameState.players) {
            if (globalWinner) break;
            const { newState, gameOverWinner } = this.checkGameLogic(playerId, this.gameState);
            this.gameState = newState;
            if (gameOverWinner) globalWinner = gameOverWinner;
        }

        // 3. Broadcast state (Unchanged)
        const stateMessage = JSON.stringify({ type: 'gameState', state: this.gameState });
        for (const clientId in this.players) {
            const { dc } = this.players[clientId];
            if (dc.readyState === 'open') {
                dc.send(stateMessage);
            }
        }

        // 4. Handle FINAL game over (MODIFIED)
        if (globalWinner) {
            console.log(`[Room ${this.roomId}]: FINAL Game Over! Winner: ${globalWinner}`);
            
            clearInterval(this.gameLoopInterval);

            // --- NEW: Calculate MVP ---
            let mvpPlayerId = null;
            let maxMvpScore = -1;

            for (const [playerId, stats] of Object.entries(this.gameState.playerStats)) {
                // Score: 100 points per capture, 25 per tag
                const mvpScore = (stats.captures * 100) + (stats.tags * 25);
                if (mvpScore > maxMvpScore) {
                    maxMvpScore = mvpScore;
                    mvpPlayerId = playerId;
                }
            }
            // --- END OF NEW ---

            // --- MODIFIED: Add stats and mvp to payload ---
          const finalResultsMessage = JSON.stringify({ 
                type: 'game_over_final', 
                winner: globalWinner,
                scores: this.gameState.scores,
                playerStats: this.gameState.playerStats, // <-- ADDED
                mvp: mvpPlayerId                      // <-- ADDED
            });
            // --- END OF MODIFICATION ---

            for (const clientId in this.players) {
                const { dc } = this.players[clientId];
                 if (dc.readyState === 'open') {
                    dc.send(finalResultsMessage);
                }
            }
        }
    }

    checkGameLogic(playerId, currentState) {
// Note: We are modifying newState, which is a deep copy. This is correct.
        let newState = JSON.parse(JSON.stringify(currentState));
        let gameOverWinner = null;
        const player = newState.players[playerId];
        if (!player) return { newState, gameOverWinner };
        const playerTeam = player.team;
        const opponentTeam = playerTeam === 'blue' ? 'red' : 'blue';
        const opponentFlag = newState.flags[opponentTeam];
        const homeBaseCenter = playerTeam === 'blue' ? { x: 1, y: 9 } : { x: 18, y: 9 };
        
        // Flag pickup (unchanged)
        if (player.x === opponentFlag.x && player.y === opponentFlag.y && !player.hasFlag) {
            player.hasFlag = opponentTeam;
            opponentFlag.carriedBy = playerId;
        }

        const inHomeBase = (playerTeam === 'blue' && player.x <= 2) || (playerTeam === 'red' && player.x >= 17);
        if (player.hasFlag && inHomeBase) {
            newState.scores[playerTeam]++;
            
            // --- NEW: Increment Captures ---
            if (newState.playerStats[playerId]) {
                newState.playerStats[playerId].captures++;
            }
            // --- END OF NEW ---
            
            if (newState.scores[playerTeam] >= WIN_SCORE) {
                gameOverWinner = playerTeam; 
            } else {
                newState = this.resetRound(newState); 
            }
        }

        // Flag return (MODIFIED)
        for (const oppId in newState.players) {
            const opponent = newState.players[oppId];
            // If an opponent (oppId) has our flag (playerTeam)
            if (opponent.team === opponentTeam && opponent.hasFlag === playerTeam) {
                // And we (playerId) are on them
                if (player.x === opponent.x && player.y === opponent.y) {
                    const returnedFlag = newState.flags[playerTeam];
                   returnedFlag.x = homeBaseCenter.x; 
                    returnedFlag.y = homeBaseCenter.y;
                    returnedFlag.carriedBy = null;
                    opponent.hasFlag = null;

                    // --- NEW: Increment Tags ---
                    // 'player' is the one who made the tag
                    if (newState.playerStats[playerId]) {
                        newState.playerStats[playerId].tags++;
                    }
                    // --- END OF NEW ---
                }
            }
        }
        return { newState, gameOverWinner };
    }

    resetRound(state = this.gameState) {
        for (const playerId in state.players) {
            const player = state.players[playerId];
            const isBlue = player.team === 'blue';
            player.x = isBlue ? 1 : 18;
            player.y = player.initialY; // Use the stored initial Y
            player.hasFlag = null;
        }
        state.flags.blue = { x: 1, y: 9, carriedBy: null };
        state.flags.red = { x: 18, y: 9, carriedBy: null };
        return state;
    }

    removePlayer(clientId, playerId) {
        console.log(`[Room ${this.roomId}]: Removing player ${playerId}`);
        delete this.players[clientId];
        delete this.gameState.players[playerId];
        delete this.playerMovements[playerId];
        delete this.playerIdToInfo[playerId];
        // Note: We DON'T delete from playerStats, so they stay on the scoreboard
        
        if (Object.keys(this.players).length === 0) {
            console.log(`[Room ${this.roomId}]: Room is empty, cleaning up.`);
            clearInterval(this.gameLoopInterval);
            delete gameRooms[this.roomId];
        }
    }
}

// ... (WebSocket, ws.on('connection'), and all lobby logic is unchanged) ...
// (The rest of the file is identical to the previous step)
wsServer.on('connection', (ws) => {
    const clientId = uuidv4();
    clients[clientId] = { 
        ws, 
        clientId, 
        name: null, 
        lobbyId: null, 
        roomId: null 
    };
    console.log(`Client ${clientId} connected.`);
    ws.send(JSON.stringify({ type: 'server_client_id', clientId }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const client = clients[clientId];
        if (!client) return;
        const lobby = client.lobbyId ? lobbies[client.lobbyId] : null;
        const room = client.roomId ? gameRooms[client.roomId] : null;

        switch (data.type) {
            case 'client_set_name':
                const name = data.name.substring(0, 15);
                client.name = name;
                console.log(`Client ${clientId} set name to: ${name}`);
                ws.send(JSON.stringify({ type: 'server_name_set', name: name }));
                break;
            
            case 'client_create_lobby':
                if (lobby || room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' }));
                    return;
                }
                if (!client.name) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' }));
                    return;
                }
                const lobbyId = generateLobbyCode();
                const mode = data.mode;
                const newLobby = {
                    lobbyId,
                    hostId: clientId,
                    mode: mode,
                    isPrivate: data.isPrivate,
                    maxPlayers: modeRequirements[mode],
                    players: {
                        [clientId]: {
                            name: client.name,
                            team: 'blue'
                        }
                    }
                };
                lobbies[lobbyId] = newLobby;
                client.lobbyId = lobbyId;
                console.log(`Client ${client.name} created lobby ${lobbyId}`);
                ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newLobby }));
                break;

            case 'client_join_lobby':
                if (lobby || room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' }));
                    return;
                }
                if (!client.name) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' }));
                    return;
                }
                const targetLobby = lobbies[data.lobbyId.toUpperCase()];
                if (!targetLobby) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found.' }));
                    return;
                }
                if (Object.keys(targetLobby.players).length >= targetLobby.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby is full.' }));
                    return;
                }
                const team = getNextAvailableTeam(targetLobby);
                targetLobby.players[clientId] = { name: client.name, team: team };
                client.lobbyId = targetLobby.lobbyId;
                console.log(`Client ${client.name} joined lobby ${targetLobby.lobbyId}`);
                ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: targetLobby }));
                broadcastLobbyUpdate(targetLobby.lobbyId);
                break;
                
            case 'client_find_game':
                if (lobby || room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' }));
                    return;
                }
                if (!client.name) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' }));
                    return;
                }
                const publicLobby = Object.values(lobbies).find(l => 
                    !l.isPrivate &&
                    l.mode === data.mode &&
                    Object.keys(l.players).length < l.maxPlayers
                );
                if (publicLobby) {
                    const team = getNextAvailableTeam(publicLobby);
                    publicLobby.players[clientId] = { name: client.name, team: team };
                    client.lobbyId = publicLobby.lobbyId;
                    console.log(`Client ${client.name} matched into lobby ${publicLobby.lobbyId}`);
                    ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: publicLobby }));
                    broadcastLobbyUpdate(publicLobby.lobbyId);
                } else {
                    const newLobbyId = generateLobbyCode();
                    const newPublicLobby = {
                        lobbyId: newLobbyId,
                        hostId: clientId,
                        mode: data.mode,
                        isPrivate: false,
                        maxPlayers: modeRequirements[data.mode],
                        players: {
                            [clientId]: {
                                name: client.name,
                                team: 'blue'
                            }
                        }
                    };
                    lobbies[newLobbyId] = newPublicLobby;
                    client.lobbyId = newLobbyId;
                    console.log(`Client ${client.name} created new public lobby ${newLobbyId}`);
                    ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newPublicLobby }));
                }
                break;
            
            case 'client_change_team':
                if (!lobby) return;
                const newTeam = data.team;
                const maxTeamSize = lobby.maxPlayers / 2;
                if (countTeam(lobby, newTeam) < maxTeamSize) {
                    lobby.players[clientId].team = newTeam;
                    console.log(`Client ${client.name} in lobby ${lobby.lobbyId} switched to ${newTeam}`);
                    broadcastLobbyUpdate(lobby.lobbyId);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: `Team ${newTeam} is full.` }));
                }
                break;

            case 'client_start_game':
                if (!lobby) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not in a lobby.' }));
                    return;
                }
                if (lobby.hostId !== clientId) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
                    return;
                }
                if (Object.keys(lobby.players).length !== lobby.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Waiting for more players.' }));
                    return;
                }
                if (countTeam(lobby, 'blue') !== countTeam(lobby, 'red')) {
                     ws.send(JSON.stringify({ type: 'error', message: 'Teams must be balanced.' }));
                    return;
                }
                console.log(`Lobby ${lobby.lobbyId} is starting game...`);
                const roomId = lobby.lobbyId;
                const playerClientIds = Object.keys(lobby.players);
                const playersForGame = playerClientIds.map(cid => clients[cid]);
                const lobbyPlayers = lobby.players;
                broadcastToLobby(roomId, { 
                    type: 'server_game_starting',
                    lobby: lobby
                });
                gameRooms[roomId] = new GameRoom(roomId, lobby.mode, playersForGame, lobbyPlayers);
                for (const c of playersForGame) {
                    c.lobbyId = null;
                    c.roomId = roomId;
                }
                delete lobbies[roomId];
                break;

            case 'client_answer':
                if (room) {
                    room.handleAnswer(clientId, data.answer);
                }
                break;
            
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
        if (!client) return; 
        if (client.lobbyId && lobbies[client.lobbyId]) {
            const lobby = lobbies[client.lobbyId];
            console.log(`Removing ${client.name} from lobby ${client.lobbyId}`);
            delete lobby.players[clientId];
            if (Object.keys(lobby.players).length === 0) {
                console.log(`Lobby ${client.lobbyId} is empty, deleting.`);
                delete lobbies[client.lobbyId];
            } else {
                if (lobby.hostId === clientId) {
                    lobby.hostId = Object.keys(lobby.players)[0];
                    console.log(`Lobby ${client.lobbyId} new host is ${clients[lobby.hostId].name}`);
                }
                broadcastLobbyUpdate(client.lobbyId);
            }
        }
        if (client.roomId && gameRooms[client.roomId]) {
            const room = gameRooms[client.roomId];
            const playerInfo = room.players[clientId]?.info;
            if (playerInfo) {
                room.removePlayer(clientId, playerInfo.id);
            }
        }
        delete clients[clientId];
    });
});