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
  const [mapLayout, setMapLayout] = useState(null);

  const localStreamRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState({});

  const peerConnectionRef = useRef(null); 
  const dataChannelRef = useRef(null); 
  const iceQueueRef = useRef([]);
  const inputLoopRef = useRef(null);
  const localMovementsRef = useRef({ up: false, down: false, left: false, right: false });
  const isNavigatingAwayRef = useRef(false);

  // --- useEffect for Microphone ---
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        console.log('Got microphone stream');
        localStreamRef.current = stream;
        
        // --- FIX PART 1: ---
        // If the PeerConnection was created *before* we got the mic,
        // add the track to it now.
        if (peerConnectionRef.current) {
          console.log('PC exists, adding mic track retroactively.');
          stream.getTracks().forEach(track => {
            peerConnectionRef.current.addTrack(track, stream);
          });
        }
        // --- END OF FIX ---
      })
      .catch(err => {
        console.error('Failed to get mic', err);
        alert('You must allow microphone access to use voice chat.');
      });

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Runs once on mount

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
          setMapLayout(message.mapLayout);
          setGameStatus('Connecting to game server...');

          peerConnectionRef.current = new RTCPeerConnection(iceServers);

          // --- FIX PART 2: ---
          // If the mic was ready *before* the PeerConnection was created,
          // add the track to it now.
          if (localStreamRef.current) {
            console.log('Mic was ready, adding track to new PC.');
            localStreamRef.current.getTracks().forEach(track => {
              peerConnectionRef.current.addTrack(track, localStreamRef.current);
            });
          }
          // --- END OF FIX ---

          // --- Handle incoming remote tracks ---
          peerConnectionRef.current.ontrack = (event) => {
            console.log('Got remote audio track:', event.streams[0].id);
            const stream = event.streams[0];
            const streamId = stream.id;
            setRemoteStreams(prevStreams => {
              if (prevStreams[streamId]) return prevStreams;
              return {
                ...prevStreams,
                [streamId]: stream
              };
            });
          };

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
      clearInterval(inputLoopRef.current);
      if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
      }
      Object.values(remoteStreams).forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      setRemoteStreams({});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, lobby, navigate, addSocketListener, removeSocketListener]); 


  const setupDataChannel = (channel) => {
    channel.onopen = () => {
        console.log('Data channel OPEN');
        setGameStatus('Game in progress!');
        clearInterval(inputLoopRef.current);
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
    channel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'gameState') {
            setGameState(message.state); 
        } else if (message.type === 'game_over_final') {
            console.log("Final game over received!", message);
            clearInterval(inputLoopRef.current); 
            isNavigatingAwayRef.current = true;
            navigate('/results', { 
                state: { 
                    winner: message.winner, 
                    scores: message.scores,
                    playerStats: message.playerStats,
                    mvp: message.mvp
                } 
            });
        }
    };
  };

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
    };
  }, []);

  // --- Render Logic ---
  const scores = gameState ? gameState.scores : { blue: 0, red: 0 };
  const teamColor = myTeam === 'blue' ? '#3498db' : '#e74c3c';

  // --- Auto-playing <audio> element ---
  const RemoteAudio = ({ stream }) => {
    const audioRef = useRef(null);
    useEffect(() => {
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        
        audioRef.current.play().catch(error => {
          console.warn("Remote audio play() was blocked by browser.", error);
        });
      }
    }, [stream]);
    return <audio ref={audioRef} autoPlay playsInline />;
  };
  // ---

  return (
    <div className="game-screen">
      <div className="hud-panel scores-panel">
        <h2 className="hud-title">SCOREBOARD</h2>
        <div className="score-row blue">
          <span>BLUE</span>
          <span className="score-value">{scores.blue}</span>
        </div>
        <div className="score-row red">
          <span>RED</span>
          <span className="score-value">{scores.red}</span>
        </div>
      </div>
      
      {/* The Canvas Component */}
      <GameCanvas 
        gameState={gameState} 
        mapLayout={mapLayout} 
        myTeam={myTeam} 
        myId={myId} 
      />
      
      <div className="hud-panel status-panel">
        <h2 className="hud-title">SCOREBOARD</h2>
        <p className="status-row">
          OPERATIVE: <span style={{ color: teamColor, fontWeight: 'bold' }}>{myId ? myId.toUpperCase() : '...'}</span>
        </p>
        <p className="status-row">
          LINK: <span className="status-value">{gameStatus}</span>
        </p>
        <button className="abort-btn" onClick={() => navigate('/')}>EXIT</button>
      </div>

      <div className="remote-audio-container">
        {Object.keys(remoteStreams).map(streamId => (
          <RemoteAudio key={streamId} stream={remoteStreams[streamId]} />
        ))}
      </div>
    </div>
  );
}

export default Game;