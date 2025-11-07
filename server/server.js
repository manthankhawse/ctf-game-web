// server.js
// Main Thread: Handles Lobbies, WebSockets, and WebRTC
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('werift');
const { Worker } = require('worker_threads');
const path = require('path');

// --- Game Constants ---
const modeRequirements = {
    '1v1': 2,
    '2v2': 4,
    '3v3': 6
};

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

// --- Server State ---
const wsServer = new WebSocket.Server({ port: 3000 });
console.log('WebSocket Server running on port 3000');
console.log(`Server PID is: ${process.pid}`);

let clients = {};
let lobbies = {};
let gameHosts = {};

// --- Helper Functions ---
function generateLobbyCode() {
    let code = '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    while (true) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!lobbies[code]) break;
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

// --- GameHost Class (Unchanged) ---
class GameHost {
    constructor(roomId, mode, playerClients, lobbyPlayers) {
        this.roomId = roomId;
        this.mode = mode;
        this.players = {};
        this.playerIdToInfo = {};
        this.worker = null;
        this.openDataChannels = 0;
        this.totalPlayers = playerClients.length;
        this.gameStarted = false;

        console.log(`[Host ${roomId}]: Creating ${mode} game...`);
        
        const teamCounts = { blue: 0, red: 0 };
        for (const client of playerClients) {
            const lobbyInfo = lobbyPlayers[client.clientId];
            const team = lobbyInfo.team;
            teamCounts[team]++;
            const playerId = `${team}${teamCounts[team]}`;
            this.playerIdToInfo[playerId] = { 
                id: playerId,
                team: team,
                name: lobbyInfo.name
            };
            this.players[client.clientId] = { info: { ...this.playerIdToInfo[playerId], clientId: client.clientId } };
        }

        this.worker = new Worker(path.resolve('./game.worker.js'));
        
        this.worker.postMessage({
            type: 'init',
            roomId: this.roomId,
            playerInfoMap: this.playerIdToInfo
        });

        this.worker.on('message', this.handleWorkerMessage.bind(this));
        this.worker.on('error', (err) => console.error(`[Worker ${this.roomId}] Error:`, err));
        this.worker.on('exit', (code) => {
            if (code !== 0) console.error(`[Worker ${this.roomId}] Stopped with exit code ${code}`);
            else console.log(`[Worker ${this.roomId}] Exited cleanly.`);
        });

        for (const client of playerClients) {
            this.setupPlayerWebRTC(client);
        }
    }
    handleWorkerMessage(message) {
        switch (message.type) {
            case 'game_state':
                const stateMessage = JSON.stringify({ type: 'gameState', state: message.payload });
                this.broadcastToDataChannels(stateMessage);
                break;
            case 'game_over':
                const finalResultsMessage = JSON.stringify({ 
                    type: 'game_over_final', 
                    ...message.payload 
                });
                this.broadcastToDataChannels(finalResultsMessage);
                break;
            case 'worker_shutdown':
                console.log(`[Host ${this.roomId}]: Worker signaled shutdown. Cleaning up.`);
                this.cleanup();
                break;
        }
    }
    broadcastToDataChannels(messageString) {
        for (const clientId in this.players) {
            const player = this.players[clientId];
            if (player.dc && player.dc.readyState === 'open') {
                player.dc.send(messageString);
            }
        }
    }
    async setupPlayerWebRTC(client) {
        const clientId = client.clientId;
        const playerInfo = this.players[clientId].info;
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        const dc = pc.createDataChannel('gameData', {
            ordered: false,
            maxRetransmits: 0
        });
        this.players[clientId].pc = pc;
        this.players[clientId].dc = dc;
        pc.ontrack = (event) => {
            const track = event.track;
            if (track.kind !== 'audio') return;
            this.players[clientId].audioTrack = track;
            for (const otherClientId in this.players) {
                if (otherClientId === clientId) continue;
                const teammate = this.players[otherClientId];
                if (teammate.info.team === playerInfo.team) {
                    teammate.pc.addTrack(track, event.streams[0]);
                }
            }
        };
        for (const otherClientId in this.players) {
            if (otherClientId === clientId) continue;
            const teammate = this.players[otherClientId];
            if (teammate.info.team === playerInfo.team && teammate.audioTrack) {
                pc.addTrack(teammate.audioTrack);
            }
        }
        dc.onopen = () => {
            console.log(`[Host ${this.roomId}]: Data channel OPEN for ${playerInfo.id}`);
            this.openDataChannels++;
            if (!this.gameStarted && this.openDataChannels === this.totalPlayers) {
                this.gameStarted = true;
                console.log(`[Host ${this.roomId}]: All ${this.totalPlayers} data channels are open. Starting game.`);
                this.worker.postMessage({ type: 'start_game' });
            }
        };
        dc.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'client_input') {
                this.worker.postMessage({
                    type: 'client_input',
                    playerId: playerInfo.id,
                    inputState: message.inputState
                });
            }
        };
        dc.onclose = () => {
            console.log(`[Host ${this.roomId}]: Data channel CLOSED for ${playerInfo.id}`);
            this.removePlayer(clientId, playerInfo.id);
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
            mapLayout: simpleMapLayout
        }));
    }
    async handleAnswer(clientId, answer) {
        const pc = this.players[clientId]?.pc;
        if (pc) {
            await pc.setRemoteDescription(answer); 
        }
    }
    async handleIceCandidate(clientId, candidate) {
        const pc = this.players[clientId]?.pc;
        if (pc && candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }
    removePlayer(clientId, playerId) {
        console.log(`[Host ${this.roomId}]: Removing player ${playerId}`);
        const player = this.players[clientId];
        let wasOpen = false;
        if (player && player.dc) {
            wasOpen = player.dc.readyState === 'open';
        }
        this.worker.postMessage({
            type: 'remove_player',
            roomId: this.roomId,
            playerId: playerId
        });
        if (player) {
            player.pc?.close();
            if (player.audioTrack) {
                for (const otherClientId in this.players) {
                    if (otherClientId === clientId) continue;
                    const teammate = this.players[otherClientId];
                    if (teammate.info.team === player.info.team) {
                        try {
                            const senders = teammate.pc.getSenders().filter(s => s.track === player.audioTrack);
                            senders.forEach(s => teammate.pc.removeTrack(s));
                        } catch (e) {}
                    }
                }
            }
        }
        delete this.players[clientId];
        if (!this.gameStarted) {
            this.totalPlayers--;
            if (wasOpen) {
                this.openDataChannels--;
            }
            if (this.totalPlayers > 0 && this.openDataChannels === this.totalPlayers) {
                this.gameStarted = true;
                 console.log(`[Host ${this.roomId}]: Player left, but remaining ${this.totalPlayers} are ready. Starting game.`);
                 this.worker.postMessage({ type: 'start_game' });
            }
        }
        if (this.totalPlayers === 0) {
            console.log(`[Host ${this.roomId}]: Room is empty, terminating worker.`);
            this.worker.terminate();
            delete gameHosts[this.roomId];
        }
    }
    cleanup() {
        for (const clientId in this.players) {
            this.players[clientId].pc?.close();
            clients[clientId].roomId = null;
        }
        delete gameHosts[this.roomId];
    }
}

