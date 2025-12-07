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
      className="game-canvas"
    ></canvas>
  );
};

function drawGame(ctx, canvas, state, mapLayout, myTeam, myId) {
  // 1. Dark Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Draw Sci-Fi Grid
  ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i++) {
    // Vertical lines
    ctx.beginPath();
    ctx.moveTo(i * TILE_SIZE, 0);
    ctx.lineTo(i * TILE_SIZE, canvas.height);
    ctx.stroke();
    // Horizontal lines
    ctx.beginPath();
    ctx.moveTo(0, i * TILE_SIZE);
    ctx.lineTo(canvas.width, i * TILE_SIZE);
    ctx.stroke();
  }

  // 3. Draw Bases (The "End Zones")
  // Blue Base (Left)
  const blueBaseGradient = ctx.createLinearGradient(0, 0, TILE_SIZE * 3, 0);
  blueBaseGradient.addColorStop(0, 'rgba(0, 243, 255, 0.2)');
  blueBaseGradient.addColorStop(1, 'rgba(0, 243, 255, 0.0)');
  ctx.fillStyle = blueBaseGradient;
  ctx.fillRect(0, 0, TILE_SIZE * 2, canvas.height); // Reduced width slightly for visual clarity

  // Red Base (Right)
  const redBaseGradient = ctx.createLinearGradient(canvas.width - TILE_SIZE * 3, 0, canvas.width, 0);
  redBaseGradient.addColorStop(0, 'rgba(255, 0, 85, 0.0)');
  redBaseGradient.addColorStop(1, 'rgba(255, 0, 85, 0.2)');
  ctx.fillStyle = redBaseGradient;
  ctx.fillRect(canvas.width - TILE_SIZE * 2, 0, TILE_SIZE * 2, canvas.height);

  // 4. Draw Base Labels (So you know where to run)
  ctx.font = 'bold 20px Rajdhani';
  ctx.textAlign = 'center';
  ctx.save();
  
  // Blue Label
  ctx.fillStyle = 'rgba(0, 243, 255, 0.3)';
  ctx.translate(20, canvas.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("BLUE BASE", 0, 0);
  ctx.restore();

  // Red Label
  ctx.save();
  ctx.fillStyle = 'rgba(255, 0, 85, 0.3)';
  ctx.translate(canvas.width - 20, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("RED BASE", 0, 0);
  ctx.restore();

  // 5. Draw Obstacles
  drawObstacles(ctx, mapLayout);

  const { flags, players } = state;

  // 6. Draw Flags (Neon Squares)
  if (flags.blue && !flags.blue.carriedBy) drawFlag(ctx, flags.blue, '#00f3ff'); // Neon Blue
  if (flags.red && !flags.red.carriedBy) drawFlag(ctx, flags.red, '#ff0055');   // Neon Red

  // 7. Draw Players
  if (players) {
    for (const id in players) {
      drawPlayer(ctx, players[id], id, myId);
    }
  }
}

function drawObstacles(ctx, mapLayout) {
  ctx.fillStyle = '#1e293b'; 
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 10;
  for (let y = 0; y < mapLayout.length; y++) {
    for (let x = 0; x < mapLayout[y].length; x++) {
      if (mapLayout[y][x] === 1) {
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        // Add a highlight edge
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  ctx.shadowBlur = 0; // Reset shadow
}

function drawPlayer(ctx, player, playerId, myId) {
  const isBlue = player.team === 'blue';
  const color = isBlue ? '#00f3ff' : '#ff0055';
  
  // Player Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.fillStyle = color;
  
  ctx.beginPath();
  ctx.arc(
    player.x * TILE_SIZE + TILE_SIZE / 2,
    player.y * TILE_SIZE + TILE_SIZE / 2,
    TILE_SIZE / 2 - 4,
    0,
    2 * Math.PI
  );
  ctx.fill();
  ctx.shadowBlur = 0; // Reset

  // Highlight "Me" with a ring
  if (playerId === myId) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw Flag if carried
  if (player.hasFlag) {
    const flagColor = player.hasFlag === 'blue' ? '#00f3ff' : '#ff0055';
    ctx.fillStyle = flagColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    // Draw a small diamond above player
    const px = player.x * TILE_SIZE + TILE_SIZE / 2;
    const py = player.y * TILE_SIZE;
    ctx.beginPath();
    ctx.moveTo(px, py - 10);
    ctx.lineTo(px + 6, py - 4);
    ctx.lineTo(px, py + 2);
    ctx.lineTo(px - 6, py - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Name Tag
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '10px Rajdhani';
  ctx.textAlign = 'center';
  ctx.fillText(player.name, player.x * TILE_SIZE + TILE_SIZE / 2, player.y * TILE_SIZE - 12);
}

function drawFlag(ctx, flag, color) {
  // Flag Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  
  // Draw a standard flag shape
  const x = flag.x * TILE_SIZE;
  const y = flag.y * TILE_SIZE;
  
  ctx.fillRect(x + 10, y + 5, 10, 20); // Pole/Base
  
  // Reset
  ctx.shadowBlur = 0;
}

export default GameCanvas;