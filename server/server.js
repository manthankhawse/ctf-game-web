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

// --- Map Layout ---
const simpleMapLayout = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

// --- Helper Functions ---
function generateLobbyCode() {
    let code = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    while (true) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!lobbies[code]) {
            break;
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

// --- GameRoom Class ---
class GameRoom {
    constructor(roomId, mode, playerClients, lobbyPlayers) {
        this.roomId = roomId;
        this.mode = mode;
        this.gameLoopInterval = null;
        this.playerMovements = {};
        this.players = {}; // { 'clientId': { pc, dc, info, audioTrack? } }
        this.playerIdToInfo = {};
        this.mapLayout = simpleMapLayout;

        this.gameState = {
            players: {},
            flags: {
                blue: { x: 1, y: 9, carriedBy: null },
                red: { x: 18, y: 9, carriedBy: null }
            },
            scores: { blue: 0, red: 0 },
            playerStats: {}
        };
        
        console.log(`[Room ${roomId}]: Creating ${mode} game...`);

        const teamCounts = { blue: 0, red: 0 };
        playerClients.forEach((client) => {
            const lobbyInfo = lobbyPlayers[client.clientId];
            if (!lobbyInfo) return;
            const team = lobbyInfo.team;
            teamCounts[team]++;
            const playerId = `${team}${teamCounts[team]}`;
            const playerInfo = { 
                id: playerId,
                team: team,
                name: lobbyInfo.name
            };
            this.playerIdToInfo[playerId] = playerInfo;
            // Pass 'this.players' so setupPlayer can access other players
            this.setupPlayer(client, playerInfo, this.players); 
        });
    }

    async setupPlayer(client, playerInfo, allPlayers) { // <-- Pass in allPlayers
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        const dc = pc.createDataChannel('gameData', {
            ordered: false,
            maxRetransmits: 0
        });

        // Store the player
        this.players[client.clientId] = { pc, dc, info: playerInfo };
        this.playerMovements[playerInfo.id] = { up: false, down: false, left: false, right: false };

        // --- NEW: Voice Chat Relay Logic ---
        pc.ontrack = (event) => {
            const track = event.track;
            const stream = event.streams[0];
            if (track.kind !== 'audio') return;

            console.log(`[Room ${this.roomId}]: Received audio track from ${playerInfo.id}`);
            
            // Store this player's audio track
            this.players[client.clientId].audioTrack = track;

            // --- Relay this track to all CURRENT teammates ---
            for (const otherClientId in allPlayers) {
                if (otherClientId === client.clientId) continue; // Don't send back to self

                const teammate = allPlayers[otherClientId];
                if (teammate.info.team === playerInfo.team) {
                    console.log(`[Room ${this.roomId}]: Relaying ${playerInfo.id}'s audio to ${teammate.info.id}`);
                    // Add this track to the PC of the teammate
                    teammate.pc.addTrack(track, stream);
                }
            }
        };

        // --- Also, add all EXISTING teammates' tracks to this new player ---
        for (const otherClientId in allPlayers) {
            if (otherClientId === client.clientId) continue;

            const teammate = allPlayers[otherClientId];
            // If teammate is on the same team AND they already sent us their track
            if (teammate.info.team === playerInfo.team && teammate.audioTrack) {
                console.log(`[Room ${this.roomId}]: Sending existing ${teammate.info.id}'s audio to new player ${playerInfo.id}`);
                pc.addTrack(teammate.audioTrack, teammate.audioTrack.stream); // stream might be tricky, but track is key
            }
        }
        // --- END OF NEW VOICE LOGIC ---

        dc.onopen = () => {
            console.log(`[Room ${this.roomId}]: Data channel OPEN for ${playerInfo.id}`);
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
            allPlayers: Object.values(this.playerIdToInfo),
            mapLayout: this.mapLayout
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
        this.gameState.playerStats[playerInfo.id] = {
            name: playerInfo.name,
            team: playerInfo.team,
            captures: 0,
            tags: 0
        };
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
            const isWall = this.mapLayout[targetY][targetX] === 1;
            let playerCollision = false;
            for (const otherPlayerId in this.gameState.players) {
                if (playerId === otherPlayerId) continue;
                const otherPlayer = this.gameState.players[otherPlayerId];
                if (targetX === otherPlayer.x && targetY === otherPlayer.y) {
                    playerCollision = true;
                    break;
                }
            }
            if (!playerCollision && !isWall) {
                player.x = targetX;
                player.y = targetY;
            }
        }
        let globalWinner = null;
        for (const playerId in this.gameState.players) {
            if (globalWinner) break;
            const { newState, gameOverWinner } = this.checkGameLogic(playerId, this.gameState);
            this.gameState = newState;
            if (gameOverWinner) globalWinner = gameOverWinner;
        }
        const stateMessage = JSON.stringify({ type: 'gameState', state: this.gameState });
        for (const clientId in this.players) {
            const { dc } = this.players[clientId];
            if (dc.readyState === 'open') {
                dc.send(stateMessage);
            }
        }
        if (globalWinner) {
            console.log(`[Room ${this.roomId}]: FINAL Game Over! Winner: ${globalWinner}`);
            clearInterval(this.gameLoopInterval);
            let mvpPlayerId = null;
            let maxMvpScore = -1;
            for (const [playerId, stats] of Object.entries(this.gameState.playerStats)) {
                const mvpScore = (stats.captures * 100) + (stats.tags * 25);
                if (mvpScore > maxMvpScore) {
                    maxMvpScore = mvpScore;
                    mvpPlayerId = playerId;
                }
            }
          const finalResultsMessage = JSON.stringify({ 
                type: 'game_over_final', 
                winner: globalWinner,
                scores: this.gameState.scores,
                playerStats: this.gameState.playerStats,
                mvp: mvpPlayerId
            });
            for (const clientId in this.players) {
                const { dc } = this.players[clientId];
                 if (dc.readyState === 'open') {
                    dc.send(finalResultsMessage);
                }
            }
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
        const inHomeBase = (player.x === homeBaseCenter.x && player.y === homeBaseCenter.y);
        if (player.hasFlag && inHomeBase) {
            newState.scores[playerTeam]++;
            if (newState.playerStats[playerId]) {
                newState.playerStats[playerId].captures++;
            }
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
                    if (newState.playerStats[playerId]) {
                        newState.playerStats[playerId].tags++;
                    }
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
            player.y = player.initialY;
            player.hasFlag = null;
     }
        state.flags.blue = { x: 1, y: 9, carriedBy: null };
        state.flags.red = { x: 18, y: 9, carriedBy: null };
        return state;
    }

    removePlayer(clientId, playerId) {
        console.log(`[Room ${this.roomId}]: Removing player ${playerId}`);
        
        const player = this.players[clientId];
        if (player && player.audioTrack) {
            // Stop relaying this player's track to others
            for (const otherClientId in this.players) {
                if (otherClientId === clientId) continue;
                const teammate = this.players[otherClientId];
                if (teammate.info.team === player.info.team) {
                    try {
                        const senders = teammate.pc.getSenders().filter(s => s.track === player.audioTrack);
                        senders.forEach(s => teammate.pc.removeTrack(s));
                    } catch (e) {
                        console.error('Error removing track from teammate:', e);
                    }
                }
            }
        }

        delete this.players[clientId];
        delete this.gameState.players[playerId];
        delete this.playerMovements[playerId];
        delete this.playerIdToInfo[playerId];
        
        if (Object.keys(this.players).length === 0) {
            console.log(`[Room ${this.roomId}]: Room is empty, cleaning up.`);
            clearInterval(this.gameLoopInterval);
            delete gameRooms[this.roomId];
        }
    }
}

// --- WebSocket Signaling & Lobby Logic ---
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