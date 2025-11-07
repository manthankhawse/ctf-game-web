// ctf-client/src/pages/Game.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import GameCanvas from '../components/GameCanvas';
import '../App.css';

const iceServers = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function Game() {
  const navigate = useNavigate();
  const { socket, addSocketListener, removeSocketListener, lobbyState } = useSocket();
  const lobby = lobbyState;

  const [myId, setMyId] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [gameState, setGameState] = useState(null); 
  const [gameStatus, setGameStatus] = useState('Connecting...');

  const peerConnectionRef = useRef(null); 
  const dataChannelRef = useRef(null); 
  const iceQueueRef = useRef([]);
  const inputLoopRef = useRef(null);
  const localMovementsRef = useRef({ up: false, down: false, left: false, right: false });
  const isNavigatingAwayRef = useRef(false);

  // --- useEffect 1: Setup Game Listeners (Runs ONCE) ---
  useEffect(() => {
    if (!socket || !lobby) {
      console.error('No socket or lobby state found, returning home.');
      navigate('/'); 
      return;
    }

    const handleSocketMessage = async (message) => {
      switch (message.type) {
        case 'server_offer':
          console.log('Received server offer');
          setMyId(message.playerInfo.id);
          setMyTeam(message.playerInfo.team);
          setGameStatus('Connecting to game server...');

          peerConnectionRef.current = new RTCPeerConnection(iceServers);

          peerConnectionRef.current.onicecandidate = (event) => {
              if (event.candidate) {
                  socket.send(JSON.stringify({
                      type: 'client_ice_candidate',
                      candidate: event.candidate.toJSON()
                  }));
              }
          };

          peerConnectionRef.current.ondatachannel = (event) => {
              console.log('Data channel received from server!');
              dataChannelRef.current = event.channel;
              setupDataChannel(event.channel);
          };

          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.offer));

          console.log(`Processing ${iceQueueRef.current.length} queued ICE candidates.`);
          while (iceQueueRef.current.length > 0) {
              const candidate = iceQueueRef.current.shift();
              try {
                  await peerConnectionRef.current.addIceCandidate(new RTCSessionDescription(candidate));
              } catch (e) {
                  console.error('Error adding queued ICE candidate', e);
              }
          }

          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);

          socket.send(JSON.stringify({
              type: 'client_answer',
              answer: peerConnectionRef.current.localDescription.toJSON()
          }));
          break;
        
        case 'server_ice_candidate':
          if (message.candidate) {
              if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
                  try {
                      await peerConnectionRef.current.addIceCandidate(new RTCSessionDescription(message.candidate));
                  } catch (e) {
                      console.error('Error adding received ICE candidate', e);
                  }
              } else {
                  console.warn('PC not ready, queuing ICE candidate');
                  iceQueueRef.current.push(message.candidate);
              }
          }
          break;
        
        default:
            break;
      }
    };
    
    addSocketListener('all', handleSocketMessage);

    // --- Cleanup function ---
    return () => {
      console.log("Cleaning up game page.");
      removeSocketListener('all');
      clearInterval(inputLoopRef.current); // This is the CORRECT place
      if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, lobby, navigate, addSocketListener, removeSocketListener]); 


  // --- Helper: Setup Data Channel ---
  const setupDataChannel = (channel) => {
    channel.onopen = () => {
        console.log('Data channel OPEN');
        setGameStatus('Game in progress!');
        
        clearInterval(inputLoopRef.current); // Clear any old just in case
        inputLoopRef.current = setInterval(() => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'client_input',
                    inputState: localMovementsRef.current
                }));
            }
        }, 1000 / 60); // 60 FPS
    };

    channel.onclose = () => {
        console.log('Data channel CLOSED');
        setGameStatus('Lost connection to game server.');
        clearInterval(inputLoopRef.current); // Clear on close
    };

    channel.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'gameState') {
            setGameState(message.state); 
        } else if (message.type === 'game_over_final') {
            console.log("Final game over received!", message);
            
            clearInterval(inputLoopRef.current); // Clear on game over
            
            isNavigatingAwayRef.current = true;
            
            navigate('/results', { 
                state: { 
                    winner: message.winner, 
                    scores: message.scores 
                } 
            });
        }
    };
  };

  // --- useEffect 2: Keyboard Input Handling (CHANGED) ---
  useEffect(() => {
    const getDirectionFromKey = (key) => {
      switch (key) {
        case 'ArrowUp': case 'w': return 'up';
        case 'ArrowDown': case 's': return 'down';
        case 'ArrowLeft': case 'a': return 'left';
        case 'ArrowRight': case 'd': return 'right';
        default: return null;
      }
    };

    const handleKeyDown = (e) => {
      const direction = getDirectionFromKey(e.key);
      if (direction) { 
        e.preventDefault();
        localMovementsRef.current[direction] = true;
      }
    };

    const handleKeyUp = (e) => {
      const direction = getDirectionFromKey(e.key);
      if (direction) { 
        e.preventDefault();
        localMovementsRef.current[direction] = false;
      }
    };
    
    const handleBlur = () => {
      console.log("Window blurred, releasing all keys.");
      localMovementsRef.current = { up: false, down: false, left: false, right: false };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur); 

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur); 
      // --- FIX (Bug 3): Removed clearInterval from here ---
    };
  }, []); // Empty deps, runs once

  // --- Render Logic (UNCHANGED) ---
  const scores = gameState ? gameState.scores : { blue: 0, red: 0 };
  const teamColor = myTeam === 'blue' ? '#3498db' : '#e74c3c';

  return (
    <div className="game-container">
      <div className="score-board">
        <h2>SCORES</h2>
        <p>Blue: <span id="blue-score">{scores.blue}</span></p>
        <p>Red: <span id="red-score">{scores.red}</span></p>
      </div>
      
      <GameCanvas gameState={gameState} myTeam={myTeam} myId={myId} />
      
      <div className="status">
        <h2>STATUS</h2>
        <p id="player-id" style={{ color: teamColor }}>
          {myId ? `You are: ${myId.toUpperCase()}` : 'Connecting...'}
        </p>
        <p id="game-status">{gameStatus}</p>
      </div>
    </div>
  );
}

export default Game;