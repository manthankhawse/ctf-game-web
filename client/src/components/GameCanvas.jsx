// ctf-client/src/components/GameCanvas.js
import React, { useRef, useEffect } from 'react';

const TILE_SIZE = 30;

const GameCanvas = ({ gameState, myTeam, myId }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!gameState) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    drawGame(ctx, canvas, gameState, myTeam, myId);
  }, [gameState, myTeam, myId]);

  return (
    <canvas ref={canvasRef} id="gameCanvas" width="600" height="600"></canvas>
  );
};

function drawGame(ctx, canvas, state, myTeam, myId) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // bases
  ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
  ctx.fillRect(0, 0, TILE_SIZE * 3, canvas.height);
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  ctx.fillRect(canvas.width - TILE_SIZE * 3, 0, TILE_SIZE * 3, canvas.height);

  const { flags, players } = state;
  if (flags.blue && !flags.blue.carriedBy) drawFlag(ctx, flags.blue, '#3498db');
  if (flags.red && !flags.red.carriedBy) drawFlag(ctx, flags.red, '#e74c3c');

  if (players) {
    for (const id in players) {
      drawPlayer(ctx, players[id], id, myId);
      if (players[id].hasFlag) drawFlagOnPlayer(ctx, players[id]);
    }
  }
}

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

  if (playerId === myId) {
    ctx.strokeStyle = 'gold';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawFlag(ctx, flag, color) {
  ctx.fillStyle = color;
  ctx.fillRect(flag.x * TILE_SIZE + 5, flag.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 14px Poppins';
  ctx.fillText('F', flag.x * TILE_SIZE + 10, flag.y * TILE_SIZE + 20);
}

function drawFlagOnPlayer(ctx, player) {
  const flagColor = player.hasFlag === 'blue' ? '#3498db' : '#e74c3c';
  ctx.fillStyle = flagColor;
  ctx.fillRect(player.x * TILE_SIZE + 8, player.y * TILE_SIZE - 12, TILE_SIZE - 16, TILE_SIZE - 16);
}

export default GameCanvas;
