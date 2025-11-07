// GameLogic.js
// This file contains the PURE game logic, no networking.

// --- Game Constants ---
const GRID_SIZE = 20;
const WIN_SCORE = 3;
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

class GameLogic {
    constructor(playerInfoMap) { // Receives { 'blue1': { id, team, name }, ... }
        this.mapLayout = simpleMapLayout;
        this.playerMovements = {}; // { 'blue1': { up: false, ... } }
        this.playerIdToInfo = playerInfoMap;

        this.gameState = {
            players: {},
            flags: {
                blue: { x: 1, y: 9, carriedBy: null },
                red: { x: 18, y: 9, carriedBy: null }
            },
            scores: { blue: 0, red: 0 },
            playerStats: {}
        };

        // Initialize all players
        for (const playerId in this.playerIdToInfo) {
            const playerInfo = this.playerIdToInfo[playerId];
            this.addPlayerToState(playerInfo);
            this.playerMovements[playerId] = { up: false, down: false, left: false, right: false };
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

    // New function to receive input from the main thread
    handleInput(playerId, inputState) {
        if (this.playerMovements[playerId]) {
            this.playerMovements[playerId] = inputState;
        }
    }

    // New function to handle player disconnect
    removePlayer(playerId) {
        delete this.playerMovements[playerId];
        delete this.gameState.players[playerId];
        // We keep their stats for the final scoreboard
    }

    // This is the main tick function for the worker
    runGameTick() {
        // 1. Update positions
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

        // 2. Check logic
        let globalWinner = null;
        for (const playerId in this.gameState.players) {
            if (globalWinner) break;
            const { newState, gameOverWinner } = this.checkGameLogic(playerId, this.gameState);
            this.gameState = newState;
            if (gameOverWinner) globalWinner = gameOverWinner;
        }

        // 3. Check for game over
        if (globalWinner) {
            let mvpPlayerId = null;
            let maxMvpScore = -1;
            for (const [playerId, stats] of Object.entries(this.gameState.playerStats)) {
                const mvpScore = (stats.captures * 100) + (stats.tags * 25);
                if (mvpScore > maxMvpScore) {
                    maxMvpScore = mvpScore;
                    mvpPlayerId = playerId;
                }
            }
            // Return a special object indicating the game is over
            return {
                type: 'game_over',
                payload: {
                    winner: globalWinner,
                    scores: this.gameState.scores,
                    playerStats: this.gameState.playerStats,
                    mvp: mvpPlayerId
                }
            };
        }

        // 4. Return current state
        return {
            type: 'game_state',
            payload: this.gameState
        };
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
}

module.exports = GameLogic;