// game.worker.js
const { parentPort, threadId } = require('worker_threads');
const GameLogic = require('./GameLogic.js');

const TICK_RATE = 1000 / 20; // 20 ticks per second

let gameLogic;
let gameLoopInterval = null;
let roomId = null; // <-- FIX: Store the room ID here

// This function runs the tick and sends the result to the main thread
const runTick = () => {
    if (!gameLogic) return;

    const result = gameLogic.runGameTick();
    
    if (result.type === 'game_state') {
        // Send the latest state to the main thread
        parentPort.postMessage(result);
    } else if (result.type === 'game_over') {
        // Send the final results
        parentPort.postMessage(result);
        // Stop the loop
        clearInterval(gameLoopInterval);
        // Tell the main thread we are done
        parentPort.postMessage({ type: 'worker_shutdown' });
    }
};

// Listen for messages from the main thread
parentPort.on('message', (message) => {
    switch(message.type) {
        // 'init' is sent once with the lobby data
        case 'init':
            roomId = message.roomId; // <-- FIX: Save the roomId
            console.log(`[Worker ${roomId}]: Initializing on THREAD ID: ${threadId}`);
            gameLogic = new GameLogic(message.playerInfoMap);
            break;

        case 'start_game':
            // <-- FIX: Use the saved roomId
            console.log(`[Worker ${roomId}]: All players ready. Starting game loop on THREAD ID: ${threadId}`);
            gameLoopInterval = setInterval(runTick, TICK_RATE);
            break;

        // 'client_input' is sent every time a player moves
        case 'client_input':
            if (gameLogic) {
                gameLogic.handleInput(message.playerId, message.inputState);
            }
            break;
        
        // 'remove_player' is sent if a player disconnects
        case 'remove_player':
            if (gameLogic) {
                // <-- FIX: Use the saved roomId
                console.log(`[Worker ${roomId}]: Removing player ${message.playerId}`);
                gameLogic.removePlayer(message.playerId);
            }
            break;
    }
});