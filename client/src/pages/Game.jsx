// ctf-client/src/pages/Game.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import GameCanvas from '../components/GameCanvas';
import '../App.css';

// --- WebRTC Configuration ---
const iceServers = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function Game() {
  const navigate = useNavigate();
  const location = useLocation();
  const gameMode = location.state?.mode; 

  // --- Core State ---
  const [myId, setMyId] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [gameState, setGameState] = useState(null); 
  const [gameStatus, setGameStatus] = useState('Connecting...');

  // --- Refs ---
  const wsRef = useRef(null); 
  const peerConnectionRef = useRef(null); 
  const dataChannelRef = useRef(null); 
  const iceQueueRef = useRef([]);
  const isNavigatingAwayRef = useRef(false);
  // --- Refs for NEW Input Model ---
  const inputLoopRef = useRef(null); // Stores the setInterval ID for our input loop
  const localMovementsRef = useRef({ up: false, down: false, left: false, right: false });

  // --- useEffect 1: Connect WebSocket (Runs ONCE) ---
  useEffect(() => {
    if (!gameMode) {
      navigate('/'); 
      return;
    }

    const ws = new WebSocket(`ws://localhost:3000`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to signaling server');
      ws.send(JSON.stringify({ type: 'join_game', mode: gameMode }));
      setGameStatus(`Joined ${gameMode} queue...`);
    };

    ws.onclose = () => {
        if (isNavigatingAwayRef.current) {
      console.log('WebSocket closed intentionally for navigation.');
      return; // Do nothing
    }

    // If we get here, it was an UNEXPECTED disconnect
    setGameStatus('Disconnected from server.');
    alert('Disconnected from server. Returning home.');
    navigate('/');
    };

    // --- Primary WebSocket Message Handler ---
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'server_offer':
            console.log('Received server offer');
            setMyId(message.playerInfo.id);
            setMyTeam(message.playerInfo.team);
            setGameStatus('Connecting to game server...');

            peerConnectionRef.current = new RTCPeerConnection(iceServers);

            peerConnectionRef.current.onicecandidate = (event) => {
                if (event.candidate) {
                    ws.send(JSON.stringify({
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
                    await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding queued ICE candidate', e);
                }
            }

            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);

            ws.send(JSON.stringify({
                type: 'client_answer',
                answer: peerConnectionRef.current.localDescription.toJSON()
            }));
            break;
        
        case 'server_ice_candidate':
            if (message.candidate) {
                if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
                    try {
                        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
                    } catch (e) {
                        console.error('Error adding received ICE candidate', e);
                    }
                } else {
                    console.warn('PC not ready, queuing ICE candidate');
                    iceQueueRef.current.push(message.candidate);
                }
            }
            break;
      }
    };

    return () => {
        console.log("Cleaning up WebSocket and game connections.");
        clearInterval(inputLoopRef.current); // Stop input loop on unmount
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
        }
        if (wsRef.current) {
            wsRef.current.close();
        }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, navigate]); 


  // --- Helper: Setup Data Channel ---
  const setupDataChannel = (channel) => {
    channel.onopen = () => {
        console.log('Data channel OPEN');
        setGameStatus('Game in progress!');
        
        // Start the input loop
        inputLoopRef.current = setInterval(() => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'client_input',
                   inputState: localMovementsRef.current
                }));
            }
        }, 1000 / 60); 
    };

    channel.onclose = () => {
        console.log('Data channel CLOSED');
        setGameStatus('Lost connection to game server.');
        clearInterval(inputLoopRef.current); 
    };

    // --- THIS IS THE CHANGE ---
    channel.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'gameState') {
            setGameState(message.state); 
        } else if (message.type === 'game_over_final') {
            console.log("Final game over received!", message);
            
            // Stop the input loop
            clearInterval(inputLoopRef.current); 

            isNavigatingAwayRef.current = true;
            
            // Navigate to results page with state
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
    // This useEffect now *only* updates the localMovementsRef.
    // It does NOT send any messages.

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
        e.preventDefault(); // Prevent window scrolling
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
      // Reset all inputs to false. The input loop will send this.
      localMovementsRef.current = { up: false, down: false, left: false, right: false };
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur); 

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur); 
      clearInterval(inputLoopRef.current); // Clear interval on unmount
    };
  }, []); // Empty deps, runs once

  // --- Render Logic ---
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