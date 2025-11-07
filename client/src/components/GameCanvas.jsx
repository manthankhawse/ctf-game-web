// ctf-client/src/components/GameCanvas.jsx
import React, { useRef, useEffect } from 'react';

const TILE_SIZE = 30;
const GRID_SIZE = 20;



const GameCanvas = ({ gameState, mapLayout, myTeam, myId }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    // Wait for both gameState and mapLayout
    if (!gameState || !mapLayout) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    drawGame(ctx, canvas, gameState, mapLayout, myTeam, myId);
  }, [gameState, mapLayout, myTeam, myId]); // Add mapLayout to dependency array

  return (
    <canvas 
      ref={canvasRef} 
      id="gameCanvas" 
      width={GRID_SIZE * TILE_SIZE} 
      height={GRID_SIZE * TILE_SIZE}
    ></canvas>
  );
};

// Main draw function
function drawGame(ctx, canvas, state, mapLayout, myTeam, myId) {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw bases
  ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
  ctx.fillRect(0, 0, TILE_SIZE * 3, canvas.height);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  ctx.fillRect(canvas.width - TILE_SIZE * 3, 0, TILE_SIZE * 3, canvas.height);

  // 2. Draw Obstacles (NEW)
  drawObstacles(ctx, mapLayout);

  const { flags, players } = state;

  // 3. Draw Flags
  if (flags.blue && !flags.blue.carriedBy) drawFlag(ctx, flags.blue, '#3498db');
  if (flags.red && !flags.red.carriedBy) drawFlag(ctx, flags.red, '#e74c3c');

  // 4. Draw Players
  if (players) {
    for (const id in players) {
      drawPlayer(ctx, players[id], id, myId);
      if (players[id].hasFlag) drawFlagOnPlayer(ctx, players[id]);
    }
  }
}

// --- NEW Helper Function ---
function drawObstacles(ctx, mapLayout) {
  ctx.fillStyle = '#8395a7'; // A simple gray for walls
  ctx.strokeStyle = '#576574'; // A darker border
  ctx.lineWidth = 2;

  for (let y = 0; y < mapLayout.length; y++) {
    for (let x = 0; x < mapLayout[y].length; x++) {
      if (mapLayout[y][x] === 1) { // 1 means wall
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
// --- END OF NEW ---

function drawPlayer(ctx, player, playerId, myId) {
  ctx.fillStyle = player.team === 'blue' ? '#3498db' : '#e74c3c';
  ctx.beginPath();
  ctx.arc(
    player.x * TILE_SIZE + TILE_SIZE / 2,
    player.y * TILE_SIZE + TILE_SIZE / 2,
    TILE_SIZE / 2 - 2,
    0,
    2 * Math.PI
  );
  ctx.fill();

  // Highlight "me"
  if (playerId === myId) {
    ctx.strokeStyle = 'gold';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Draw player name
  ctx.fillStyle = 'white';
  ctx.font = '10px Poppins';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, player.x * TILE_SIZE + TILE_SIZE / 2, player.y * TILE_SIZE - 5);
}

function drawFlag(ctx, flag, color) {
  ctx.fillStyle = color;
  ctx.fillRect(flag.x * TILE_SIZE + 5, flag.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 14px Poppins';
  ctx.textAlign = 'center';
  ctx.fillText('F', flag.x * TILE_SIZE + TILE_SIZE / 2, flag.y * TILE_SIZE + TILE_SIZE / 2 + 5);
}

function drawFlagOnPlayer(ctx, player) {
  const flagColor = player.hasFlag === 'blue' ? '#3498db' : '#e74c3c';
  ctx.fillStyle = flagColor;
  ctx.fillRect(player.x * TILE_SIZE + 8, player.y * TILE_SIZE - 12, TILE_SIZE - 16, TILE_SIZE - 16);
}

export default GameCanvas;