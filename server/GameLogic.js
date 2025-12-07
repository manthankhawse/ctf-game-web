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
    constructor(playerInfoMap) {
        this.mapLayout = simpleMapLayout;
        this.playerMovements = {}; 
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
            x: isBlue ? 0 : 19, // Spawn on back wall
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

    handleInput(playerId, inputState) {
        if (this.playerMovements[playerId]) {
            this.playerMovements[playerId] = inputState;
        }
    }

    removePlayer(playerId) {
        delete this.playerMovements[playerId];
        delete this.gameState.players[playerId];
        // Keep stats for scoreboard
    }

    runGameTick() {
        // 1. Update positions based on inputs
        for (const playerId in this.playerMovements) {
            const moves = this.playerMovements[playerId];
            const player = this.gameState.players[playerId];
            if (!player) continue;

            let targetX = player.x, targetY = player.y;
            if (moves.up) targetY--;
            if (moves.down) targetY++;
            if (moves.left) targetX--;
            if (moves.right) targetX++;

            // Bounds check
            targetX = Math.max(0, Math.min(GRID_SIZE - 1, targetX));
            targetY = Math.max(0, Math.min(GRID_SIZE - 1, targetY));

            // Wall check
            const isWall = this.mapLayout[targetY][targetX] === 1;

            // Simple player collision check (prevents walking ON TOP of each other)
            // Note: We allow overlap for tagging logic in the next step, 
            // but we might want to prevent "stacking".
            // For now, let's allow movement to the tile, and let the logic handler resolve the tag.
            
            if (!isWall) {
                player.x = targetX;
                player.y = targetY;
            }
        }

        // 2. Check Game Logic (Flags, Tags, Scoring)
        let globalWinner = null;
        for (const playerId in this.gameState.players) {
            if (globalWinner) break;
            const { newState, gameOverWinner } = this.checkGameLogic(playerId, this.gameState);
            this.gameState = newState;
            if (gameOverWinner) globalWinner = gameOverWinner;
        }

        // 3. Game Over Check
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

        return {
            type: 'game_state',
            payload: this.gameState
        };
    }

    checkGameLogic(playerId, currentState) {
        let newState = JSON.parse(JSON.stringify(currentState)); // Deep copy state
        let gameOverWinner = null;
        const player = newState.players[playerId];
        if (!player) return { newState, gameOverWinner };

        const playerTeam = player.team;
        const opponentTeam = playerTeam === 'blue' ? 'red' : 'blue';
        const opponentFlag = newState.flags[opponentTeam];
        const homeBaseCenter = playerTeam === 'blue' ? { x: 1, y: 9 } : { x: 18, y: 9 };

        // --- 1. Flag Pickup ---
        // If I touch enemy flag and nobody has it
        if (player.x === opponentFlag.x && player.y === opponentFlag.y && !opponentFlag.carriedBy) {
            player.hasFlag = opponentTeam;
            opponentFlag.carriedBy = playerId;
        }

        // --- 2. Scoring ---
        // If I have the flag and reach my base
        const inHomeBase = (player.x === homeBaseCenter.x && player.y === homeBaseCenter.y); // Simplified base logic (just center)
        // OR Expand base check to the back wall area (optional improvement)
        const inScoringZone = playerTeam === 'blue' ? player.x <= 1 : player.x >= 18;

        if (player.hasFlag && inScoringZone) {
            newState.scores[playerTeam]++;
            if (newState.playerStats[playerId]) {
                newState.playerStats[playerId].captures++;
            }
            
            if (newState.scores[playerTeam] >= WIN_SCORE) {
                gameOverWinner = playerTeam;
            } else {
                newState = this.resetRound(newState);
            }
            return { newState, gameOverWinner }; // Return immediately if round resets
        }

        // --- 3. Tagging Logic (The Fix) ---
        // Check collision with ANY opponent
        for (const otherId in newState.players) {
            if (playerId === otherId) continue;
            const otherPlayer = newState.players[otherId];

            // If we are on the same tile...
            if (player.x === otherPlayer.x && player.y === otherPlayer.y) {
                // ...and on opposite teams
                if (player.team !== otherPlayer.team) {
                    
                    // Case A: I tag them (They have MY flag)
                    if (otherPlayer.hasFlag === player.team) {
                        this.handleTag(newState, otherId, playerId); // Tagged: Other, Tagger: Me
                    }
                    
                    // Case B: They tag me (I have THEIR flag)
                    else if (player.hasFlag === otherPlayer.team) {
                        this.handleTag(newState, playerId, otherId); // Tagged: Me, Tagger: Other
                    }
                }
            }
        }

        return { newState, gameOverWinner };
    }

    // Helper to process a tag event
    handleTag(state, taggedPlayerId, taggerPlayerId) {
        const taggedPlayer = state.players[taggedPlayerId];
        const flagTeam = taggedPlayer.hasFlag;

        if (!flagTeam) return; // Should not happen, but safety check

        // 1. Reset the flag
        state.flags[flagTeam].carriedBy = null;
        state.flags[flagTeam].x = (flagTeam === 'blue') ? 1 : 18; 
        state.flags[flagTeam].y = 9;

        // 2. Respawn the tagged player
        // Send them back to the wall
        taggedPlayer.x = (taggedPlayer.team === 'blue') ? 0 : 19;
        taggedPlayer.y = taggedPlayer.initialY;
        taggedPlayer.hasFlag = null;

        // 3. Give stats to the tagger
        if (state.playerStats[taggerPlayerId]) {
            state.playerStats[taggerPlayerId].tags++;
        }
    }

    resetRound(state = this.gameState) {
        for (const playerId in state.players) {
            const player = state.players[playerId];
            const isBlue = player.team === 'blue';
            // Spawn on back walls
            player.x = isBlue ? 0 : 19;
            player.y = player.initialY;
            player.hasFlag = null;
        }
        state.flags.blue = { x: 1, y: 9, carriedBy: null };
        state.flags.red = { x: 18, y: 9, carriedBy: null };
        return state;
    }
}

module.exports = GameLogic;