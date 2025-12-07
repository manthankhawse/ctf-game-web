// server.js
// Main Thread: Redis Pub/Sub + Heartbeats for Load Balancing
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('werift');
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const Redis = require('ioredis');

// --- Server Configuration ---
const PORT = process.env.PORT || 3000;
// --- NEW: Dynamic IP Detection ---
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal (localhost) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost'; // Fallback
}

// const LOCAL_IP = '10.205.223.130';
const SERVER_ID = `ws://localhost:${PORT}`;

const LOBBY_CHANNEL = 'lobby-channel';
const HEARTBEAT_CHANNEL = 'server-heartbeats';
const HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds
const SERVER_TTL_MS = 15000; // 15 seconds

// --- Redis Connection ---
const publisher = new Redis();
const subscriber = new Redis();

// --- Game Constants ---
const modeRequirements = { '1v1': 2, '2v2': 4, '3v3': 6 };
const simpleMapLayout = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

// --- Server State ---
const wsServer = new WebSocket.Server({ port: PORT });
console.log(`WebSocket Server ${SERVER_ID} running on port ${PORT}`);
console.log(`Server PID is: ${process.pid}`);

let clients = {};
let lobbies = {}; // Global cache of all lobbies
let gameHosts = {}; // Local games THIS server is running
let serverLoads = {}; // Cache of all server loads

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
    if (!lobby || lobby.serverId !== SERVER_ID) return;
    
    const messageString = JSON.stringify(message);
    for (const clientId in lobby.players) {
        if (clients[clientId]) {
            clients[clientId].ws.send(messageString);
        }
    }
}
function broadcastLobbyUpdate(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    broadcastToLobby(lobbyId, {
        type: 'server_lobby_update',
        lobbyState: lobby
    });
    publisher.publish(LOBBY_CHANNEL, JSON.stringify({
        type: 'LOBBY_UPDATED',
        serverId: SERVER_ID,
        lobby: lobby
    }));
}
function findLeastLoadedServer() {
    let leastLoad = Infinity;
    let bestServer = SERVER_ID;

    if (!serverLoads[SERVER_ID]) {
        serverLoads[SERVER_ID] = { load: Object.keys(gameHosts).length, lastSeen: Date.now() };
    }

    for (const [serverId, data] of Object.entries(serverLoads)) {
        if (data.load < leastLoad) {
            leastLoad = data.load;
            bestServer = serverId;
        }
    }
    console.log(`[LoadBalancer] Found least loaded server: ${bestServer} with ${leastLoad} games.`);
    return bestServer;
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

// --- Server Heartbeat ---
setInterval(() => {
    const payload = JSON.stringify({
        serverId: SERVER_ID,
        load: Object.keys(gameHosts).length,
        lastSeen: Date.now()
    });
    publisher.publish(HEARTBEAT_CHANNEL, payload);

    const now = Date.now();
    for (const [serverId, data] of Object.entries(serverLoads)) {
        if (now - data.lastSeen > SERVER_TTL_MS) {
            console.log(`[LoadBalancer] Server ${serverId} timed out. Removing from list.`);
            delete serverLoads[serverId];
        }
    }
}, HEARTBEAT_INTERVAL_MS);

// --- Redis Subscriber Logic ---
subscriber.subscribe(LOBBY_CHANNEL, HEARTBEAT_CHANNEL, (err, count) => {
    if (err) {
        console.error("Failed to subscribe to Redis:", err);
        return;
    }
    console.log(`Subscribed to ${count} Redis channels. Listening...`);
});

subscriber.on('message', (channel, message) => {
    try {
        const data = JSON.parse(message);
        
        if (channel === HEARTBEAT_CHANNEL) {
            serverLoads[data.serverId] = {
                load: data.load,
                lastSeen: data.lastSeen
            };
            return;
        }

        if (channel === LOBBY_CHANNEL) {
            switch (data.type) {
                case 'LOBBY_CREATED':
                    console.log(`[Redis] Received LOBBY_CREATED from ${data.serverId}: ${data.lobby.lobbyId}`);
                    if (!lobbies[data.lobby.lobbyId]) {
                        lobbies[data.lobby.lobbyId] = data.lobby;
                    }
                    break;
                case 'LOBBY_UPDATED':
                    console.log(`[Redis] Received LOBBY_UPDATED from ${data.serverId}: ${data.lobby.lobbyId}`);
                    lobbies[data.lobby.lobbyId] = data.lobby;
                    break;
                case 'LOBBY_REMOVED':
                    console.log(`[Redis] Received LOBBY_REMOVED from ${data.serverId}: ${data.lobbyId}`);
                    delete lobbies[data.lobbyId];
                    break;
            }
        }
    } catch (e) {
        console.error("Failed to parse Redis message:", e);
    }
});

// --- WebSocket Signaling & Lobby Logic ---
wsServer.on('connection', (ws) => {
    const clientId = uuidv4();
    clients[clientId] = { ws, clientId, name: null, lobbyId: null, roomId: null };
    console.log(`Client ${clientId} connected to ${SERVER_ID}.`);
    ws.send(JSON.stringify({ type: 'server_client_id', clientId }));

    function startGame(lobby) {
        const roomId = lobby.lobbyId;
        console.log(`LOBBY ${roomId} starting game on ${SERVER_ID}...`);
        const playerClientIds = Object.keys(lobby.players);
        const playersForGame = playerClientIds.map(cid => clients[cid]).filter(c => c); 
        const lobbyPlayers = lobby.players;

        publisher.publish(LOBBY_CHANNEL, JSON.stringify({
            type: 'LOBBY_REMOVED',
            serverId: SERVER_ID,
            lobbyId: roomId
        }));

        broadcastToLobby(roomId, { type: 'server_game_starting', lobby: lobby });
        gameHosts[roomId] = new GameHost(roomId, lobby.mode, playersForGame, lobbyPlayers);
        
        for (const c of playersForGame) {
            if (c) {
                c.lobbyId = null;
                c.roomId = roomId;
            }
        }
        delete lobbies[roomId];
    }

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const client = clients[clientId];
        if (!client) return;

        const lobby = client.lobbyId ? lobbies[client.lobbyId] : null; 
        const host = client.roomId ? gameHosts[client.roomId] : null;

        switch (data.type) {
            // --- client_set_name (FIXED for "ghost" player) ---
            case 'client_set_name':
                const name = data.name.substring(0, 15);
                client.name = name;
                console.log(`Client ${clientId} set name to: ${name}`);
                ws.send(JSON.stringify({ type: 'server_name_set', name: name }));

                // Check if this client is trying to auto-join
                if (data.autoJoinLobbyId) {
                    const lobbyId = data.autoJoinLobbyId;
                    const oldClientId = data.oldClientId; // <-- FIX: Get the old ID
                    
                    // Poll for the lobby to appear in our cache
                    const tryToJoin = (retries = 5) => {
                        const targetLobby = lobbies[lobbyId];
                        
                        if (targetLobby) {
                            // --- Lobby found! ---
                            console.log(`[Auto-Join] Lobby ${lobbyId} found. Joining client ${clientId}`);
                            if (targetLobby.serverId !== SERVER_ID) {
                                ws.send(JSON.stringify({ type: 'server_redirect', url: targetLobby.serverId, lobbyId: targetLobby.lobbyId }));
                                return;
                            }

                            // --- START FIX ---
                            // Check if this is a redirected creator
                            if (oldClientId && targetLobby.players[oldClientId]) {
                                console.log(`[Auto-Join] Re-mapping redirected client ${oldClientId} to new ID ${clientId}`);
                                
                                // 1. Get the player data from the "ghost" entry
                                const playerData = targetLobby.players[oldClientId];
                                
                                // 2. Remove the ghost entry
                                delete targetLobby.players[oldClientId];
                                
                                // 3. Add the player data under their new, active client ID
                                targetLobby.players[clientId] = playerData;
                                
                                // 4. Update hostId if they were the host
                                if (targetLobby.hostId === oldClientId) {
                                    targetLobby.hostId = clientId;
                                }

                                // 5. Join them to the lobby
                                client.lobbyId = targetLobby.lobbyId;
                                ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: targetLobby }));
                                
                                // 6. Broadcast the update (now with the correct single player)
                                broadcastLobbyUpdate(targetLobby.lobbyId);

                            } else {
                                // This is a normal join (not a redirected creator)
                                if (Object.keys(targetLobby.players).length >= targetLobby.maxPlayers) {
                                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby is full.' }));
                                    return;
                                }
                                const team = getNextAvailableTeam(targetLobby);
                                targetLobby.players[clientId] = { name: client.name, team: team };
                                client.lobbyId = targetLobby.lobbyId;
                                
                                ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: targetLobby }));
                                broadcastLobbyUpdate(targetLobby.lobbyId);
                            }
                            // --- END FIX ---

                        } else if (retries > 0) {
                            // Lobby not found, try again
                            console.log(`[Auto-Join] Lobby ${lobbyId} not in cache. Retrying... (${retries} left)`);
                            setTimeout(() => tryToJoin(retries - 1), 200); // Poll every 200ms
                        } else {
                            // Failed all retries
                            console.log(`[Auto-Join] Failed to find lobby ${lobbyId} for client ${clientId}.`);
                            ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found. Please try again.' }));
                        }
                    };
                    tryToJoin(); // Start polling
                }
                break;
            
            // --- client_create_lobby (FIXED) ---
            case 'client_create_lobby':
                if (lobby || host) { ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' })); return; }
                if (!client.name) { ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' })); return; }
                
                const lobbyId = generateLobbyCode();
                const mode = data.mode;
                const bestServerId = findLeastLoadedServer();
                
                const newLobby = {
                    lobbyId,
                    serverId: bestServerId,
                    hostId: clientId,
                    mode: mode,
                    isPrivate: data.isPrivate,
                    maxPlayers: modeRequirements[mode],
                    players: { [clientId]: { name: client.name, team: 'blue' } }
                };
                
                // Always publish to Redis
                publisher.publish(LOBBY_CHANNEL, JSON.stringify({
                    type: 'LOBBY_CREATED',
                    serverId: bestServerId,
                    lobby: newLobby
                }));

                if (bestServerId !== SERVER_ID) {
                    console.log(`[LoadBalancer] Creating private lobby ${lobbyId} on ${bestServerId} and redirecting client ${clientId}`);
                    ws.send(JSON.stringify({ 
                        type: 'server_redirect', 
                        url: bestServerId,
                        lobbyId: lobbyId,
                        oldClientId: clientId // <-- FIX: Send old ID
                    }));
                } else {
                    // This lobby is on OUR server. Add to local cache and join.
                    lobbies[lobbyId] = newLobby;
                    client.lobbyId = lobbyId;
                    console.log(`Client ${client.name} created lobby ${lobbyId} on ${SERVER_ID}`);
                    ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newLobby }));
                }
                break;

            // --- client_join_lobby ---
            case 'client_join_lobby':
                 if (lobby || host) { ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' })); return; }
                 if (!client.name) { ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' })); return; }
                
                const targetLobby = lobbies[data.lobbyId.toUpperCase()];
                if (!targetLobby) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found.' }));
                    return;
                }
                
                if (targetLobby.serverId !== SERVER_ID) {
                    console.log(`Redirecting client ${clientId} to ${targetLobby.serverId} for lobby ${targetLobby.lobbyId}`);
                    ws.send(JSON.stringify({ 
                        type: 'server_redirect', 
                        url: targetLobby.serverId,
                        lobbyId: targetLobby.lobbyId
                        // NOTE: No oldClientId here, this is a simple join
                    }));
                    return;
                }
                
                if (Object.keys(targetLobby.players).length >= targetLobby.maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Lobby is full.' }));
                    return;
                }
                
                const team = getNextAvailableTeam(targetLobby);
                targetLobby.players[clientId] = { name: client.name, team: team };
                client.lobbyId = targetLobby.lobbyId;
                
                console.log(`Client ${client.name} joined lobby ${targetLobby.lobbyId} on ${SERVER_ID}`);
                ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: targetLobby }));
                
                broadcastLobbyUpdate(targetLobby.lobbyId);
                break;
            
            // --- client_find_game (FIXED) ---
            case 'client_find_game':
                if (lobby || host) { ws.send(JSON.stringify({ type: 'error', message: 'Already in a lobby or game.' })); return; }
                if (!client.name) { ws.send(JSON.stringify({ type: 'error', message: 'Must set name first.' })); return; }

                const publicLobby = Object.values(lobbies).find(l => 
                    !l.isPrivate &&
                    l.mode === data.mode &&
                    Object.keys(l.players).length < l.maxPlayers
                );
                
                if (publicLobby) {
                    // --- Found an existing lobby ---
                    if (publicLobby.serverId !== SERVER_ID) {
                        console.log(`[LoadBalancer] Found lobby ${publicLobby.lobbyId} on ${publicLobby.serverId}. Redirecting client ${clientId}`);
                        ws.send(JSON.stringify({ 
                            type: 'server_redirect', 
                            url: publicLobby.serverId,
                            lobbyId: publicLobby.lobbyId
                            // NOTE: No oldClientId here, this is a simple join
                        }));
                        return;
                    }
                    
                    // Join the local public lobby
                    const team = getNextAvailableTeam(publicLobby);
                    publicLobby.players[clientId] = { name: client.name, team: team };
                    client.lobbyId = publicLobby.lobbyId;
                    
                    console.log(`Client ${client.name} matched into lobby ${publicLobby.lobbyId} on ${SERVER_ID}`);
                    ws.send(JSON.stringify({ type: 'server_lobby_joined', lobbyState: publicLobby }));
                    broadcastLobbyUpdate(publicLobby.lobbyId);

                    if (Object.keys(publicLobby.players).length === publicLobby.maxPlayers) {
                        console.log(`Public lobby ${publicLobby.lobbyId} is full. Auto-starting game...`);
                        startGame(publicLobby);
                    }
                } else {
                    // --- No public lobby found, create one ---
                    const newLobbyId = generateLobbyCode();
                    const bestServerId = findLeastLoadedServer();
                    const newPublicLobby = {
                        lobbyId: newLobbyId,
                        serverId: bestServerId,
                        hostId: clientId,
                        mode: data.mode,
                        isPrivate: false,
                        maxPlayers: modeRequirements[data.mode],
                        players: { [clientId]: { name: client.name, team: 'blue' } }
                    };

                    // Always publish to Redis
                    publisher.publish(LOBBY_CHANNEL, JSON.stringify({
                        type: 'LOBBY_CREATED',
                        serverId: bestServerId,
                        lobby: newPublicLobby
                    }));

                    if (bestServerId !== SERVER_ID) {
                        console.log(`[LoadBalancer] Creating public lobby ${newLobbyId} on ${bestServerId} and redirecting client ${clientId}`);
                        ws.send(JSON.stringify({ 
                            type: 'server_redirect', 
                            url: bestServerId,
                            lobbyId: newLobbyId,
                            oldClientId: clientId // <-- FIX: Send old ID
                        }));
                    } else {
                        // This lobby is on OUR server. Add to local cache and join.
                        lobbies[newLobbyId] = newPublicLobby;
                        client.lobbyId = newLobbyId;
                        console.log(`Client ${client.name} created new public lobby ${newLobbyId} on ${SERVER_ID}`);
                        ws.send(JSON.stringify({ type: 'server_lobby_created', lobbyState: newPublicLobby }));
                    }
                }
                break;
            
            // --- client_change_team ---
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

            // --- client_start_game ---
            case 'client_start_game':
                if (!lobby) { ws.send(JSON.stringify({ type: 'error', message: 'Not in a lobby.' })); return; }
                if (lobby.hostId !== clientId) { ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' })); return; }
                if (lobby.isPrivate && Object.keys(lobby.players).length !== lobby.maxPlayers) { ws.send(JSON.stringify({ type: 'error', message: 'Waiting for more players.' })); return; }
                if (countTeam(lobby, 'blue') !== countTeam(lobby, 'red')) { ws.send(JSON.stringify({ type: 'error', message: 'Teams must be balanced.' })); return; }
                
                startGame(lobby);
                break;

            // --- WebRTC Handlers ---
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
        console.log(`Client ${clientId} disconnected from ${SERVER_ID}.`);
        const client = clients[clientId];
        if (!client) return; 

        if (client.lobbyId && lobbies[client.lobbyId]) {
            const lobby = lobbies[client.lobbyId];
            
            if (lobby.serverId === SERVER_ID) {
                console.log(`Removing ${client.name} from lobby ${client.lobbyId}`);
                delete lobby.players[clientId];
                
                if (Object.keys(lobby.players).length === 0) {
                    console.log(`Lobby ${client.lobbyId} is empty, deleting and publishing.`);
                    delete lobbies[client.lobbyId];
                    publisher.publish(LOBBY_CHANNEL, JSON.stringify({
                        type: 'LOBBY_REMOVED',
                        serverId: SERVER_ID,
                        lobbyId: client.lobbyId
                    }));
                } else {
                    if (lobby.hostId === clientId) {
                        lobby.hostId = Object.keys(lobby.players)[0];
                    }
                    broadcastLobbyUpdate(lobby.lobbyId); // This also publishes
                }
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