// --- WebSocket Signaling & Lobby Logic ---
wsServer.on('connection', (ws) => {
    const clientId = uuidv4();
    clients[clientId] = { ws, clientId, name: null, lobbyId: null, roomId: null };
    console.log(`Client ${clientId} connected.`);
    ws.send(JSON.stringify({ type: 'server_client_id', clientId }));

    // --- NEW: Extracted startGame function ---
    // This function can be called by anyone with access to the lobby
    function startGame(lobby) {
        const roomId = lobby.lobbyId;
        console.log(`Lobby ${roomId} is starting game...`);
        
        const playerClientIds = Object.keys(lobby.players);
        // Filter out any clients that might have disconnected in a weird state
        const playersForGame = playerClientIds.map(cid => clients[cid]).filter(c => c); 
        const lobbyPlayers = lobby.players;

        // 1. Tell all players game is starting
        broadcastToLobby(roomId, { type: 'server_game_starting', lobby: lobby });
        
        // 2. Create new GameHost (spawns worker)
        gameHosts[roomId] = new GameHost(roomId, lobby.mode, playersForGame, lobbyPlayers);
        
        // 3. Update client states
        for (const c of playersForGame) {
            c.lobbyId = null;
            c.roomId = roomId;
        }
        
        // 4. Delete the lobby
        delete lobbies[roomId];
    }
    // --- END OF NEW FUNCTION ---

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const client = clients[clientId];
        if (!client) return;

        const lobby = client.lobbyId ? lobbies[client.lobbyId] : null;
        const host = client.roomId ? gameHosts[client.roomId] : null;

        switch (data.type) {
            // --- Lobby cases (Unchanged) ---
            case 'client_set_name':
                const name = data.name.substring(0, 15);
                client.name = name;
                console.log(`Client ${clientId} set name to: ${name}`);
                ws.send(JSON.stringify({ type: 'server_name_set', name: name }));
                break;
            case 'client_create_lobby':
                if (lobby || host) {
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
                    players: { [clientId]: { name: client.name, team: 'blue' } }
                };
                lobbies[lobbyId] = newLobby;
                client.lobbyId = lobbyId;
                console.log(`Client ${client.name} created lobby ${lobbyId}`);
                ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newLobby }));
                break;
            case 'client_join_lobby':
                 if (lobby || host) {
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
            
            // --- MODIFIED: client_find_game ---
            case 'client_find_game':
                if (lobby || host) {
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

                    // --- FIX: Auto-start public game if full ---
                    if (!publicLobby.isPrivate && Object.keys(publicLobby.players).length === publicLobby.maxPlayers) {
                        console.log(`Public lobby ${publicLobby.lobbyId} is full. Auto-starting game...`);
                        startGame(publicLobby);
                    }
                    // --- END OF FIX ---
                } else {
                    const newLobbyId = generateLobbyCode();
                    const newPublicLobby = {
                        lobbyId: newLobbyId,
                        hostId: clientId,
                        mode: data.mode,
                        isPrivate: false,
                        maxPlayers: modeRequirements[data.mode],
                        players: { [clientId]: { name: client.name, team: 'blue' } }
                    };
                    lobbies[newLobbyId] = newPublicLobby;
                    client.lobbyId = newLobbyId;
                    console.log(`Client ${client.name} created new public lobby ${newLobbyId}`);
                    ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newPublicLobby }));
                }
                break;
            // --- END OF MODIFICATION ---
            
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

            // --- MODIFIED: client_start_game ---
            case 'client_start_game':
                if (!lobby) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not in a lobby.' }));
                    return;
                }
                if (lobby.hostId !== clientId) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
                    return;

                }
                // We only check for player count in private lobbies
                // because public lobbies auto-start
                if (lobby.isPrivate && Object.keys(lobby.players).length !== lobby.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Waiting for more players.' }));
                    return;
                }
                if (countTeam(lobby, 'blue') !== countTeam(lobby, 'red')) {
                     ws.send(JSON.stringify({ type: 'error', message: 'Teams must be balanced.' }));
                    return;
                }
                
                // Call the new function
                startGame(lobby);
                break;
            // --- END OF MODIFICATION ---

            case 'client_answer':
                if (host) {
                    host.handleAnswer(clientId, data.answer);
                }
                break;
            case 'client_ice_candidate':
                if (host && data.candidate) {
                    host.handleIceCandidate(clientId, data.candidate);
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
        if (client.roomId && gameHosts[client.roomId]) {
            const host = gameHosts[client.roomId];
            const playerId = host.players[clientId]?.info?.id;
            if (playerId) {
                host.removePlayer(clientId, playerId);
            }
        }
        delete clients[clientId];
    });
});