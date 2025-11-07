// lobby_load_test.js
// const WebSocket = require('ws');

// // --- Configuration ---
// const SERVER_URL = 'ws://localhost:3000';
// const TOTAL_BOTS = 5000; // <-- Set how many users to simulate
// const BOT_PREFIX = 'LoadTestBot';
// const CONNECT_STAGGER_MS = 10; // Connect one bot every 10ms
// // ---------------------

// function spawnBot(id) {
//   const name = `${BOT_PREFIX}-${id}`;
//   let ws;

//   function connect() {
//     ws = new WebSocket(SERVER_URL);

//     ws.onopen = () => {
//       // 1. Set name
//       ws.send(JSON.stringify({ type: 'client_set_name', name: name }));
//       // 2. Join queue
//       ws.send(JSON.stringify({ type: 'client_find_game', mode: '1v1' }));
//     };

//     ws.onmessage = (message) => {
//       // We don't need to do anything with messages for this test.
//       // We're just checking if the server can *handle* sending them.
//     };

//     ws.onclose = () => {
//       // When disconnected, reconnect after a short, random delay
//       // This simulates a user refreshing the page or re-queueing.
//       setTimeout(connect, 1000 + Math.random() * 4000);
//     };

//     ws.onerror = (err) => {
//       // If a bot fails to connect, log it and let 'onclose' handle the retry.
//       console.error(`[${name}]: Error: ${err.message}`);
//       ws.close();
//     };
//   }

//   // Start the bot's connection loop
//   connect();
// }

// // --- Main execution ---
// console.log(`Starting load test with ${TOTAL_BOTS} concurrent users...`);
// console.log(`One bot will be spawned every ${CONNECT_STAGGER_MS}ms.`);

// for (let i = 0; i < TOTAL_BOTS; i++) {
//   // Stagger the initial connections to avoid a "thundering herd"
//   // that instantly crashes the server. This is more realistic.
//   setTimeout(() => {
//     spawnBot(i);
//   }, i * CONNECT_STAGGER_MS);
// }

// game_bot_test.js
const WebSocket = require('ws');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('werift');

// --- CONFIGURATION ---
const BOT_COUNT = 5000; // <-- START HERE. This will create (BOT_COUNT / 2) games.
// ---------------------

function createBot(name) {
  const ws = new WebSocket('ws://localhost:3000');
  let pc;
  let dc;
  let gameSpamInterval;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'client_set_name', name: name }));
    ws.send(JSON.stringify({ type: 'client_find_game', mode: '1v1' }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'server_offer':
        // console.log(`[${name}]: Received offer, creating answer...`);
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        pc.ondatachannel = (e) => {
          dc = e.channel;
          dc.onopen = () => {
            console.log(`[${name}]: Data channel OPEN. Starting game worker.`);
            // Start spamming inputs to simulate a real player
            gameSpamInterval = setInterval(() => {
              if (dc.readyState === 'open') {
                dc.send(JSON.stringify({
                  type: 'client_input',
                  inputState: { 
                    up: Math.random() > 0.8, 
                    down: false, 
                    left: Math.random() > 0.5, 
                    right: Math.random() > 0.5 
                  }
                }));
              }
            }, 100); // Send 10 inputs/sec
          };

          dc.onmessage = (e) => {
            // We don't need to read the game state, but we'll log it
            // to show the worker is running and sending updates.
            // console.log(`[${name}]: Received game state.`);
          };

          dc.onclose = () => {
            clearInterval(gameSpamInterval);
          };
        };

        await pc.setRemoteDescription(msg.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'client_answer', answer: answer }));
        break;

      case 'server_ice_candidate':
        if (pc && msg.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;
    }
  };

  ws.onclose = () => {
    console.log(`[${name}]: WebSocket closed.`);
    clearInterval(gameSpamInterval);
  };

  ws.onerror = (err) => {
    console.error(`[${name}]: Error: ${err.message}`);
    clearInterval(gameSpamInterval);
    ws.close();
  };
}

// --- Main execution ---
if (BOT_COUNT % 2 !== 0) {
  console.warn('BOT_COUNT should be an even number to create 1v1 matches.');
}

console.log(`Spawning ${BOT_COUNT} bots to create ${BOT_COUNT / 2} concurrent games...`);
for (let i = 0; i < BOT_COUNT; i++) {
  createBot(`GameBot-${i}`);
}